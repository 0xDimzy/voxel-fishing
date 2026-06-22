// lib/accounts.js
// Load + persist account list and tokens.
//
// accounts.json structure:
// [
//   {
//     "name": "main",
//     "wallet": "<base58/JSON/base64 Phantom private key>",
//     "proxy": "socks5://user:pass@host:1080",   // optional, omit for direct
//     "magnetMode": "auto",                      // "auto" | "manual" | "off"
//     "sellMode": "auto" | "threshold",
//     "sellThreshold": 10,                       // sell when fish count >= N
//     "claimGrants": true,
//     "shopBuy": false                           // auto-buy shop items
//   },
//   ...
// ]
//
// tokens.json is auto-written after successful sign-in:
// { "<name>": { "accessToken": "...", "address": "...", "savedAt": 1234567890 } }

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PATHS = {
  accounts: path.join(ROOT, 'accounts.json'),
  tokens: path.join(ROOT, 'tokens.json'),
};

export function loadAccounts() {
  if (!fs.existsSync(PATHS.accounts)) {
    throw new Error(`accounts.json not found at ${PATHS.accounts}`);
  }
  const txt = fs.readFileSync(PATHS.accounts, 'utf8');
  const parsed = JSON.parse(txt);
  if (!Array.isArray(parsed)) {
    throw new Error('accounts.json must be a JSON array');
  }
  return parsed.map((a, i) => ({
    name: a.name || `account-${i + 1}`,
    wallet: a.wallet || a.privateKey,
    proxy: a.proxy || null,
    magnetMode: a.magnetMode || 'auto',
    sellMode: a.sellMode || 'auto',
    sellThreshold: a.sellThreshold || 10,
    claimGrants: a.claimGrants !== false,
    shopBuy: a.shopBuy || false,
    enabled: a.enabled !== false,
  }));
}

export function loadTokens() {
  if (!fs.existsSync(PATHS.tokens)) return {};
  try {
    return JSON.parse(fs.readFileSync(PATHS.tokens, 'utf8'));
  } catch (_) {
    return {};
  }
}

export function saveToken(name, tokenData) {
  const all = loadTokens();
  all[name] = {
    ...tokenData,
    savedAt: Date.now(),
  };
  fs.writeFileSync(PATHS.tokens, JSON.stringify(all, null, 2));
}

export function getToken(name) {
  const all = loadTokens();
  return all[name] || null;
}

export function clearToken(name) {
  const all = loadTokens();
  delete all[name];
  fs.writeFileSync(PATHS.tokens, JSON.stringify(all, null, 2));
}
