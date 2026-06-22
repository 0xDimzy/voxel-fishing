#!/usr/bin/env node
// scripts/setup-wizard.js — first-time setup for new users
//
// Walks through:
//   1. Check accounts.json exists (copy template if not)
//   2. Add first account (or fix placeholder wallet)
//   3. Test sign-in (--auth-only)
//   4. Show next steps
//
// Usage:
//   npm run setup
//   npm run setup -- --reset   # force overwrite accounts.json
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import JSON5 from 'json5';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ACCOUNTS = path.join(ROOT, 'accounts.json');
const EXAMPLE = path.join(ROOT, 'accounts.example.json');

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};

function ask(q, def = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = def ? `${T.cyan}?${T.reset} ${q} ${T.dim}[${def}]${T.reset}: ` : `${T.cyan}?${T.reset} ${q}: `;
    rl.question(prompt, (ans) => {
      rl.close();
      resolve((ans || def).trim());
    });
  });
}

function ok(m)   { console.log(`${T.green}✓${T.reset} ${m}`); }
function warn(m) { console.log(`${T.yellow}!${T.reset} ${m}`); }
function err(m)  { console.log(`${T.red}✗${T.reset} ${m}`); }
function info(m) { console.log(`${T.cyan}·${T.reset} ${m}`); }
function head(m) { console.log(`${T.magenta}${m}${T.reset}`); }

(async () => {
  const RESET = process.argv.includes('--reset');

  console.log();
  head('════════════════════════════════════════════════════════');
  head('  VoxelFishing Bot — Setup Wizard');
  head('════════════════════════════════════════════════════════');
  console.log();

  // ─── Step 1: ensure accounts.json exists ─────────────────────────────
  if (!fs.existsSync(ACCOUNTS) || RESET) {
    if (!fs.existsSync(EXAMPLE)) {
      err(`accounts.example.json not found at ${EXAMPLE}`);
      process.exit(1);
    }
    if (RESET && fs.existsSync(ACCOUNTS)) {
      warn(`--reset: backing up accounts.json to accounts.json.bak`);
      fs.copyFileSync(ACCOUNTS, path.join(ROOT, `accounts.json.bak.${Date.now()}`));
    }
    fs.copyFileSync(EXAMPLE, ACCOUNTS);
    fs.chmodSync(ACCOUNTS, 0o600);
    ok(`copied accounts.example.json → accounts.json`);
  } else {
    ok(`accounts.json exists (${fs.statSync(ACCOUNTS).size} bytes)`);
  }

  // ─── Step 2: parse + check for placeholder ────────────────────────────
  let accounts;
  try {
    accounts = JSON5.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
  } catch (e) {
    err(`accounts.json parse error: ${e.message}`);
    process.exit(1);
  }

  const placeholderIdx = accounts.findIndex(
    (a) => a.wallet && /placeholder|your_|example|sample/i.test(a.wallet),
  );
  const hasPlaceholder = placeholderIdx >= 0;
  const noAccounts = accounts.length === 0;

  if (noAccounts) {
    warn('accounts.json kosong — belum ada akun');
  } else if (hasPlaceholder) {
    warn(`akun "${accounts[placeholderIdx].name}" masih pakai wallet placeholder`);
  } else {
    ok(`${accounts.length} akun loaded: ${accounts.map((a) => a.name).join(', ')}`);
  }

  console.log();

  // ─── Step 3: add or fix first account ─────────────────────────────────
  if (noAccounts || hasPlaceholder) {
    console.log('Tambahin akun pertama lo. Kalo Phantom lo lagi kebuka di browser,');
    console.log('bisa langsung export private key dari extension (Settings → Export Private Key).');
    console.log(`${T.dim}Format apapun diterima (base58, JSON array, base64, hex).${T.reset}`);
    console.log();

    const name = await ask('Nama akun (misal: utama, alt, ess)');
    if (!name) { err('nama gak boleh kosong'); process.exit(1); }

    if (accounts.some((a) => a.name === name)) {
      warn(`nama "${name}" udah ada di accounts.json`);
    }

    // Hidden input for wallet (mask with *)
    process.stdout.write(`${T.cyan}?${T.reset} Phantom private key (paste, hidden): `);
    let wallet = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    await new Promise((resolve) => {
      const onData = (ch) => {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r' || c === '\u0004') {
          if (stdin.setRawMode) stdin.setRawMode(wasRaw || false);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve();
        } else if (c === '\u0003') {
          process.exit(130);
        } else if (c === '\u007f' || c === '\b') {
          wallet = wallet.slice(0, -1);
          process.stdout.write('\b \b');
        } else {
          wallet += c;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    });
    if (!wallet) { err('wallet gak boleh kosong'); process.exit(1); }

    const proxy = await ask('Proxy URL (socks5://user:pass@host:1080) atau ENTER untuk direct');

    const newAcct = {
      name,
      wallet,
      proxy: proxy || null,
      enabled: true,
    };

    // ─── Persist ────────────────────────────────────────────────────────
    if (hasPlaceholder) {
      // Replace placeholder account via surgical jsonc edit (preserves comments)
      const placeholderPath = [placeholderIdx];
      const { default: jsonc } = await import('jsonc-parser');
      const edits = jsonc.modify(fs.readFileSync(ACCOUNTS, 'utf8'), placeholderPath, newAcct, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      let newTxt = fs.readFileSync(ACCOUNTS, 'utf8');
      if (edits && edits.length > 0) {
        newTxt = jsonc.applyEdits(newTxt, edits);
      }
      fs.writeFileSync(ACCOUNTS, newTxt, { mode: 0o600 });
      fs.chmodSync(ACCOUNTS, 0o600);
      info(`replaced placeholder account "${name}" (comments preserved)`);
    } else {
      // Append new account via surgical array-append (preserves comments)
      const { appendAccountToJson5 } = await import('./_append.js');
      appendAccountToJson5(ACCOUNTS, newAcct);
      info(`added account "${name}" (comments preserved)`);
    }
  }

  console.log();

  // ─── Step 4: test sign-in ─────────────────────────────────────────────
  const testIt = await ask('Test sign-in sekarang? (--auth-only)', 'y');
  if (/^(y|yes|1|true)$/i.test(testIt)) {
    console.log();
    info('starting auth test (Ctrl+C untuk skip)...');
    const { spawn } = await import('child_process');
    const child = spawn('node', ['bot.js', '--auth-only'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) ok('sign-in OK');
      else warn(`sign-in exited code=${code} (cek wallet / proxy / network)`);

      console.log();
      head('════════════════════════════════════════════════════════');
      head('  Setup selesai. Next steps:');
      head('════════════════════════════════════════════════════════');
      console.log(`
  ${T.cyan}npm run start${T.reset}              jalanin semua akun (parallel)
  ${T.cyan}npm run once${T.reset}               smoke test (3 cycle per akun)
  ${T.cyan}npm run accounts${T.reset}           lihat semua akun
  ${T.cyan}npm run add-account${T.reset}        tambah akun baru
  ${T.cyan}npm run start -- --no-proxy${T.reset}        paksa direct (override proxy)
  ${T.cyan}npm run start -- --account utama${T.reset}  cuma akun tertentu
`);
    });
  } else {
    console.log();
    head('Setup selesai. Next:');
    console.log(`  ${T.cyan}npm run auth${T.reset}    test sign-in`);
    console.log(`  ${T.cyan}npm run start${T.reset}   jalanin bot`);
  }
})();