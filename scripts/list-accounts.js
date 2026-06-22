#!/usr/bin/env node
// scripts/list-accounts.js — overview of accounts.json
//
//   npm run accounts
//   npm run accounts -- --json          # JSON output (for scripts)
//   npm run accounts -- --no-tokens     # skip token-status check
//
// Columns: # | name | enabled | castModes | memeMode | proxy | token | wallet

import { loadAccounts, loadTokens, PATHS } from '../lib/accounts.js';
import fs from 'fs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const skipTokens = argv.includes('--no-tokens') || !fs.existsSync(PATHS.tokens);

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m',
};

let accounts;
try {
  accounts = loadAccounts();
} catch (e) {
  console.error(`${T.red}error: ${e.message}${T.reset}`);
  process.exit(1);
}
const tokens = skipTokens ? {} : loadTokens();

if (asJson) {
  console.log(JSON.stringify(accounts.map((a) => ({
    name: a.name,
    enabled: a.enabled,
    castModes: a.castModes || (a.castMode ? [a.castMode] : ['magnet']),
    magnetMode: a.magnetMode,
    memeMode: a.memeMode,
    sellMode: a.sellMode,
    proxy: a.proxy,
    hasToken: !!tokens[a.name],
    walletPrefix: a.wallet?.slice(0, 6) + '…' + a.wallet?.slice(-4),
  })), null, 2));
  process.exit(0);
}

if (accounts.length === 0) {
  console.log(`${T.yellow}(no accounts)${T.reset}`);
  console.log(`${T.dim}add one with: npm run add-account${T.reset}`);
  process.exit(0);
}

console.log(`${T.cyan}=== VoxelFishing: ${accounts.length} account(s) ===${T.reset}\n`);

const header = ['#', 'name', 'enabled', 'cast', 'meme', 'proxy', 'token', 'wallet'];
const widths = [3, 14, 7, 12, 10, 22, 5, 14];
const pad = (s, w) => String(s ?? '—').padEnd(w).slice(0, w);

console.log(T.dim + header.map((h, i) => pad(h, widths[i])).join('  ') + T.reset);
console.log(T.dim + widths.map((w) => '─'.repeat(w)).join('  ') + T.reset);

for (let i = 0; i < accounts.length; i++) {
  const a = accounts[i];
  const hasToken = !!tokens[a.name];
  const tokChar = hasToken ? '✓' : '✗';
  const tokColor = hasToken ? T.green : T.red;
  const enabledColor = a.enabled ? T.reset : T.gray;
  const walletPrefix = a.wallet?.length > 14
    ? a.wallet.slice(0, 6) + '…' + a.wallet.slice(-4)
    : (a.wallet || '—');
  const proxy = a.proxy || '—';
  const row = [
    pad(i + 1, widths[0]),
    enabledColor + pad(a.name, widths[1]) + T.reset,
    pad(a.enabled ? '✓' : '·', widths[2]),
    pad(a.castModes?.join('+') || 'magnet', widths[3]),
    pad(a.memeMode || 'off', widths[4]),
    pad(proxy, widths[5]),
    tokColor + pad(tokChar, widths[6]) + T.reset,
    pad(walletPrefix, widths[7]),
  ];
  console.log(row.join('  '));
}

const noToken = accounts.filter((a) => !tokens[a.name] && a.enabled);
if (noToken.length > 0) {
  console.log(`\n${T.yellow}⚠ ${noToken.length} account(s) missing token:${T.reset} ${noToken.map((a) => a.name).join(', ')}`);
  console.log(`${T.dim}  refresh with: npm run auth:v2 -- --account <name>${T.reset}`);
}
