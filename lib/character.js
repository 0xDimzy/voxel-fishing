// lib/character.js
// VoxelFishing character setup: name + boat + 2 colors via WebSocket.
//
// The character (name + boat + hull/accent colors) is set via WebSocket
// messages on the realtime channel. The client sends:
//   1. {t:"hello", playerId, name, level, boatType, hull, accent, ..., authToken}
//      → on WS open (authenticates the connection)
//   2. {t:"rename", name}                              → change name
//   3. {t:"appearance", boatType, hull, accent}        → change boat + colors
//
// Server validates:
//   - name: max 24 chars (auto-truncated client-side too)
//   - boatType: must be in allowlist of 26 boats
//   - hull, accent: /^#[0-9a-fA-F]{6}$/ (any 6-digit hex)
//
// Data reverse-engineered from /assets/index-C9LxatAm.js (2026-06-22).

import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';

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

// === WebSocket dispatcher (mirrors lib/api.js makeDispatcher logic) ===
function makeWsAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (/^socks5?:/i.test(proxyUrl)) return new SocksProxyAgent(proxyUrl);
  if (/^https?:/i.test(proxyUrl)) return new ProxyAgent({ uri: proxyUrl });
  throw new Error(`Unsupported proxy protocol: ${proxyUrl}`);
}

// === Default appearance (mirrors frontend `tw`) ===
const DEFAULT_APPEARANCE = {
  type: 'tugboat',
  hull: '#a9743f',
  accent: '#7fd4e8',
};

/**
 * Set character name + boat + 2 colors via WebSocket.
 * Idempotent — sends the same values on every run.
 *
 * @param {object} opts
 * @param {string} opts.accessToken - Privy SIWS JWT
 * @param {string} opts.address     - wallet pubkey (base58)
 * @param {string} [opts.name]      - name override (else random)
 * @param {string} [opts.boatId]    - boat id (else 'tugboat')
 * @param {string} [opts.hullColor] - hull hex (else '#a9743f')
 * @param {string} [opts.accentColor] - accent hex (else '#7fd4e8')
 * @param {string} [opts.proxyUrl]  - socks5/http proxy
 * @param {string} [opts.wsUrl]     - override WS URL (default wss://voxelfishing.com/api/ws)
 * @param {number} [opts.timeoutMs] - total timeout (default 15s)
 * @param {string} [opts.playerId]  - persistent playerId (else random UUID)
 * @returns {Promise<{ok: boolean, name: string, boatId: string, hull: string, accent: string, warnings: string[]}>}
 */
export async function setupCharacter(opts) {
  const {
    accessToken,
    address,
    name: rawName,
    boatId: rawBoat,
    hullColor: rawHull,
    accentColor: rawAccent,
    proxyUrl,
    wsUrl = 'wss://voxelfishing.com/api/ws',
    timeoutMs = 15000,
    playerId,
  } = opts;

  if (!accessToken) throw new Error('setupCharacter: accessToken required');
  if (!address) throw new Error('setupCharacter: address required');

  // === Validate + normalize inputs ===
  const warnings = [];
  const name = normalizeName(rawName) || generateRandomName();
  if (rawName && !normalizeName(rawName)) {
    warnings.push(`name invalid (empty after trim, length>24) — using random "${name}"`);
  }
  let boatId = DEFAULT_APPEARANCE.type;
  if (rawBoat) {
    if (isValidBoatId(rawBoat)) boatId = rawBoat;
    else warnings.push(`boatId "${rawBoat}" invalid — using default "${boatId}". Valid: see FREE_BOATS / PREMIUM_BOATS`);
  }
  let hull = DEFAULT_APPEARANCE.hull;
  if (rawHull) {
    if (isValidHexColor(rawHull)) hull = rawHull;
    else warnings.push(`hull "${rawHull}" invalid hex — using default "${hull}"`);
  }
  let accent = DEFAULT_APPEARANCE.accent;
  if (rawAccent) {
    if (isValidHexColor(rawAccent)) accent = rawAccent;
    else warnings.push(`accent "${rawAccent}" invalid hex — using default "${accent}"`);
  }

  const finalPlayerId = playerId || `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // === Open WebSocket ===
  const agent = makeWsAgent(proxyUrl);
  const ws = new WebSocket(wsUrl, { agent, handshakeTimeout: timeoutMs });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      try { ws.close(); } catch {}
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`setupCharacter: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let sentHello = false;
    let sentRename = false;
    let sentAppearance = false;

    ws.on('open', () => {
      // 1. Authenticate via hello
      try {
        ws.send(JSON.stringify({
          t: 'hello',
          playerId: finalPlayerId,
          name,
          level: 1,
          boatType: boatId,
          hull,
          accent,
          aura: false,
          activePet: null,
          authToken: accessToken,
          reconnectToken: '',
        }));
        sentHello = true;

        // 2. Send rename (in case server needs explicit rename)
        ws.send(JSON.stringify({ t: 'rename', name }));
        sentRename = true;

        // 3. Send appearance (in case server needs explicit appearance)
        ws.send(JSON.stringify({
          t: 'appearance',
          boatType: boatId,
          hull,
          accent,
        }));
        sentAppearance = true;
      } catch (e) {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`setupCharacter: WS send failed: ${e.message}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`setupCharacter: WS error: ${err.message}`));
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      if (sentHello && sentRename && sentAppearance) {
        resolve({
          ok: true,
          name,
          boatId,
          hull,
          accent,
          warnings,
          closeCode: code,
          closeReason: reason?.toString?.() || '',
        });
      } else {
        reject(new Error(`setupCharacter: WS closed prematurely (code=${code}, reason=${reason?.toString?.() || ''})`));
      }
    });
  });
}