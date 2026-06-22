// lib/accounts.js
// Load + persist account list and tokens.
//
// accounts.json structure:
// [
//   {
//     "name": "main",
//     "wallet": "<base58/JSON/base64 Phantom private key>",
//     "proxy": "socks5://user:pass@host:port",     // optional, omit for direct
//     "character": {                               // optional
//       "mode": "skip" | "config" | "auto",
//       "name": "Captain",                         // 1-24 chars
//       "boat": "tugboat",                         // see lib/character.js
//       "hull": "#a9743f",                         // #RRGGBB
//       "accent": "#7fd4e8",                       // #RRGGBB
//       "playerId": "p-..."                        // optional, auto-generated
//     },
//     "claimGrants": true,
//     "claimRelicSet": true,
//     "magnetMode": "on" | "off",
//     "memeMode": "off" | "parallel",
//     "sellMode": "auto" | "threshold" | "off",
//     "sellMaxRarity": "rare" | "epic" | ...,
//     "consumeAbyssLurker": true,
//     "sellPets": "off" | "auto"
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

/**
 * Load accounts.json, preserving the `character` field (and any other
 * future field that the bot understands) verbatim. Unknown fields are
 * preserved too so the user's config survives round-trips.
 */
export function loadAccounts() {
  if (!fs.existsSync(PATHS.accounts)) {
    throw new Error(`accounts.json not found at ${PATHS.accounts}`);
  }
  const txt = fs.readFileSync(PATHS.accounts, 'utf8');
  const parsed = JSON.parse(txt);
  if (!Array.isArray(parsed)) {
    throw new Error('accounts.json must be a JSON array');
  }
  return parsed.map((a, i) => {
    // Defaults for top-level convenience fields
    const out = {
      name: a.name || `account-${i + 1}`,
      wallet: a.wallet || a.privateKey,
      proxy: a.proxy || null,
      enabled: a.enabled !== false,
      claimGrants: a.claimGrants !== false,
      claimRelicSet: a.claimRelicSet !== false,
      magnetMode: a.magnetMode || 'on',
      memeMode: a.memeMode || 'off',
      memeMaxPerCycle: Number.isFinite(a.memeMaxPerCycle) ? a.memeMaxPerCycle : 1,
      sellMode: a.sellMode || 'auto',
      sellThreshold: Number.isFinite(a.sellThreshold) ? a.sellThreshold : 50,
      sellMaxRarity: a.sellMaxRarity || 'rare',
      keepMythics: a.keepMythics !== false,
      consumeAbyssLurker: a.consumeAbyssLurker !== false,
      consumeTargets: Array.isArray(a.consumeTargets) ? a.consumeTargets
        : (a.consumeAbyssLurker !== false ? ['abysslurker'] : []),
      sellPets: a.sellPets || 'off',
    };
    // Preserve all other fields as-is (character, plus any user-added
    // experimental flags). Spread last so explicit out defaults win on
    // collisions with the same key (defensive).
    for (const [k, v] of Object.entries(a)) {
      if (!(k in out)) out[k] = v;
    }
    return out;
  });
}

/**
 * Persist accounts.json (used by writeback — e.g. character auto-update).
 * Uses tmp+rename for atomic write. Preserves the original field order of
 * the first account to keep diffs small.
 */
export function saveAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error('saveAccounts: expected an array');
  }
  const txt = JSON.stringify(accounts, null, 2) + '\n';
  const tmp = PATHS.accounts + '.tmp';
  fs.writeFileSync(tmp, txt, { mode: 0o600 });
  fs.renameSync(tmp, PATHS.accounts);
}

/**
 * Update a single account's character block in-place and persist.
 * Returns the updated accounts list.
 */
export function updateAccountCharacter(acctName, character) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.name === acctName);
  if (idx < 0) throw new Error(`updateAccountCharacter: account "${acctName}" not found`);
  accounts[idx] = { ...accounts[idx], character };
  saveAccounts(accounts);
  return accounts;
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
