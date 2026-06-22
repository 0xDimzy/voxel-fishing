#!/usr/bin/env node
// scripts/remove-account.js — remove an account from accounts.json
//
//   npm run remove-account -- <name>             # with confirmation prompt
//   npm run remove-account -- <name> --force     # skip prompt
//   npm run remove-account -- <name> --keep-token  # don't clear tokens.json
//
// Surgical edit via jsonc-parser preserves JSON5 comments.

import { loadAccounts, saveAccounts, clearToken, loadTokens, PATHS } from '../lib/accounts.js';
import readline from 'readline';
import path from 'path';

const argv = process.argv.slice(2);
const name = argv[0];
const force = argv.includes('--force') || argv.includes('-y');
const keepToken = argv.includes('--keep-token');

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

if (!name) {
  console.error('usage: npm run remove-account -- <name> [--force] [--keep-token]');
  process.exit(1);
}

let accounts;
try {
  accounts = loadAccounts();
} catch (e) {
  console.error(`${T.red}error: ${e.message}${T.reset}`);
  process.exit(1);
}
const idx = accounts.findIndex((a) => a.name === name);
if (idx < 0) {
  console.error(`${T.red}no account named "${name}"${T.reset}`);
  console.error(`${T.dim}available: ${accounts.map((a) => a.name).join(', ')}${T.reset}`);
  process.exit(1);
}

const acct = accounts[idx];
console.log(`${T.yellow}about to remove:${T.reset}`);
console.log(`  name:     ${acct.name}`);
console.log(`  wallet:   ${acct.wallet?.slice(0, 6)}…${acct.wallet?.slice(-4) || ''}`);
console.log(`  enabled:  ${acct.enabled}`);

const tokens = loadTokens();
if (tokens[name] && !keepToken) {
  console.log(`  ${T.dim}token:    will also clear from tokens.json${T.reset}`);
}

if (!force) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((resolve) => rl.question(`${T.cyan}?${T.reset} confirm (yes): `, resolve));
  rl.close();
  if (ans.trim().toLowerCase() !== 'yes') {
    console.log(`${T.yellow}aborted${T.reset}`);
    process.exit(0);
  }
}

accounts.splice(idx, 1);
saveAccounts(accounts);
if (!keepToken && tokens[name]) clearToken(name);

console.log(`${T.green}✅ account "${name}" removed (${accounts.length} remaining)${T.reset}`);
