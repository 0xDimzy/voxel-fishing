#!/usr/bin/env node
// VoxelFishing bot v2 — extended task automation
//
// Per account (run in parallel by default):
//   1. Sign in via Privy SIWS (Phantom wallet)
//   2. Claim daily grants + relic set bonuses
//   3. Loop: cast (magnet + meme parallel) → sell-safe fish → consume targets → sell pets → save
//   4. All timing randomized to mimic human behavior
//
// CLI flags:
//   --auth-only    : just refresh tokens for all accounts, then exit
//   --account <n>  : run only the named account
//   --once         : do 3 cycles per account then exit (smoke test)
//   --no-proxy     : force direct connection (ignore account.proxy)
//   --verbose      : log all API calls

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadKeypair } from './lib/wallet.js';
import { signIn, probeToken } from './lib/auth.js';
import { VoxelAPI } from './lib/api.js';
import { setupCharacter as setupCharacterV2 } from './lib/character.js';
import {
  loadAccounts,
  loadTokens,
  saveToken,
  updateAccountCharacter,
  getToken,
  clearToken,
} from './lib/accounts.js';
import {
  sleep,
  shortPause,
  actionPause,
  accountPause,
  randInt,
  maybeSkip,
  gaussianDelay,
  pickWeighted,
  jitter,
} from './lib/humanize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const args = process.argv.slice(2);
const FLAGS = {
  authOnly: args.includes('--auth-only'),
  once: args.includes('--once'),
  noProxy: args.includes('--no-proxy'),
  verbose: args.includes('--verbose'),
  onlyAccount: (() => {
    const i = args.indexOf('--account');
    return i >= 0 ? args[i + 1] : null;
  })(),
};

const T = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const log = {
  info: (msg, c = 'cyan') => console.log(`${T[c]}[i]${T.reset} ${msg}`),
  ok: (msg) => console.log(`${T.green}[✓]${T.reset} ${msg}`),
  warn: (msg) => console.log(`${T.yellow}[!]${T.reset} ${msg}`),
  err: (msg) => console.log(`${T.red}[✗]${T.reset} ${msg}`),
  debug: (msg) => FLAGS.verbose && console.log(`${T.gray}[·]${T.reset} ${msg}`),
  tag: (tag, msg, c = 'blue') => console.log(`${T[c]}[${tag}]${T.reset} ${msg}`),
};

// === rarity helpers ===
// Tiers are ordered: common < uncommon < rare < epic < mythical < legendary
const RARITY_TIER = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  mythical: 5,
  legendary: 6,
};
const ALL_RARITIES = Object.keys(RARITY_TIER);

function resolveSellMaxRarity(s) {
  if (!s) return 'rare';
  const k = String(s).toLowerCase();
  if (k === 'off') return null; // explicit no-sell
  if (RARITY_TIER[k]) return k;
  return 'rare';
}

/** Decide which fish to sell given policy. Returns array of {uid, speciesId, rarity}. */
function pickSellableFish(tradeableAssets, policy) {
  const cap = policy.sellMaxRarityTier; // null = no-sell, number = tier ceiling
  const keepMythics = policy.keepMythics !== false; // default true
  if (cap == null) return [];
  const out = [];
  for (const f of tradeableAssets || []) {
    if (!f?.uid) continue;
    // Skip non-fish assets (pets show up here too in some saves)
    if (f.kind && f.kind !== 'fish') continue;
    const r = (f.rarity || '').toLowerCase();
    const tier = RARITY_TIER[r] ?? 0;
    if (tier === 0) continue; // unknown rarity — skip by default
    // Defense layer 1: never sell mythics if keepMythics
    if (keepMythics && tier >= RARITY_TIER.mythical) continue;
    // Defense layer 2: never sell above sellMaxRarity
    if (tier > cap) continue;
    out.push(f);
  }
  return out;
}

/** Pick fish to consume based on consumeTargets speciesId list. */
function pickConsumableFish(tradeableAssets, policy) {
  const targets = policy.consumeTargets || [];
  if (targets.length === 0) return [];
  const set = new Set(targets.map((s) => String(s).toLowerCase()));
  const out = [];
  for (const f of tradeableAssets || []) {
    if (!f?.uid) continue;
    if (f.kind && f.kind !== 'fish') continue;
    const sid = (f.speciesId || f.species || '').toLowerCase();
    if (set.has(sid)) out.push(f);
  }
  return out;
}

/** Pick pet assets to sell. */
function pickSellablePets(tradeableAssets) {
  const out = [];
  for (const f of tradeableAssets || []) {
    if (!f?.uid) continue;
    // Heuristic: pets typically have petId field; fish have speciesId.
    // Also: tradeableAssets might tag with kind:"pet".
    if (f.kind === 'pet') out.push(f);
    else if (f.petId && !f.speciesId) out.push(f);
  }
  return out;
}

function summarizeKeptFish(tradeableAssets, policy) {
  // Group kept (not-sold) fish by rarity for visibility
  const cap = policy.sellMaxRarityTier;
  const counts = {};
  for (const f of tradeableAssets || []) {
    if (!f?.uid) continue;
    if (f.kind && f.kind !== 'fish') continue;
    const r = (f.rarity || '').toLowerCase();
    if (!r) continue;
    const tier = RARITY_TIER[r] ?? 0;
    if (tier === 0) continue;
    const kept = (policy.keepMythics && tier >= RARITY_TIER.mythical) || tier > cap;
    if (kept) counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

// ---------- sign-in flow ----------

async function ensureSignedIn(acct) {
  const cached = getToken(acct.name);
  if (cached?.accessToken) {
    const proxyUrl = FLAGS.noProxy ? null : acct.proxy;
    const valid = await probeToken(cached.accessToken, proxyUrl);
    if (valid) {
      log.tag(acct.name, `cached token still valid (${cached.address?.slice(0, 6)}...)`);
      return { accessToken: cached.accessToken, address: cached.address };
    }
    log.tag(acct.name, 'cached token expired — re-signing in');
  }
  log.tag(acct.name, 'signing in via Privy SIWS…');
  const keypair = loadKeypair(acct.wallet);
  const proxyUrl = FLAGS.noProxy ? null : acct.proxy;
  const sess = await signIn(keypair, proxyUrl);
  saveToken(acct.name, {
    accessToken: sess.accessToken,
    address: sess.address,
  });
  log.ok(`[${acct.name}] signed in: ${sess.address}`);
  return sess;
}

// ---------- per-account worker ----------

async function runAccount(acct) {
  const proxyUrl = FLAGS.noProxy ? null : acct.proxy;
  const proxyNote = proxyUrl ? ` via ${proxyUrl.replace(/\/\/.*@/, '//***@')}` : ' (direct)';
  log.tag(acct.name, `starting${proxyNote}`);

  let sess;
  try {
    sess = await ensureSignedIn(acct);
  } catch (e) {
    log.err(`[${acct.name}] sign-in failed: ${e.message}`);
    return;
  }

  const api = new VoxelAPI(sess.accessToken, proxyUrl);

  // === Step 0: character setup (idempotent, detect-first) ===
  // setupMode:
  //   skip   (default) — detect only, never overwrite. After detection, the
  //                      bot writes the server's current character back to
  //                      accounts.json so the user's config reflects reality.
  //                      Best choice when character is set in the browser.
  //   config           — always force accounts.json character on every run.
  //                      Overwrites the server's character.
  //   auto             — set on first run (writes state.json + persists
  //                      accounts.json), then skip until config changes.
  //                      Idempotent across runs.
  const char = acct.character || {};
  const mode = char.mode || 'skip';
  try {
    const r = await setupCharacterV2({
      accessToken: sess.accessToken,
      address: sess.address,
      mode,
      cfg: char,
      acctId: acct.name,
      stateDir: path.join(ROOT, '.hermes'),
      proxyUrl,
      timeoutMs: 8000,
    });
    for (const w of r.warnings) log.warn(`[${acct.name}] character: ${w}`);
    log.tag(acct.name, `${r.reason}${r.applied ? ' ✓ applied' : ''}`);

    // === Writeback: in skip mode, persist the detected character to
    // accounts.json so the user's config reflects what the server has. ===
    // NOTE: REST /api/me/save returns boat/hull/accent only (name is in WS
    // hello state). Don't overwrite accounts.json.name with null — keep
    // whatever the user already has there (or leave it unset).
    if (mode === 'skip' && r.detected) {
      try {
        const wb = {
          mode: 'skip',
          boat: r.detected.boatId,
          hull: r.detected.hull,
          accent: r.detected.accent,
        };
        if (r.detected.name) wb.name = r.detected.name;
        updateAccountCharacter(acct.name, wb);
        log.tag(acct.name, `accounts.json updated with detected character (boat=${wb.boat}, hull=${wb.hull}, accent=${wb.accent}${r.detected.name ? `, name=${wb.name}` : ', name preserved'})`);
      } catch (e) {
        log.warn(`[${acct.name}] accounts.json writeback failed: ${e.message}`);
      }
    }
  } catch (e) {
    log.warn(`[${acct.name}] character setup failed: ${e.message}`);
  }
  await actionPause(1200, 3000);

  // === Resolve policy from config ===
  const policy = {
    sellMaxRarityTier: RARITY_TIER[resolveSellMaxRarity(acct.sellMaxRarity)],
    keepMythics: acct.keepMythics !== false,
    consumeTargets: Array.isArray(acct.consumeTargets)
      ? acct.consumeTargets
      : (acct.consumeAbyssLurker !== false ? ['abysslurker'] : []),
    sellPets: acct.sellPets === 'auto' ? 'auto' : 'off',
    sellMode: acct.sellMode || 'auto', // off | threshold | auto
    sellThreshold: Number.isFinite(acct.sellThreshold) ? acct.sellThreshold : 50,
    memeMode: acct.memeMode === 'parallel' ? 'parallel' : 'off',
    memeMaxPerCycle: Number.isFinite(acct.memeMaxPerCycle) ? acct.memeMaxPerCycle : 1,
    claimRelicSet: acct.claimRelicSet !== false, // default true
  };

  // === Step 1: claim grants (daily, can be slow) ===
  if (acct.claimGrants) {
    try {
      const r = await api.claimGrants();
      log.ok(`[${acct.name}] grants claimed: ${JSON.stringify(r).slice(0, 120)}`);
    } catch (e) {
      log.warn(`[${acct.name}] grants claim skipped: ${e.message}`);
    }
    await actionPause(2000, 5000);
  }

  // === Step 2: claim relic set bonus (idempotent — alreadyClaimed + incomplete_set both fine) ===
  if (policy.claimRelicSet) {
    try {
      const r = await api.claimRelicSet();
      if (r.ok) {
        log.ok(`[${acct.name}] relic-set claimed: ${JSON.stringify(r).slice(0, 120)}`);
      } else if (r.reason === 'incomplete_set') {
        log.tag(acct.name, `relic-set: incomplete (no full set, normal)`);
      } else {
        log.warn(`[${acct.name}] relic-set: ${JSON.stringify(r).slice(0, 120)}`);
      }
    } catch (e) {
      log.warn(`[${acct.name}] relic-set-claim failed: ${e.message}`);
    }
    await actionPause(1500, 3500);
  }

  // === Step 3: fish loop ===
  let cycle = 0;
  const startTime = Date.now();

  while (true) {
    cycle++;
    try {
      // --- 3a: magnet cast ---
      if (acct.magnetMode !== 'off') {
        const r = await api.magnetCast();
        const outcome = r?.outcome || r?.kind || '?';
        log.tag(acct.name, `cast #${cycle} magnet: outcome=${outcome} ${JSON.stringify(r).slice(0, 120)}`);
        if (maybeSkip(0.3)) {
          await actionPause(1500, 4000);
        }
      }

      // --- 3b: meme cast (parallel mode, rate-limited) ---
      if (policy.memeMode === 'parallel') {
        for (let m = 0; m < policy.memeMaxPerCycle; m++) {
          try {
            const r = await api.memeCast();
            if (r?.rateLimited) {
              log.warn(`[${acct.name}] meme-cast rate-limited, backing off`);
              break;
            }
            if (r?.insufficientFunds) {
              log.warn(`[${acct.name}] meme-cast: insufficient funds (server=${r.serverMoney ?? '?'})`);
              break;
            }
            if (r?.ok) {
              log.tag(acct.name, `meme-cast: amount=${r.amount ?? '?'}`, 'magenta');
            }
          } catch (e) {
            if (e.status === 429) {
              log.warn(`[${acct.name}] meme-cast 429 — slowing down`);
              break;
            }
            if (e.status === 402) {
              log.warn(`[${acct.name}] meme-cast 402 — insufficient funds`);
              break;
            }
            log.warn(`[${acct.name}] meme-cast error: ${e.message}`);
            break;
          }
          if (m < policy.memeMaxPerCycle - 1) await shortPause(1500, 3500);
        }
      }

      // --- 3c: list fish (tradeableAssets) ---
      let tradeable = [];
      const listEveryCycle = policy.sellMode === 'auto';
      const listPeriodically = policy.sellMode === 'threshold' && cycle % 3 === 0;
      if (listEveryCycle || listPeriodically || policy.consumeTargets.length > 0 || policy.sellPets === 'auto') {
        try {
          const save = await api.getSave();
          tradeable = save?.tradeableAssets || [];
          log.debug(`[${acct.name}] tradeable assets: ${tradeable.length}`);
        } catch (e) {
          log.warn(`[${acct.name}] getSave failed: ${e.message}`);
        }
      }

      // --- 3d: sell safe fish (rarity-filtered) ---
      const sellable = pickSellableFish(tradeable, policy);
      if (sellable.length > 0) {
        const shouldSell =
          policy.sellMode === 'auto' ||
          (policy.sellMode === 'threshold' && sellable.length >= policy.sellThreshold);
        if (shouldSell) {
          const uids = sellable.map((f) => f.uid);
          for (let i = 0; i < uids.length; i += 100) {
            const batch = uids.slice(i, i + 100);
            try {
              const sellRes = await api.sellFish(batch);
              log.ok(`[${acct.name}] sold ${batch.length} fish: ${JSON.stringify(sellRes).slice(0, 140)}`);
              await shortPause(1500, 3500);
            } catch (e) {
              log.warn(`[${acct.name}] sell failed: ${e.message}`);
            }
          }
        }
      }

      // --- 3e: consume fish targets (e.g. abysslurker for Abyssal Aura) ---
      if (policy.consumeTargets.length > 0) {
        const consumable = pickConsumableFish(tradeable, policy);
        for (const f of consumable) {
          try {
            const r = await api.consumeFish(f.uid);
            const aura = r?.auraGranted ? ' 🌟 AURA GRANTED' : '';
            log.ok(`[${acct.name}] consumed ${f.speciesId || 'fish'} (uid=${f.uid.slice(0, 8)}…) deleted=${r?.deleted}${aura}`);
            await shortPause(1500, 3000);
          } catch (e) {
            log.warn(`[${acct.name}] consume ${f.speciesId} failed: ${e.message}`);
          }
        }
      }

      // --- 3f: sell pets (if configured) ---
      if (policy.sellPets === 'auto') {
        const pets = pickSellablePets(tradeable);
        for (const p of pets) {
          try {
            const r = await api.sellPet(p.uid);
            log.ok(`[${acct.name}] sold pet ${p.petName || p.petId || p.uid.slice(0, 8)}: amount=${r?.amount ?? '?'}`);
            await shortPause(1500, 3500);
          } catch (e) {
            log.warn(`[${acct.name}] pet sell failed: ${e.message}`);
          }
        }
      }

      // --- 3g: visibility — show kept fish by rarity ---
      const keptCounts = summarizeKeptFish(tradeable, policy);
      const keptTotal = Object.values(keptCounts).reduce((a, b) => a + b, 0);
      if (keptTotal > 0) {
        const breakdown = Object.entries(keptCounts)
          .sort((a, b) => (RARITY_TIER[b[0]] || 0) - (RARITY_TIER[a[0]] || 0))
          .map(([r, n]) => `${n} ${r}`)
          .join(', ');
        log.tag(acct.name, `kept ${keptTotal} fish (${breakdown})`, 'gray');
      }

      // Exit if --once
      if (FLAGS.once && cycle >= 3) break;

      // Humanize pause: 3-9s, occasionally 12s+
      const pause = maybeSkip(0.08)
        ? await actionPause(10000, 16000)
        : await actionPause(3000, 9000);
      await pause;
    } catch (e) {
      log.err(`[${acct.name}] cycle ${cycle} error: ${e.message}`);
      if (e.status === 401) {
        log.warn(`[${acct.name}] token rejected — re-signing in next cycle`);
        clearToken(acct.name);
      }
      await actionPause(15000, 30000);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  log.ok(`[${acct.name}] finished after ${elapsed}s (${cycle} cycles)`);
}

// ---------- main ----------

async function main() {
  log.info(`VoxelFishing bot v2 — ${new Date().toISOString()}`);
  if (FLAGS.noProxy) log.warn('--no-proxy: ignoring all account proxy settings');
  if (FLAGS.once) log.info('--once: each account runs 3 cycles then exits');

  let accounts;
  try {
    accounts = loadAccounts();
  } catch (e) {
    log.err(e.message);
    log.info('Create accounts.json from accounts.example.json');
    process.exit(1);
  }

  if (FLAGS.onlyAccount) {
    accounts = accounts.filter((a) => a.name === FLAGS.onlyAccount);
    if (accounts.length === 0) {
      log.err(`No account with name "${FLAGS.onlyAccount}"`);
      process.exit(1);
    }
  }

  log.info(`Loaded ${accounts.length} account(s): ${accounts.map((a) => a.name).join(', ')}`);

  if (FLAGS.authOnly) {
    for (const acct of accounts) {
      try {
        await ensureSignedIn(acct);
      } catch (e) {
        log.err(`[${acct.name}] sign-in failed: ${e.message}`);
      }
    }
    log.ok('Auth-only done.');
    return;
  }

  // Run accounts in parallel
  await Promise.all(accounts.filter((a) => a.enabled).map(runAccount));
  log.ok('All accounts finished.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});