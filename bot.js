#!/usr/bin/env node
// VoxelFishing multi-account bot with proxy + humanize
//
// Per account (run in parallel by default):
//   1. Sign in via Privy SIWS (Phantom wallet)
//   2. Claim daily grants (once per day)
//   3. Loop: cast with magnet -> wait fish count -> sell/keep -> save
//   4. All timing randomized to mimic human behavior
//
// CLI flags:
//   --auth-only    : just refresh tokens for all accounts, then exit
//   --account <n>  : run only the named account
//   --once         : do one full cycle per account then exit
//   --no-proxy     : force direct connection (ignore account.proxy)
//   --verbose      : log all API calls

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadKeypair } from './lib/wallet.js';
import { signIn, probeToken } from './lib/auth.js';
import { VoxelAPI } from './lib/api.js';
import {
  loadAccounts,
  loadTokens,
  saveToken,
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

  // Step 1: claim grants
  if (acct.claimGrants) {
    try {
      const r = await api.claimGrants();
      log.ok(`[${acct.name}] grants claimed: ${JSON.stringify(r).slice(0, 120)}`);
    } catch (e) {
      log.warn(`[${acct.name}] grants claim skipped: ${e.message}`);
    }
    await actionPause(2000, 5000);
  }

  // Step 2: fish loop
  let cycle = 0;
  const startTime = Date.now();

  while (true) {
    cycle++;
    try {
      // Cast with magnet
      if (acct.magnetMode !== 'off') {
        const r = await api.magnetCast();
        log.tag(acct.name, `cast #${cycle} (magnet): ${JSON.stringify(r).slice(0, 140)}`);
        // 30% chance to add an extra pause to look more human
        if (maybeSkip(0.3)) {
          await actionPause(1500, 4000);
        }
      }

      // Check inventory periodically — used for sell decisions
      let fishList = [];
      if (acct.sellMode === 'threshold' && cycle % 3 === 0) {
        try {
          fishList = await api.listFish();
          log.debug(`[${acct.name}] fish count: ${fishList.length}`);
        } catch (e) {
          log.warn(`[${acct.name}] list fish failed: ${e.message}`);
        }
      }

      // Sell logic
      if (acct.sellMode === 'auto') {
        // Auto mode: list fish every cycle (cheap) and sell everything
        try {
          fishList = await api.listFish();
        } catch (e) {
          log.warn(`[${acct.name}] list fish failed: ${e.message}`);
        }
      }

      if (fishList.length > 0 && acct.sellMode !== 'off') {
        const uids = fishList.map((f) => f.uid).filter(Boolean);
        if (uids.length > 0 && (acct.sellMode === 'auto' || uids.length >= acct.sellThreshold)) {
          // Batch by 100 to stay under server limit (max 500 per call)
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
  log.info(`VoxelFishing bot v1.0 — ${new Date().toISOString()}`);
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
