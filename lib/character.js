// lib/character.js
// VoxelFishing character config: name + boat + 2 colors.
//
// Server model (reverse-engineered from /assets/index-C9LxatAm.js, 2026-06-22):
//   The client sends ALL character state in a single hello message on WS open:
//     {t:"hello", playerId, name, level, boatType, hull, accent, aura, activePet, authToken, reconnectToken}
//   Server STORES character per playerId and re-broadcasts it on every `players`
//   tick — including the player's own row. So to learn the server's current
//   character for a player, open a WS, send a minimal hello (no character
//   fields), wait for the first `players` snapshot, and read the row matching
//   the `you` connId from the `welcome` message.
//
//   Detection: high-confidence (server is source of truth, returns it directly).
//   Update: send `rename` (name only) and `appearance` (boatType + hull + accent)
//   as separate messages — these are applied immediately and re-broadcast.
//
// Setup modes:
//   skip   (default) → detect only, never send rename/appearance. Use when the
//                      user manages character via the browser and the bot
//                      should not touch it.
//   config           → detect, compare to accounts.json, force-update on every
//                      run if different.
//   auto             → detect, compare to .hermes/character-<id>.json state
//                      cache, only update if config differs from last-applied.
//                      Idempotent across runs. First run sets + writes state.
//
// Data reverse-engineered from /assets/index-C9LxatAm.js (2026-06-22).

import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// === Free boats (no price, selectable by default) ===
export const FREE_BOATS = [
  { id: 'tugboat',     name: 'Tugboat',      blurb: 'Chunky harbour classic' },
  { id: 'sailboat',    name: 'Sailboat',     blurb: 'Breezy and graceful' },
  { id: 'fishingBoat', name: 'Fishing Boat', blurb: 'Built for the catch' },
  { id: 'speedboat',   name: 'Speedboat',    blurb: 'Zippy little racer' },
  { id: 'pirateBoat',  name: 'Pirate Boat',  blurb: 'Yarr, plunder the seas' },
  { id: 'cargoBoat',   name: 'Cargo Boat',   blurb: 'Hauls a heavy load' },
  { id: 'rowboat',     name: 'Rowboat',      blurb: 'Humble and cozy' },
];

// === Premium boats (priced in coins or reward-only) ===
// rewardOnly: true means cannot be bought, only granted via achievements
export const PREMIUM_BOATS = [
  { id: 'goldTugboat',      name: 'Metallic Gold',     icon: '✨',  price: 30000, defaultHull: '#C9A227', defaultAccent: '#7A5500' },
  { id: 'platinumTugboat',  name: 'Metallic Platinum', icon: '💠',  price: 50000, defaultHull: '#D0D0E2', defaultAccent: '#7878A0' },
  { id: 'diamondTugboat',   name: 'Diamond Crystal',   icon: '💎',  price: 100000, defaultHull: '#A0E8FF', defaultAccent: '#E0FAFF' },
  { id: 'catBoat',          name: 'Void Kitty',        icon: '🐈‍⬛', price: 500,  defaultHull: '#111827', defaultAccent: '#f9a8d4' },
  { id: 'pepeBoat',         name: 'Pepe Boat',         icon: '🐸',  price: 500,  defaultHull: '#4a7c35', defaultAccent: '#3b82f6' },
  { id: 'wifBoat',          name: 'Wif',               icon: '🐶',  price: 500,  defaultHull: '#d4903c', defaultAccent: '#e8b0bc' },
  { id: 'tralaleroBoat',    name: 'Tralalero',         icon: '🦈',  price: 500,  defaultHull: '#4a6b8a', defaultAccent: '#0ea5e9' },
  { id: 'tttBoat',          name: 'TTT',               icon: '🪵',  price: 500,  defaultHull: '#c47e3a', defaultAccent: '#7a4e22' },
  { id: 'alonBoat',         name: 'Alon',              icon: '👆',  price: 500,  defaultHull: '#c8885a', defaultAccent: '#f5c518' },
  { id: 'squidBoat',        name: "Kraken's Vessel",   icon: '🦑',  price: 0,    rewardOnly: true, defaultHull: '#1a0a2e', defaultAccent: '#7c3aed' },
  { id: 'snorkelBoat',      name: 'The Deep Diver',    icon: '🤿',  price: 0,    rewardOnly: true, defaultHull: '#1d4f6e', defaultAccent: '#40c8e0' },
  { id: 'uncBoat',          name: 'Unc',               icon: '😎',  price: 5000, defaultHull: '#c2a781', defaultAccent: '#7ca895' },
  { id: 'chillHouseBoat',   name: 'ChillHouse',        icon: '🏠',  price: 5000, defaultHull: '#a39a8c', defaultAccent: '#8c6746' },
  { id: 'boboBoat',         name: 'Bobo the Bear',     icon: '🐻',  price: 5000, defaultHull: '#4a3320', defaultAccent: '#b23b32' },
  { id: 'trollBoat',        name: 'Troll',             icon: '🧌',  price: 5000, defaultHull: '#7f7f7f', defaultAccent: '#1c1c1c' },
  { id: 'canelcorn',        name: 'Canelcorn',         icon: '🐪',  price: 5000, defaultHull: '#a9743f', defaultAccent: '#5c3c22' },
  { id: 'kermit',           name: 'Kermit',            icon: '🐸',  price: 5000, defaultHull: '#4ea52e', defaultAccent: '#d42020' },
  { id: 'luffyBoat',        name: 'Monkey D. Luffy',   icon: '🏴‍☠️', price: 5000, defaultHull: '#c42020', defaultAccent: '#3d6ec8' },
  { id: 'spiderBoat',       name: 'Spider-Man',        icon: '🕷️', price: 0,    rewardOnly: true, defaultHull: '#CC0000', defaultAccent: '#003399' },
];

// === Curated color palettes (the 10+10 colors the picker offers) ===
// Free-form hex is also accepted by the server (any 6-digit hex).
export const HULL_COLORS = [
  '#a9743f', // brown (default)
  '#c0552f', // rust
  '#3f6fa9', // blue
  '#3f9a7a', // teal-green
  '#9a3f6f', // purple-pink
  '#6a4f8a', // purple
  '#d4a73f', // gold
  '#4a5560', // slate
  '#c44f4f', // red
  '#e6e0d4', // cream
];

export const ACCENT_COLORS = [
  '#7fd4e8', // cyan (default)
  '#f5c542', // yellow
  '#d6483b', // red
  '#7be07b', // lime
  '#ff8fc8', // pink
  '#b48cff', // lavender
  '#f4f1e8', // white
  '#2b2b33', // black
  '#ff7a3d', // orange
  '#3de0d0', // mint
];

export const ALL_BOAT_IDS = new Set([
  ...FREE_BOATS.map((b) => b.id),
  ...PREMIUM_BOATS.map((b) => b.id),
]);

// === Random name generator (mirrors frontend rte() algorithm) ===
export const ADJECTIVES = [
  'Salty', 'Brave', 'Jolly', 'Sleepy', 'Lucky', 'Mighty', 'Tiny',
  'Wild', 'Cosmic', 'Rusty', 'Golden', 'Stormy',
];

export const NOUNS = [
  'Captain', 'Angler', 'Skipper', 'Sailor', 'Mariner', 'Pirate',
  'Tuna', 'Marlin', 'Otter', 'Narwhal', 'Kraken', 'Pelican',
];

export function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

// === Validators ===
export function isValidBoatId(id) {
  return typeof id === 'string' && ALL_BOAT_IDS.has(id);
}

export function isValidHexColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

export function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 24); // mirror NYt() client-side cap
}

// === Default appearance (mirrors frontend `tw`) ===
const DEFAULT_APPEARANCE = {
  type: 'tugboat',
  hull: '#a9743f',
  accent: '#7fd4e8',
};

/**
 * Resolve the effective character config for an account.
 * Applies validation, normalization, and defaults. Returns a clean object
 * suitable for inclusion in the hello payload, plus warnings about any
 * invalid input that was substituted.
 *
 * @param {object} [cfg] - raw `character` field from accounts.json
 * @returns {{ name: string, boatId: string, hull: string, accent: string, warnings: string[] }}
 */
export function resolveCharacter(cfg) {
  const warnings = [];
  if (!cfg || typeof cfg !== 'object') {
    return {
      name: generateRandomName(),
      boatId: DEFAULT_APPEARANCE.type,
      hull: DEFAULT_APPEARANCE.hull,
      accent: DEFAULT_APPEARANCE.accent,
      warnings: ['no character config — using random name + tugboat defaults'],
    };
  }

  const name = normalizeName(cfg.name) || generateRandomName();
  if (cfg.name && !normalizeName(cfg.name)) {
    warnings.push(`name invalid (empty after trim or >24 chars) — using random "${name}"`);
  }

  let boatId = DEFAULT_APPEARANCE.type;
  if (cfg.boat) {
    if (isValidBoatId(cfg.boat)) boatId = cfg.boat;
    else warnings.push(`boat "${cfg.boat}" invalid — using default "${boatId}". Valid boats: see FREE_BOATS / PREMIUM_BOATS`);
  }

  let hull = DEFAULT_APPEARANCE.hull;
  if (cfg.hull) {
    if (isValidHexColor(cfg.hull)) hull = cfg.hull;
    else warnings.push(`hull "${cfg.hull}" invalid hex — using default "${hull}"`);
  }

  let accent = DEFAULT_APPEARANCE.accent;
  if (cfg.accent) {
    if (isValidHexColor(cfg.accent)) accent = cfg.accent;
    else warnings.push(`accent "${cfg.accent}" invalid hex — using default "${accent}"`);
  }

  return { name, boatId, hull, accent, warnings };
}

/**
 * Compare two character configs. Returns true if all four fields are identical
 * (case-sensitive on strings — server is case-sensitive on hex/name).
 */
export function charactersEqual(a, b) {
  if (!a || !b) return false;
  return a.name === b.name
      && a.boatId === b.boatId
      && a.hull === b.hull
      && a.accent === b.accent;
}

// === Local state cache (for setupMode: "auto") ===
//
// Tracked per-account. Lets the bot know "did I last set this character, and
// is it the same as the user now wants?". Path is per-account so multiple
// accounts can each be at a different point in their setup lifecycle.
function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
}

const stateFile = (stateDir, acctId) =>
  path.join(stateDir, `character-${sanitize(acctId)}.json`);

export async function loadCharacterState(stateDir, acctId) {
  try {
    const raw = await readFile(stateFile(stateDir, acctId), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function saveCharacterState(stateDir, acctId, character) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    stateFile(stateDir, acctId),
    JSON.stringify({ ...character, savedAt: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 },
  );
}

// === WebSocket dispatcher (mirrors lib/api.js makeDispatcher logic) ===
function makeWsAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (/^socks5?:/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
  if (/^https?:/i.test(proxyUrl)) return new ProxyAgent({ uri: proxyUrl });
  throw new Error(`Unsupported proxy protocol: ${proxyUrl}`);
}

// === REST dispatcher (for readCharacterFromSave via undici) ===
function makeFetchDispatcher(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (/^socks5?:/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
  if (/^https?:/i.test(proxyUrl)) return new ProxyAgent({ uri: proxyUrl });
  throw new Error(`Unsupported proxy protocol: ${proxyUrl}`);
}

/**
 * Read the persisted character from the server's REST API.
 *
 * ⚠️  THIS IS THE AUTHORITATIVE SOURCE. Use this instead of `detectCharacter`.
 *
 * Source of truth: `GET /api/me/save` → `saveData.boatAppearance = {hull, type, accent}`.
 * This is the DB-persisted character — what the user actually set in browser.
 *
 * Caveats:
 *   - `name` is NOT in saveData. The name lives only in WS hello state (the
 *     server keeps the last name you sent in hello). REST can't read it.
 *     We return `name: null` to signal "not available via REST" — caller can
 *     decide whether to fall back to local config or send hello + accept
 *     default.
 *   - `saveData` may be `null` on a brand-new account (no character ever
 *     persisted yet). Caller should fall back in that case.
 *
 * @param {object} opts
 * @param {string} opts.accessToken - Privy SIWS JWT
 * @param {string} [opts.baseUrl='https://voxelfishing.com']
 * @param {string} [opts.proxyUrl] - SOCKS5 or HTTP proxy
 * @param {number} [opts.timeoutMs=8000]
 * @returns {Promise<{ character: { name: null, boatId: string, hull: string, accent: string } | null, saveDataPresent: boolean }>}
 */
export async function readCharacterFromSave(opts) {
  const {
    accessToken,
    baseUrl = 'https://voxelfishing.com',
    proxyUrl,
    timeoutMs = 8000,
  } = opts;
  if (!accessToken) throw new Error('readCharacterFromSave: accessToken required');

  const dispatcher = makeFetchDispatcher(proxyUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/me/save`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Origin': 'https://voxelfishing.com',
      },
      dispatcher,
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`readCharacterFromSave: GET /api/me/save returned HTTP ${res.status}`);
    }
    const body = await res.json();
    const save = body?.saveData;
    if (!save || typeof save !== 'object') {
      return { character: null, saveDataPresent: false };
    }
    const app = save.boatAppearance;
    if (!app || typeof app !== 'object') {
      return { character: null, saveDataPresent: true };
    }
    return {
      character: {
        name: null, // not available via REST — see fn docstring
        boatId: app.type || DEFAULT_APPEARANCE.type,
        hull: app.hull || DEFAULT_APPEARANCE.hull,
        accent: app.accent || DEFAULT_APPEARANCE.accent,
      },
      saveDataPresent: true,
    };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`readCharacterFromSave: timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
}

/**
 * Detect the current character for a player by opening a WS, sending a minimal
 * hello (no character fields), then reading self from the next `players` update.
 *
 * Why this works: the server stores character per playerId and broadcasts the
 * full player list (including self) to every connected client on every tick.
 * The server does NOT echo character info in `welcome` — only `players`
 * broadcasts contain it. So to learn "what does the server think my character
 * is right now", we connect, wait for the first `players` snapshot, and read
 * our own row.
 *
 * @param {object} opts
 * @param {string} opts.accessToken - Privy SIWS JWT
 * @param {string} [opts.playerId]  - persistent playerId; if omitted, one is
 *                                    generated (treats detection as one-shot)
 * @param {string} [opts.proxyUrl]
 * @param {string} [opts.wsUrl]
 * @param {number} [opts.timeoutMs] - detection timeout (default 8s)
 * @returns {Promise<{ connId: number, character: { name, boatId, hull, accent } | null }>}
 *   - character is null if self was not in any players broadcast within timeout
 */
export async function detectCharacter(opts) {
  const {
    accessToken,
    proxyUrl,
    wsUrl = 'wss://voxelfishing.com/api/ws',
    timeoutMs = 8000,
    playerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  } = opts;
  if (!accessToken) throw new Error('detectCharacter: accessToken required');

  const agent = makeWsAgent(proxyUrl);
  const ws = new WebSocket(wsUrl, { agent, handshakeTimeout: timeoutMs });

  return new Promise((resolve, reject) => {
    let connId = null;
    let detected = null;
    const cleanup = () => { try { ws.close(); } catch {} };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ connId, character: detected });
    }, timeoutMs);

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          t: 'hello',
          playerId,
          authToken: accessToken,
          reconnectToken: '',
        }));
      } catch (e) {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`detectCharacter: WS send failed: ${e.message}`));
      }
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === 'welcome' && typeof msg.you === 'number') {
        connId = msg.you;
        return;
      }
      if (msg.t === 'players' && Array.isArray(msg.players) && connId != null) {
        const self = msg.players.find((p) => p.connId === connId);
        if (self && self.name) {
          detected = {
            name: self.name,
            boatId: self.boatType || DEFAULT_APPEARANCE.type,
            hull: self.hull || DEFAULT_APPEARANCE.hull,
            accent: self.accent || DEFAULT_APPEARANCE.accent,
          };
          clearTimeout(timer);
          cleanup();
          resolve({ connId, character: detected });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`detectCharacter: WS error: ${err.message}`));
    });
  });
}

/**
 * Apply a character (name + boat + colors) to the currently-connected WS.
 * Sends `rename` and `appearance` as separate messages. Server applies them
 * immediately and re-broadcasts in next `players` tick.
 *
 * The connection is the caller's responsibility — this fn does not open or
 * close WS.
 *
 * @param {WebSocket} ws - already-open WS connection
 * @param {{name:string, boatId:string, hull:string, accent:string}} character
 * @returns {Promise<{applied: true, character}>}
 */
export async function applyCharacter(ws, character) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('applyCharacter: WS not open');
  }
  ws.send(JSON.stringify({ t: 'rename', name: character.name }));
  ws.send(JSON.stringify({
    t: 'appearance',
    boatType: character.boatId,
    hull: character.hull,
    accent: character.accent,
  }));
  return { applied: true, character };
}

/**
 * Detect current character, compare to desired, and apply if different.
 * One-shot, idempotent, safe to call on every bot startup.
 *
 * Honors `setupMode`:
 *   skip   → detect only, never send rename/appearance
 *   config → detect, send rename/appearance if different from accounts.json
 *   auto   → detect; if state.json matches config, skip; if differs, apply
 *            and update state.json
 *
 * @param {object} opts
 * @param {string} opts.accessToken
 * @param {string} opts.address     - wallet pubkey (informational only)
 * @param {'skip'|'config'|'auto'} [opts.mode='skip']
 * @param {object} [opts.cfg]       - raw `character` field from accounts.json
 * @param {string} [opts.stateDir]  - state cache dir (default '.hermes')
 * @param {string} opts.acctId      - account id (used as state filename)
 * @param {string} [opts.proxyUrl]
 * @param {string} [opts.wsUrl]
 * @param {number} [opts.timeoutMs=8000]
 * @returns {Promise<{ detected, applied, mode, reason, warnings: string[], character }>}
 */
export async function setupCharacter(opts) {
  const {
    accessToken,
    address,
    mode = 'skip',
    cfg = null,
    stateDir = '.hermes',
    acctId,
    proxyUrl,
    wsUrl = 'wss://voxelfishing.com/api/ws',
    timeoutMs = 8000,
  } = opts;
  if (!accessToken) throw new Error('setupCharacter: accessToken required');
  if (!acctId) throw new Error('setupCharacter: acctId required (for state cache)');
  if (!['skip', 'config', 'auto'].includes(mode)) {
    throw new Error(`setupCharacter: mode must be skip|config|auto, got "${mode}"`);
  }

  // === Detect current character from server ===
  // Source depends on mode:
  //   - skip: REST GET /api/me/save → saveData.boatAppearance (DB-persisted, real)
  //           We DO NOT open WS here — hello-without-fields causes server to fill
  //           DEFAULTS ("Captain"/"tugboat") and overwrite the user's character.
  //   - config / auto: WS detection. We need WS anyway (to apply), and the
  //     post-apply players broadcast confirms what server accepted.
  let connId = null;
  let detected;
  if (mode === 'skip') {
    const { character } = await readCharacterFromSave({ accessToken, proxyUrl, timeoutMs });
    detected = character;
  } else {
    const d = await detectCharacter({ accessToken, proxyUrl, wsUrl, timeoutMs });
    connId = d.connId;
    detected = d.character;
  }

  const warnings = [];
  if (!detected) {
    warnings.push(mode === 'skip'
      ? 'no character in /api/me/save (account may be brand-new — set character in browser first)'
      : 'no character detected from server within timeout (player may be new or rate-limited)');
  }

  // === Resolve desired character from config ===
  const resolved = resolveCharacter(cfg);
  if (resolved.warnings.length) warnings.push(...resolved.warnings);

  // === Load last-applied state for auto mode ===
  let lastState = null;
  if (mode === 'auto') {
    lastState = await loadCharacterState(stateDir, acctId);
  }

  // === Decide whether to apply ===
  let apply = false;
  let reason = '';

  if (mode === 'skip') {
    if (!detected) {
      reason = 'mode=skip — server has no character (or /api/me/save empty); not setting';
    } else {
      // detected.name is null from REST (name lives only in WS hello state).
      // We don't read it via WS because that would overwrite the server's name.
      const desc = detected.name
        ? `"${detected.name}"/${detected.boatId}/${detected.hull}/${detected.accent}`
        : `${detected.boatId}/${detected.hull}/${detected.accent} (name not readable via REST — set in browser)`;
      reason = `mode=skip — keeping server's character ${desc}`;
    }
  } else if (mode === 'config') {
    if (!detected) {
      apply = true;
      reason = 'mode=config — no server character found, applying config';
    } else if (!charactersEqual(detected, resolved)) {
      apply = true;
      reason = `mode=config — server has "${detected.name}"/${detected.boatId}, config says "${resolved.name}"/${resolved.boatId}, applying`;
    } else {
      reason = `mode=config — server already matches config ("${detected.name}"/${detected.boatId})`;
    }
  } else if (mode === 'auto') {
    if (!lastState) {
      if (!detected) {
        apply = true;
        reason = 'mode=auto — first run, no server character, applying config';
      } else if (!charactersEqual(detected, resolved)) {
        apply = true;
        reason = `mode=auto — first run, server has "${detected.name}"/${detected.boatId}, config says "${resolved.name}"/${resolved.boatId}, applying`;
      } else {
        reason = `mode=auto — first run, server already matches config ("${detected.name}"/${detected.boatId}), writing state.json`;
      }
    } else {
      if (charactersEqual(lastState, resolved)) {
        reason = `mode=auto — state.json matches config, no change needed`;
      } else {
        apply = true;
        reason = `mode=auto — config changed since last run, applying new character`;
      }
    }
  }

  // === Apply if needed (separate WS, send full hello + rename + appearance) ===
  if (apply) {
    const agent = makeWsAgent(proxyUrl);
    const applyWs = new WebSocket(wsUrl, { agent, handshakeTimeout: timeoutMs });
    try {
      await new Promise((resolveOpen, rejectOpen) => {
        const t = setTimeout(() => rejectOpen(new Error('apply WS open timeout')), timeoutMs);
        applyWs.once('open', () => { clearTimeout(t); resolveOpen(); });
        applyWs.once('error', (e) => { clearTimeout(t); rejectOpen(e); });
      });
      // Full hello with the new character — server expects this as part of auth
      applyWs.send(JSON.stringify({
        t: 'hello',
        playerId: `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        name: resolved.name,
        level: 1,
        boatType: resolved.boatId,
        hull: resolved.hull,
        accent: resolved.accent,
        aura: false,
        activePet: null,
        authToken: accessToken,
        reconnectToken: '',
      }));
      await applyCharacter(applyWs, resolved);
      // Give server a moment to process before closing
      await new Promise((r) => setTimeout(r, 500));
      try { applyWs.close(); } catch {}
    } catch (e) {
      warnings.push(`apply failed: ${e.message}`);
    }
  }

  // === Persist state for auto mode ===
  if (mode === 'auto' && (apply || !lastState)) {
    try {
      await saveCharacterState(stateDir, acctId, resolved);
    } catch (e) {
      warnings.push(`state save failed: ${e.message}`);
    }
  }

  return {
    connId,
    detected,
    applied: apply,
    mode,
    reason,
    warnings,
    character: resolved,
  };
}
