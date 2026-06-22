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
import JSON5 from 'json5';
import * as jsonc from 'jsonc-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PATHS = {
  accounts: path.join(ROOT, 'accounts.json'),
  tokens: path.join(ROOT, 'tokens.json'),
};

const META_KEY = /^[A-Za-z]?_/;  // matches _doc, _comment, __doc, etc — documentation fields, stripped at load time

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
  const parsed = JSON5.parse(txt);  // JSON5 allows // comments
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
      // proxy must be a non-empty URL string. Treat string "null"/"undefined"/""/etc
      // as no proxy — undici's ProxyAgent throws "Invalid URL" on those.
      proxy: (typeof clean.proxy === 'string' && clean.proxy && clean.proxy !== 'null' && clean.proxy !== 'undefined')
        ? clean.proxy : null,
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
      // Cast modes per cycle. Array of strings: 'magnet' | 'meme' | 'rod'.
      //   - 'magnet' = magnet-cast (uses magnet item, free)
      //   - 'meme'   = meme-cast (uses meme token, paid) — 'rod' is alias
      //   - 'rod'    = alias for 'meme' (legacy name from castMode field)
      // Default: ['magnet']. To do BOTH per cycle: ["magnet", "meme"].
      // Backward compat: old `castMode: "magnet"` (string) is treated as
      // `castModes: ["magnet"]` (single-element array).
      castModes: Array.isArray(clean.castModes) && clean.castModes.length > 0
        ? clean.castModes.map((m) => m === 'rod' ? 'meme' : m).filter((m) => ['magnet', 'meme'].includes(m))
        : (clean.castMode
            ? [clean.castMode === 'rod' ? 'meme' : clean.castMode].filter((m) => ['magnet', 'meme'].includes(m))
            : ['magnet']),
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
 * Uses jsonc-parser for surgical edits so // comments in the file survive
 * round-trips. Each account is located by `name` and patched in place
 * using JSON path syntax (`[<idx>]` for the account, `.field` for sub-keys).
 * If the file doesn't exist or parse fails, falls back to clean write.
 */
export function saveAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error('saveAccounts: expected an array');
  }
  if (!fs.existsSync(PATHS.accounts)) {
    // No file yet — clean write (comments will appear once user adds them)
    fs.writeFileSync(PATHS.accounts, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
    return;
  }
  const txt = fs.readFileSync(PATHS.accounts, 'utf8');
  let raw;
  try { raw = JSON5.parse(txt); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];

  // Index raw accounts by name → position in array (for jsonc paths)
  const rawByName = new Map();
  raw.forEach((a, i) => { if (a && a.name) rawByName.set(a.name, i); });

  let newTxt = txt;
  for (const updated of accounts) {
    const idx = rawByName.get(updated.name);
    if (idx === undefined) continue;  // new account — skip (no path to edit)
    // Build a patch from updated account, scoped to this index.
    // Apply each top-level field via jsonc-parser so comments survive.
    for (const [key, value] of Object.entries(updated)) {
      const path = [idx, key];
      const edits = jsonc.modify(newTxt, path, value, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      if (edits && edits.length > 0) {
        newTxt = jsonc.applyEdits(newTxt, edits);
      }
    }
  }

  // ── Removal pass ──────────────────────────────────────────────────────
    // If updated list is shorter than raw list, some accounts were removed.
    // jsonc-parser can't surgically delete array elements while preserving
    // comments inside them. Trade-off: removed entries' comments inside their
    // own block are lost (we re-emit cleanly), but top-level header comments
    // and comments inside surviving entries survive via jsonc-parser above.
    const updatedNames = new Set(accounts.map((a) => a.name));
    const removedIndices = [];
    raw.forEach((a, i) => { if (a && a.name && !updatedNames.has(a.name)) removedIndices.push(i); });

    if (removedIndices.length > 0) {
      // Parse the (already-modified) text and rebuild array without removed entries.
      let parsed;
      try { parsed = JSON5.parse(newTxt); } catch { parsed = null; }
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((_, i) => !removedIndices.includes(i));
        // Extract top-level header (lines BEFORE the root array). The regex
        // matches everything up to AND INCLUDING the opening `[` line.
        const headerMatch = newTxt.match(/^([\s\S]*?^\s*\[\s*)$/m);
        const header = headerMatch ? headerMatch[1] : '[\n';
        // If header already includes `[`, don't add another one.
        const alreadyHasBracket = /\[\s*$/.test(header);
        const emitHeader = alreadyHasBracket ? header : header + '[\n';
        const emitEntries = filtered
          .map((a) => JSON.stringify(a, null, 2).split('\n').map((l) => '  ' + l).join('\n'))
          .join(',\n');
        // Strip trailing `]` from `emitHeader` (it will be re-appended)
        const headerNoClose = emitHeader.replace(/\[\s*$/, '[\n');
        newTxt = headerNoClose + emitEntries + '\n]\n';
      }
    }

  fs.writeFileSync(PATHS.accounts, newTxt, { mode: 0o600 });
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
