#!/usr/bin/env node
// scripts/add-account.js — interactive wizard
// Append a new account to accounts.json.
//
// Usage:
//   npm run add-account
//   npm run add-account -- --no-wallet          # name + proxy only (paste wallet later)
//   npm run add-account -- --name alt --wallet 5xK9... --proxy socks5://...
//
// Flags (all optional, can be passed non-interactively):
//   --name <name>      Account name
//   --wallet <key>     Wallet private key (base58/JSON/base64/hex)
//   --proxy <url>      socks5:// or http:// proxy, empty for none
//   --enabled          (default) — start the account enabled
//   --disabled         start disabled
//   --cast-mode <m>    magnet (default) | rod
//
// Wallet input is hidden by default (* masked). Pass --no-hide to echo.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import JSON5 from 'json5';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ACCOUNTS = path.join(ROOT, 'accounts.json');

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const val = (k, def) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : def;
};

function die(msg, code = 1) {
  console.error(`${T.red}error: ${msg}${T.reset}`);
  process.exit(code);
}

function loadExisting() {
  if (!fs.existsSync(ACCOUNTS)) return [];
  const txt = fs.readFileSync(ACCOUNTS, 'utf8');
  if (!txt.trim()) return [];
  // JSON5 so // comments + trailing commas still parse
  const parsed = JSON5.parse(txt);
  if (!Array.isArray(parsed)) die('accounts.json must be a JSON array');
  return parsed;
}

function appendToArray(txt, newEntryObj) {
  // Find root array start: first '[' at the start of a line (after optional // comments)
  // Find root array end: last ']' on its own line
  const lines = txt.split('\n');
  let startLine = -1, endLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startLine < 0 && /^\s*\[\s*$/.test(lines[i])) startLine = i;
    if (/^\s*\]\s*$/.test(lines[i])) endLine = i;
  }
  const entryTxt = JSON.stringify(newEntryObj, null, 2)
    .split('\n').map((l) => '  ' + l).join('\n');

  if (startLine < 0 || endLine < 0 || endLine < startLine) {
    // No root array — wrap
    return `[\n  ${JSON.stringify(newEntryObj, null, 2)}\n]\n`;
  }
  const before = lines.slice(0, endLine).join('\n').replace(/,\s*$/, '');
  const hasContent = before.replace(/\[[\s\n]/g, '').trim().length > 0;
  const sep = hasContent ? ',\n' : '\n';
  return before + sep + entryTxt + '\n' + lines.slice(endLine).join('\n');
}

async function ask(q, def = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = def ? `${T.cyan}?${T.reset} ${q} ${T.dim}[${def}]${T.reset}: ` : `${T.cyan}?${T.reset} ${q}: `;
    rl.question(prompt, (a) => { rl.close(); resolve((a || def).trim()); });
  });
}

async function askHidden(q) {
  process.stdout.write(`${T.cyan}?${T.reset} ${q}: `);
  const stdin = process.stdin;
  const hadRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();
  let buf = '';
  return new Promise((resolve) => {
    const onData = (ch) => {
      const c = ch.toString('utf8');
      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (stdin.setRawMode) stdin.setRawMode(hadRaw || false);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        resolve(buf);
      } else if (c === '\u0003') {
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
        if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        buf += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  console.log(`${T.magenta}=== VoxelFishing: add account ===${T.reset}\n`);

  const existing = loadExisting();
  if (existing.length === 0 && !fs.existsSync(ACCOUNTS)) {
    console.log(`${T.dim}(no accounts.json yet — will create)${T.reset}`);
  } else {
    console.log(`${T.dim}existing: ${existing.map(a => a.name).join(', ') || '(empty array)'}${T.reset}`);
  }
  console.log();

  // ── collect fields (CLI flags or interactive prompts) ──────────────────
  let name = val('--name');
  if (name) {
    console.log(`${T.dim}name:     ${name} (from --name)${T.reset}`);
  } else {
    while (true) {
      name = await ask('Account name (used in logs, must be unique)');
      if (!name) { console.log(`${T.red}name required${T.reset}`); continue; }
      if (existing.some(a => a.name === name)) {
        console.log(`${T.red}name "${name}" already exists${T.reset}`); continue;
      }
      break;
    }
  }

  let wallet = val('--wallet');
  if (wallet) {
    console.log(`${T.dim}wallet:   ${wallet.slice(0, 6)}…${wallet.slice(-4)} (from --wallet)${T.reset}`);
  } else if (flag('--no-wallet')) {
    wallet = '<YOUR_PHANTOM_PRIVATE_KEY>';
    console.log(`${T.dim}wallet:   <placeholder — paste later>${T.reset}`);
  } else {
    wallet = await askHidden('Wallet private key (Phantom — any format, ENTER to skip)');
    if (!wallet) wallet = '<YOUR_PHANTOM_PRIVATE_KEY>';
  }

  let proxy;
  if (argv.indexOf('--proxy') >= 0) {
    proxy = val('--proxy', '');
    console.log(`${T.dim}proxy:${T.reset}    ${proxy || '(none)'} ${T.dim}(from --proxy)${T.reset}`);
  } else {
    proxy = await ask('Proxy URL (socks5:// or http://, ENTER to skip)');
  }

  let enabled;
  if (flag('--disabled')) enabled = false;
  else if (flag('--enabled')) enabled = true;
  else {
    const e = await ask('Enabled?', 'y');
    enabled = /^(y|yes|1|true)$/i.test(e);
  }

  let castMode = val('--cast-mode');
  if (castMode) {
    console.log(`${T.dim}castMode: ${castMode} (from --cast-mode)${T.reset}`);
  } else {
    castMode = (await ask('Cast mode (magnet / rod)', 'magnet')).toLowerCase();
  }
  if (!['magnet', 'rod'].includes(castMode)) die(`invalid castMode: ${castMode}`);

  // ── confirm + save ─────────────────────────────────────────────────────
  const newEntry = {
    name,
    wallet,
    proxy: proxy || null,
    enabled,
    castMode,
  };
  console.log(`\n${T.dim}--- new account ---${T.reset}`);
  console.log(`  ${T.dim}name:${T.reset}     ${name}`);
  console.log(`  ${T.dim}wallet:${T.reset}   ${wallet.length > 14 ? wallet.slice(0, 6) + '…' + wallet.slice(-4) : wallet}`);
  console.log(`  ${T.dim}proxy:${T.reset}    ${proxy || '(none)'}`);
  console.log(`  ${T.dim}enabled:${T.reset}  ${enabled}`);
  console.log(`  ${T.dim}castMode:${T.reset} ${castMode}`);
  const confirm = await ask('\nSave?', 'y');
  if (!/^(y|yes|1|true)$/i.test(confirm)) {
    console.log(`${T.yellow}aborted${T.reset}`);
    process.exit(0);
  }

  if (fs.existsSync(ACCOUNTS)) {
    const txt = fs.readFileSync(ACCOUNTS, 'utf8');
    const newTxt = appendToArray(txt, newEntry);
    fs.writeFileSync(ACCOUNTS, newTxt, { mode: 0o600 });
  } else {
    fs.writeFileSync(ACCOUNTS, `[\n  ${JSON.stringify(newEntry, null, 2)}\n]\n`, { mode: 0o600 });
  }
  console.log(`\n${T.green}✅ account "${name}" added (${existing.length + 1} total)${T.reset}`);
  console.log(`${T.dim}run with:  npm run account -- ${name}${T.reset}`);
  console.log(`auth with: ${T.green}npm run auth -- --account ${name}${T.reset}`);
})().catch((e) => die(e.message || e));
