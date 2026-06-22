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
const META_KEY = /^[A-Za-z]?_/;  // matches _doc, _comment, __doc, etc — any field whose name starts with optional letter then underscore is documentation

/**
 * Strip documentation keys (anything matching META_KEY) from a parsed object.
 * Used at load time so runtime code never sees `_comment`/`_doc` fields.
 * Recurses into nested objects (character.* block) but leaves arrays alone
 * (we don't want to drop valid list items that happen to start with _).
 */
function stripMeta(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (META_KEY.test(k)) continue;
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? stripMeta(v) : v;
  }
  return out;
}

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
    // Strip documentation keys first so they never reach runtime defaults
    const clean = stripMeta(a);
    // Defaults for top-level convenience fields
    const out = {
      name: clean.name || `account-${i + 1}`,
      wallet: clean.wallet || clean.privateKey,
      proxy: clean.proxy || null,
      enabled: clean.enabled !== false,
      claimGrants: clean.claimGrants !== false,
      claimRelicSet: clean.claimRelicSet !== false,
      magnetMode: clean.magnetMode || 'on',
      memeMode: clean.memeMode || 'off',
      memeMaxPerCycle: Number.isFinite(clean.memeMaxPerCycle) ? clean.memeMaxPerCycle : 1,
      sellMode: clean.sellMode || 'auto',
      sellThreshold: Number.isFinite(clean.sellThreshold) ? clean.sellThreshold : 50,
      sellMaxRarity: clean.sellMaxRarity || 'rare',
      keepMythics: clean.keepMythics !== false,
      consumeAbyssLurker: clean.consumeAbyssLurker !== false,
      consumeTargets: Array.isArray(clean.consumeTargets) ? clean.consumeTargets
        : (clean.consumeAbyssLurker !== false ? ['abysslurker'] : []),
      sellPets: clean.sellPets || 'off',
      castMode: clean.castMode || 'magnet',  // 'magnet' (default) | 'rod' — see bot-v2.js dispatch
    };
    // Preserve all other fields as-is (character, plus any user-added
    // experimental flags). Spread last so explicit out defaults win on
    // collisions with the same key (defensive).
    for (const [k, v] of Object.entries(clean)) {
      if (!(k in out)) out[k] = v;
    }
    return out;
  });
}

/**
 * Persist accounts.json (used by writeback — e.g. character auto-update).
 *
 * Preserves `_doc`/`_comment` fields by patching the raw file in place
 * (read → find account by name → merge updated fields → write back). This
 * way the bot's runtime never sees the docs, but they survive writebacks
 * triggered by character auto-detection.
 */
export function saveAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error('saveAccounts: expected an array');
  }
  // Read raw file to preserve _comment/_doc fields + field order
  let raw = [];
  if (fs.existsSync(PATHS.accounts)) {
    try { raw = JSON.parse(fs.readFileSync(PATHS.accounts, 'utf8')); }
    catch { raw = []; }
  }
  if (!Array.isArray(raw)) raw = [];
  // Merge: keep original raw entry (with its _comment fields), overlay updated
  // fields from runtime. Match by `name` so order/duplication don't matter.
  // Append any new runtime accounts that aren't in the raw file.
  const updatedByName = new Map(accounts.map((a) => [a.name, a]));
  const merged = [];
  const seen = new Set();
  for (const origEntry of raw) {
    const updated = updatedByName.get(origEntry.name);
    if (updated) {
      seen.add(origEntry.name);
      merged.push({ ...origEntry, ...updated });
    } else {
      merged.push(origEntry);
    }
  }
  for (const a of accounts) {
    if (!seen.has(a.name)) merged.push(a);
  }
  const txt = JSON.stringify(merged, null, 2) + '\n';
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
