#!/usr/bin/env node
// ============================================================================
//  VoxelFishing Bot — Simple
//
//  Bot ini fishing otomatis di game VoxelFishing.com.
//  Cocok buat pemula yang baru mulai, gak perlu setting macem-macem.
//
//  CARA KERJA (per akun, jalan bareng semua wallet yang ada di accounts.json):
//    1. Login pake wallet (Privy SIWS)
//    2. Klaim daily grant (kalo ada)
//    3. Loop tanpa henti:
//         a. Cast magnet
//         b. Tunggu ikan
//         c. Kalo ikan > 50, jual semua
//         d. Tidur random 4-8 detik (anti-detect)
//    4. Kalo token mati (401), login ulang otomatis
//
//  CARA PAKE:
//    $ npm run start                     # jalanin semua akun (parallel)
//    $ npm run start -- --account utama  # cuma akun "utama"
//    $ npm run start -- --no-proxy       # paksa semua akun direct (tanpa proxy)
//    $ npm run start -- --once           # 3 cycle doang, terus exit (smoke test)
//    $ npm run start -- --auth-only      # cuma login, terus exit (refresh token)
//    $ npm run add-account               # tambah akun baru
//
//  TAMBAH AKUN BARU:
//    $ npm run add-account               # wizard interaktif
//    $ npm run accounts                  # lihat semua akun
//
//  PROXY ON/OFF:
//    Di accounts.json, set "proxy": null     →  direct (tanpa proxy)
//                   set "proxy": "socks5://user:pass@host:1080"  → pakai proxy
//    Atau global:  npm run start -- --no-proxy   →  paksa semua akun direct
// ============================================================================

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
import { actionPause, maybeSkip } from './lib/humanize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI flags ─────────────────────────────────────────────────────────────────
//
// Cara baca: dari command line, misal `npm run start -- --account utama`
// semua argumen setelah `--` dikumpulin di argv. Kita parse yg kita butuh.
//
// --account <nama>   cuma jalanin akun tertentu
// --no-proxy         paksa semua akun direct (override "proxy" di JSON)
// --once             3 cycle doang terus exit (buat smoke test)
// --auth-only        cuma login, refresh token, terus exit
// --verbose          log semua API call (debug)
//
const argv = process.argv.slice(2);
const ONLY_ACCOUNT = (() => {
  const i = argv.indexOf('--account');
  return i >= 0 ? argv[i + 1] : null;
})();
const NO_PROXY = argv.includes('--no-proxy');
const ONCE = argv.includes('--once');
const AUTH_ONLY = argv.includes('--auth-only');
const VERBOSE = argv.includes('--verbose');

// ── Logging ───────────────────────────────────────────────────────────────────
//
// Format: HH:MM:SS [nama-akun] pesan
// Contoh: 12:34:56 [utama] 🎣 cast berhasil, dapet 3 ikan
//
// Pakai console.log biasa + emoji biar gampang dibaca orang awam.
// Tiap function log pre-format string sendiri, gak ada library.
//
const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
function ts() {
  return new Date().toTimeString().slice(0, 8);  // "12:34:56"
}
function now() {
  return T.dim + ts() + T.reset;
}
function tag(name) {
  return T.cyan + '[' + name + ']' + T.reset;
}
function info(name, msg) {
  console.log(`${now()} ${tag(name)} ${msg}`);
}
function ok(name, msg) {
  console.log(`${now()} ${tag(name)} ${T.green}${msg}${T.reset}`);
}
function warn(name, msg) {
  console.log(`${now()} ${tag(name)} ${T.yellow}${msg}${T.reset}`);
}
function err(name, msg) {
  console.log(`${now()} ${tag(name)} ${T.red}${msg}${T.reset}`);
}
function banner(msg) {
  console.log(`${T.magenta}${msg}${T.reset}`);
}

// ── Proxy resolution ──────────────────────────────────────────────────────────
//
// Prioritas (dari tinggi ke rendah):
//   1. --no-proxy flag        → null (paksa direct, ignore JSON)
//   2. acct.proxy di JSON     → string URL (pakai proxy ini)
//   3. fallback               → null (direct)
//
// Output: { url, note } — `note` udah di-redact password buat log.
//
function resolveProxy(acct) {
  if (NO_PROXY) return { url: null, note: 'direct (--no-proxy)' };
  if (acct.proxy) return { url: acct.proxy, note: acct.proxy.replace(/\/\/.*@/, '//***@') };
  return { url: null, note: 'direct' };
}

// ── Login ─────────────────────────────────────────────────────────────────────
//
// Sign-in flow:
//   1. Cek tokens.json, kalo ada token buat akun ini, probe dulu
//   2. Kalo token masih valid, pake itu (gak perlu sign-in ulang)
//   3. Kalo gak ada / expired, sign-in via Privy SIWS pake wallet keypair
//
// Sign-in pake lib/auth.js (handles SIWS message + signature + server verify).
//
async function login(acct) {
  const { url: proxyUrl, note } = resolveProxy(acct);
  info(acct.name, `🔐 login (proxy: ${note})...`);

  // Cek cached token dulu
  const cached = getToken(acct.name);
  if (cached?.accessToken) {
    info(acct.name, `   cek cached token (${cached.address?.slice(0, 6)}...)...`);
    const valid = await probeToken(cached.accessToken, proxyUrl);
    if (valid) {
      ok(acct.name, `   ✅ token masih valid`);
      return cached;
    }
    warn(acct.name, `   token expired, sign-in ulang`);
  }

  // Sign-in baru
  const keypair = loadKeypair(acct.wallet);
  const sess = await signIn(keypair, proxyUrl);
  saveToken(acct.name, {
    accessToken: sess.accessToken,
    address: sess.address,
  });
  ok(acct.name, `   ✅ login OK (${sess.address.slice(0, 6)}...)`);
  return sess;
}

// ── Fishing loop ──────────────────────────────────────────────────────────────
//
// Cycle: cast → wait → check fish → sell → sleep → repeat
//        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//        satu "putaran", diulang selamanya (atau 3x kalo --once)
//
// Cast pake magnet (item, auto-catch, gak perlu klik manual).
// Inventory di-cek tiap cycle (cheap, REST call).
// Kalo ikan >= SELL_THRESHOLD, jual semua.
// Sleep random 4-8 detik (humanized, gak ke-detect bot).
//
const SELL_THRESHOLD = 50;

async function runAccount(acct) {
  const { url: proxyUrl, note } = resolveProxy(acct);
  banner(`\n▶ ${acct.name} — starting (proxy: ${note})`);

  // Step 1: login
  let sess;
  try {
    sess = await login(acct);
  } catch (e) {
    err(acct.name, `❌ login gagal: ${e.message}`);
    err(acct.name, `   cek wallet key di accounts.json, atau coba manual di browser`);
    return;
  }

  const api = new VoxelAPI(sess.accessToken, proxyUrl);

  // Step 2: claim daily grants (sekali aja di awal)
  info(acct.name, '🎁 cek daily grant...');
  try {
    const r = await api.claimGrants();
    ok(acct.name, `   ✅ grant diklaim: ${JSON.stringify(r).slice(0, 100)}`);
  } catch (e) {
    warn(acct.name, `   grant skip: ${e.message.slice(0, 80)}`);
  }
  await actionPause(2000, 5000);

  // Step 3: fishing loop
  let cycle = 0;
  const startedAt = Date.now();
  info(acct.name, `🎣 mulai fishing loop (target: jual kalo ikan >= ${SELL_THRESHOLD})`);

  while (true) {
    cycle++;
    try {
      // 3a. Cast magnet
      info(acct.name, `[cycle ${cycle}] 🎣 cast magnet...`);
      const cast = await api.magnetCast();
      const coins = cast?.coins ?? 0;
      const xp = cast?.xp ?? 0;
      ok(acct.name, `   dapet ${coins} coins, ${xp} XP`);

      // 3b. Random short pause (30% chance extra long)
      if (maybeSkip(0.3)) {
        await actionPause(1500, 4000);
      }

      // 3c. Cek inventory
      let fishList = [];
      try {
        fishList = await api.listFish();
      } catch (e) {
        warn(acct.name, `   cek inventory gagal: ${e.message.slice(0, 60)}`);
      }
      info(acct.name, `   🐟 inventory: ${fishList.length} ikan`);

      // 3d. Jual kalo >= threshold
      if (fishList.length >= SELL_THRESHOLD) {
        const uids = fishList.map((f) => f.uid).filter(Boolean);
        info(acct.name, `   💰 jual ${uids.length} ikan...`);
        // Batch by 100 (server limit max 500)
        let totalSold = 0;
        for (let i = 0; i < uids.length; i += 100) {
          const batch = uids.slice(i, i + 100);
          try {
            await api.sellFish(batch);
            totalSold += batch.length;
            await actionPause(1500, 3500);
          } catch (e) {
            warn(acct.name, `   jual batch ${i / 100 + 1} gagal: ${e.message.slice(0, 60)}`);
          }
        }
        ok(acct.name, `   ✅ ${totalSold} ikan laku`);
      } else {
        info(acct.name, `   skip jual (kurang dari ${SELL_THRESHOLD})`);
      }

      // 3e. Exit kalo --once (smoke test)
      if (ONCE && cycle >= 3) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        banner(`\n■ ${acct.name} — selesai smoke test (${cycle} cycle, ${elapsed}s)`);
        return;
      }

      // 3f. Humanized sleep (8% chance long pause 10-16s)
      const sleepSec = maybeSkip(0.08)
        ? (10 + Math.random() * 6).toFixed(1)
        : (4 + Math.random() * 4).toFixed(1);
      info(acct.name, `   😴 tidur ${sleepSec}s...\n`);
      await actionPause(
        maybeSkip(0.08) ? 10000 : 4000,
        maybeSkip(0.08) ? 16000 : 8000,
      );
    } catch (e) {
      err(acct.name, `❌ cycle ${cycle} error: ${e.message.slice(0, 100)}`);
      // Token ditolak server (401) → bersihkan cache, login ulang cycle berikut
      if (e.status === 401) {
        warn(acct.name, `   token ditolak, hapus cache + retry login cycle berikut`);
        clearToken(acct.name);
        // Loop ulang: cycle berikut akan coba login ulang otomatis
        await actionPause(5000, 10000);
        try {
          sess = await login(acct);
        } catch (e2) {
          err(acct.name, `   re-login gagal: ${e2.message.slice(0, 60)}`);
          return;
        }
      } else {
        // Error lain (network, 5xx) → tunggu lama, retry
        await actionPause(15000, 30000);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
//
// 1. Banner startup
// 2. Load accounts.json
// 3. Filter yang enabled, dan --account filter kalo ada
// 4. Auth-only mode? → cuma login semua akun, terus exit
// 5. Normal mode → jalanin semua akun paralel via Promise.all
//
async function main() {
  banner('========================================');
  banner('  VoxelFishing Bot — Simple');
  banner('========================================');
  console.log();

  // Parse flags
  if (NO_PROXY)  warn('', '⚠ --no-proxy aktif: semua akun pakai direct (abaikan "proxy" di JSON)');
  if (ONLY_ACCOUNT) info('', `▶ cuma akun: ${ONLY_ACCOUNT}`);
  if (ONCE) info('', '⚠ --once: 3 cycle per akun, terus exit');
  if (AUTH_ONLY) info('', '⚠ --auth-only: cuma login, terus exit');

  // Load accounts
  let accounts;
  try {
    accounts = loadAccounts();
  } catch (e) {
    err('', `❌ ${e.message}`);
    console.log();
    console.log('Belum ada akun? Tambah dengan:');
    console.log('  $ npm run add-account');
    console.log();
    console.log('Atau copy template dulu:');
    console.log('  $ cp accounts.example.json accounts.json');
    process.exit(1);
  }

  // Filter --account
  if (ONLY_ACCOUNT) {
    accounts = accounts.filter((a) => a.name === ONLY_ACCOUNT);
    if (accounts.length === 0) {
      err('', `❌ akun "${ONLY_ACCOUNT}" gak ada di accounts.json`);
      console.log('Akun yang ada:', accounts.map((a) => a.name).join(', ') || '(kosong)');
      console.log('Lihat semua akun: npm run accounts');
      process.exit(1);
    }
  }

  // Filter enabled
  const active = accounts.filter((a) => a.enabled !== false);
  const disabled = accounts.filter((a) => a.enabled === false);

  console.log();
  banner(`▶ ${active.length} akun aktif: ${active.map((a) => a.name).join(', ') || '(kosong)'}`);
  if (disabled.length > 0) {
    console.log(`  ${T.dim}${disabled.length} akun disabled: ${disabled.map((a) => a.name).join(', ')}${T.reset}`);
  }
  console.log();

  if (active.length === 0) {
    err('', '❌ gak ada akun aktif');
    console.log('Aktifkan akun dengan: npm run enable -- <nama>');
    console.log('Atau tambah baru:      npm run add-account');
    process.exit(1);
  }

  // Auth-only mode: refresh token semua akun, terus exit
  if (AUTH_ONLY) {
    for (const acct of active) {
      try {
        await login(acct);
      } catch (e) {
        err(acct.name, `❌ login gagal: ${e.message}`);
      }
    }
    ok('', '✅ auth-only done.');
    return;
  }

  // Normal mode: jalanin semua akun paralel
  banner('▶ mulai parallel run...');
  await Promise.all(active.map(runAccount));
  ok('', '✅ semua akun selesai.');
}

main().catch((e) => {
  console.error(`${T.red}FATAL: ${e.message}${T.reset}`);
  console.error(e.stack);
  process.exit(1);
});