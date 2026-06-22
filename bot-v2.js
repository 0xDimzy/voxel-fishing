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

// === UI helpers (emoji outcomes, color-coded logs) =======================
// Map API outcome → {emoji, color, label, value}. Keeps log lines scannable.
const OUTCOME_STYLE = {
  coins:        { e: '💰', c: 'yellow',   label: 'coins'  },
  chest:        { e: '🎁', c: 'magenta',  label: 'chest'  },
  junk:         { e: '🗑️', c: 'gray',     label: 'junk'   },
  rod:          { e: '🎣', c: 'cyan',     label: 'rod'    },  // magnet-cast rod upgrade
  rod_upgrade:  { e: '🎣', c: 'cyan',     label: 'rod'    },  // alt name
  engine:       { e: '⚙️', c: 'cyan',     label: 'engine' },  // magnet engine upgrade
  fish:         { e: '🐟', c: 'blue',     label: 'fish'   },
  relic:        { e: '🏆', c: 'magenta',  label: 'relic'  },
};

function fmtOutcome(r) {
  const o = r?.outcome || r?.kind || 'unknown';
  const style = OUTCOME_STYLE[o] || { e: '?', c: 'dim', label: o };
  const { e, c, label } = style;
  // Value extraction per outcome
  let val = '';
  if (o === 'coins') val = `+${r.coinsAwarded ?? '?'} ${label}`;
  else if (o === 'chest') val = `+${r.chestCoins ?? r.coinsAwarded ?? '?'} ${label}`;
  else if (o === 'junk') val = `${label} (${r.junkId ?? '?'})`;
  else if (o === 'rod' || o === 'rod_upgrade') val = `${label} lvl ${r.rodLevel ?? r.newRodLevel ?? '?'}`;
  else if (o === 'engine') val = `${label} lvl ${r.engineLevel ?? '?'}`;
  else if (o === 'fish') val = `${label} (${r.speciesId ?? r.uid?.slice(0, 8) ?? '?'})`;
  else val = label;
  const xp = r?.xpAwarded > 0 ? ` ${T.dim}(${r.xpAwarded} xp)${T.reset}` : '';
  return `${T[c]}${e} ${val}${T.reset}${xp}`;
}

// Format a full cast line. castType ∈ {'magnet', 'meme'}
//   🟢 [utama] cycle 3 · magnet #1 → 💰 +23 coins (5 xp)
//   ⚪ [utama] cycle 3 · meme #1   → ⚠️ 402 insufficient (skip)
function fmtCastLine(acct, cycle, castType, idx, r) {
  if (r?._error) {
    const e = r._error;
    if (e.status === 402) return `${T.yellow}⚪${T.reset} [${acct}] cycle ${cycle} · ${castType} #${idx} → ${T.yellow}⚠ 402 insufficient (skip)${T.reset}`;
    if (e.status === 429) return `${T.yellow}⚪${T.reset} [${acct}] cycle ${cycle} · ${castType} #${idx} → ${T.yellow}⚠ 429 rate-limited (slowing)${T.reset}`;
    return `${T.red}⚪${T.reset} [${acct}] cycle ${cycle} · ${castType} #${idx} → ${T.red}❌ ${e.message}${T.reset}`;
  }
  if (!r?.ok && r) {
    return `${T.yellow}⚪${T.reset} [${acct}] cycle ${cycle} · ${castType} #${idx} → ${T.yellow}⚠ ${r.error || 'failed'}${T.reset}`;
  }
  return `${T.green}🟢${T.reset} [${acct}] cycle ${cycle} · ${castType} #${idx} → ${fmtOutcome(r)}`;
}

// Format a tally line, printed every N cycles. Shows running earnings.
function fmtTally(acct, tally, cycles, elapsedSec) {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  const time = m > 0 ? `${m}m${s}s` : `${s}s`;
  const lines = [
    `${T.cyan}╭─ [${acct}] tally after ${cycles} cycles (${time}) ─────────${T.reset}`,
    `${T.cyan}│${T.reset} ${T.yellow}💰 ${tally.coins} coins${T.reset}   ${T.blue}⭐ ${tally.xp} xp${T.reset}`,
    `${T.cyan}│${T.reset} ${T.magenta}🎁 ${tally.chests} chest${T.reset}   ${T.gray}🗑️ ${tally.junk} junk${T.reset}`,
    `${T.cyan}│${T.reset} ${T.cyan}📈 rod upgrades: ${tally.rodUpgrades}${T.reset}   ${T.dim}⏭ meme-skipped: ${tally.memeSkipped}${T.reset}`,
    `${T.cyan}╰────────────────────────────────────────────────────────${T.reset}`,
  ];
  return lines.join('\n');
}

// Format end-of-run summary line.
function fmtEndSummary(acct, tally, cycles, elapsedSec) {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  const time = m > 0 ? `${m}m${s}s` : `${s}s`;
  return `${T.green}✓${T.reset} [${acct}] finished · ${cycles} cycles · ${time} · ${T.yellow}💰 ${tally.coins} coins${T.reset} · ${T.blue}⭐ ${tally.xp} xp${T.reset} · ${T.magenta}🎁 ${tally.chests} chest${T.reset}`;
}

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
  const tally = {
    coins: 0, xp: 0, chests: 0, junk: 0, rodUpgrades: 0, memeSkipped: 0,
    magnetCasts: 0, memeCasts: 0,
  };
  const TALLY_EVERY = 5;
  const castMode = acct.castMode || 'magnet'; // default: backwards compat

  // Helper: update tally from a cast result
  function tallyFrom(r, kind) {
    if (kind === 'magnet') tally.magnetCasts++;
    else tally.memeCasts++;
    if (r?._error) {
      if (r._error.status === 402 || r._error.status === 429) tally.memeSkipped++;
      return;
    }
    tally.coins += r?.coinsAwarded || 0;
    tally.xp += r?.xpAwarded || 0;
    if (r?.outcome === 'chest') tally.chests++;
    if (r?.outcome === 'junk') tally.junk++;
    if (r?.outcome === 'rod_upgrade' || r?.rodLevel) tally.rodUpgrades++;
    if (r?.outcome === 'engine' || r?.engineLevel) tally.rodUpgrades++;
  }

  // Helper: try meme-cast once, returns result or { _error: e }
  // Some endpoints return body-level errors (e.g. {error:"insufficient_funds"})
  // with HTTP 200 — convert those to _error so fmtCastLine handles them uniformly.
  async function tryMemeCastOnce() {
    try {
      const r = await api.memeCast();
      if (r?.error) {
        // Map body error → synthetic _error matching HTTP semantics
        if (r.error === 'insufficient_funds') {
          return { _error: { status: 402, message: `insufficient funds (${r.serverMoney ?? '?'}/${r.required ?? '?'})` } };
        }
        if (r.error === 'rate_limited' || r.error === 'slow_down') {
          return { _error: { status: 429, message: r.error } };
        }
        return { _error: { status: 400, message: r.error } };
      }
      return r;
    } catch (e) {
      return { _error: e };
    }
  }

  // Helper: try magnet-cast once, returns result or { _error: e }
  // Body-level errors (rate_limited comes back as HTTP 200 with
  // {error:"rate_limited",waitMs:4500}) are converted to _error too.
  async function tryMagnetCastOnce() {
    try {
      const r = await api.magnetCast();
      if (r?.error === 'rate_limited' || r?.error === 'slow_down') {
        return { _error: { status: 429, message: `rate limited (wait ${r.waitMs ?? '?'}ms)` } };
      }
      if (r?.error) {
        return { _error: { status: 400, message: r.error } };
      }
      return r;
    } catch (e) {
      return { _error: e };
    }
  }

  while (true) {
    cycle++;
    try {
      // --- 3a: cast dispatch based on castMode ---
      //   magnet (default): magnet PRIMARY, meme parallel
      //   rod            : meme PRIMARY, magnet as fallback when no funds
      if (castMode === 'rod') {
        // Rod mode: try meme-cast first (it's the premium fishing action)
        if (policy.memeMode !== 'off') {
          for (let m = 0; m < policy.memeMaxPerCycle; m++) {
            const r = await tryMemeCastOnce();
            tallyFrom(r, 'meme');
            console.log(fmtCastLine(acct.name, cycle, 'meme', m + 1, r));
            if (r._error && (r._error.status === 402 || r._error.status === 429)) break;
            if (m < policy.memeMaxPerCycle - 1) await shortPause(1500, 3500);
          }
        }
        // Magnet-cast as fallback (or always if no errors above)
        if (acct.magnetMode !== 'off') {
          const r = await tryMagnetCastOnce();
          tallyFrom(r, 'magnet');
          console.log(fmtCastLine(acct.name, cycle, 'magnet', tally.magnetCasts, r));
          if (r && !r._error && maybeSkip(0.3)) await actionPause(1500, 4000);
        }
      } else {
        // Magnet mode (default): magnet PRIMARY, meme parallel
        if (acct.magnetMode !== 'off') {
          const r = await tryMagnetCastOnce();
          tallyFrom(r, 'magnet');
          console.log(fmtCastLine(acct.name, cycle, 'magnet', tally.magnetCasts, r));
          if (r && !r._error && maybeSkip(0.3)) await actionPause(1500, 4000);
        }
        if (policy.memeMode === 'parallel') {
          for (let m = 0; m < policy.memeMaxPerCycle; m++) {
            const r = await tryMemeCastOnce();
            tallyFrom(r, 'meme');
            console.log(fmtCastLine(acct.name, cycle, 'meme', tally.memeCasts, r));
            if (r._error && (r._error.status === 402 || r._error.status === 429)) break;
            if (m < policy.memeMaxPerCycle - 1) await shortPause(1500, 3500);
          }
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

      // Per-cycle header (lightweight, shows mode + cycle in/out context)
      if (cycle % TALLY_EVERY === 0) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(fmtTally(acct.name, tally, cycle, elapsed));
      }

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
  console.log(fmtEndSummary(acct.name, tally, cycle, elapsed));
  // Final tally block (always shown at end, even for short runs)
  console.log(fmtTally(acct.name, tally, cycle, elapsed));
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