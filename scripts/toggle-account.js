#!/usr/bin/env node
// scripts/toggle-account.js — flip enabled flag for a single account
//
//   npm run enable  -- <name>           # set enabled = true
//   npm run disable -- <name>           # set enabled = false
//   npm run toggle  -- <name>           # flip current value
//
// Surgical edit via jsonc-parser preserves JSON5 comments.

import { loadAccounts, saveAccounts, PATHS } from '../lib/accounts.js';
import path from 'path';

const argv = process.argv.slice(2);
const script = path.basename(process.argv[1]);
const mode = script.includes('enable') && !script.includes('disable') ? 'enable'
           : script.includes('disable') ? 'disable'
           : 'toggle';

const name = argv[0];
if (!name) {
  console.error(`usage: npm run ${mode === 'toggle' ? 'toggle' : mode} -- <account-name>`);
  process.exit(1);
}

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

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

const before = accounts[idx].enabled;
let after;
if (mode === 'enable') after = true;
else if (mode === 'disable') after = false;
else after = !before;

if (before === after) {
  console.log(`${T.dim}no change: "${name}" already ${after ? 'enabled' : 'disabled'}${T.reset}`);
  process.exit(0);
}

accounts[idx] = { ...accounts[idx], enabled: after };
saveAccounts(accounts);
const sym = after ? '✓' : '·';
const color = after ? T.green : T.yellow;
console.log(`${color}${sym} "${name}" ${after ? 'enabled' : 'disabled'}${T.reset}`);
console.log(`${T.dim}run with: npm run account -- ${name}${T.reset}`);
