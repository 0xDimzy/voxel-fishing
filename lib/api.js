// lib/api.js
// Thin wrapper around the VoxelFishing REST API.
// All game endpoints require: Authorization: Bearer <access_token>

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { setupCharacter } from './character.js';

const VOXEL_BASE = 'https://voxelfishing.com';
const DEFAULT_TIMEOUT_MS = 15000;

function makeDispatcher(proxyUrl) {
  if (!proxyUrl) return null;
  // SOCKS5 proxy (Phantom/bot use case) — use socks-proxy-agent
  if (/^socks5?:\/\//i.test(proxyUrl)) {
    return new SocksProxyAgent(proxyUrl);
  }
  // HTTP/HTTPS proxy — use undici ProxyAgent
  if (/^https?:\/\//i.test(proxyUrl)) {
    return new ProxyAgent({ uri: proxyUrl });
  }
  throw new Error(`Unsupported proxy protocol: ${proxyUrl} (use http://, https://, socks5://)`);
}

function makeFetch(proxyUrl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!proxyUrl) {
    return (url, opts = {}) => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeoutMs);
      const signal = opts.signal || ctrl.signal;
      return globalThis.fetch(url, { ...opts, signal })
        .finally(() => clearTimeout(to));
    };
  }
  return (url, opts = {}) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const signal = opts.signal || ctrl.signal;
    const dispatcher = makeDispatcher(proxyUrl);
    return undiciFetch(url, { ...opts, dispatcher, signal })
      .finally(() => clearTimeout(to));
  };
}

export class VoxelAPI {
  constructor(accessToken, proxyUrl = null, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.accessToken = accessToken;
    this.proxyUrl = proxyUrl;
    this.fetch = makeFetch(proxyUrl, timeoutMs);
    this.base = VOXEL_BASE;
  }

  _headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      Origin: 'https://voxelfishing.com',
      Referer: 'https://voxelfishing.com/play',
      ...extra,
    };
  }

  async _request(method, path, body, opts = {}) {
    const url = `${this.base}${path}`;
    const requestOpts = {
      method,
      headers: this._headers(),
    };
    if (body !== undefined && body !== null) {
      requestOpts.body = JSON.stringify(body);
    }
    if (opts.timeoutMs) {
      // override fetch timeout for this call
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      requestOpts.signal = ctrl.signal;
      try {
        return await this._doRequest(url, requestOpts, method, path);
      } finally {
        clearTimeout(to);
      }
    }
    return this._doRequest(url, requestOpts, method, path);
  }

  async _doRequest(url, opts, method, path) {
    const res = await this.fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  // === game state ===

  /** Get player state: saveData, tradeableAssets (fish), boathouse. */
  getSave(opts) { return this._request('GET', '/api/me/save', undefined, opts); }

  /** Get grants info (total, count). */
  getGrants(opts) { return this._request('GET', '/api/me/grants', undefined, opts); }

  // === fishing actions ===

  /** Server-side cast with magnet item (auto-catch). Returns outcome, coins, xp. */
  magnetCast(opts) { return this._request('POST', '/api/me/magnet-cast', undefined, opts); }

  /** Claim all available grants. May take 10-30s. */
  claimGrants(opts) { return this._request('POST', '/api/me/grants/claim', undefined, { timeoutMs: 60000, ...opts }); }

  /** Claim completed relic set. */
  claimRelicSet(opts) { return this._request('POST', '/api/me/relic-set-claim', undefined, opts); }

  // === fish inventory actions ===

  /** Sell caught fish by uid (max 500 per call). */
  sellFish(uids, opts) {
    if (!Array.isArray(uids)) uids = [uids];
    return this._request('POST', '/api/me/fish/sell', { uids }, opts);
  }

  /** Consume a fish (e.g. for buff). */
  consumeFish(uid, opts) {
    return this._request('POST', '/api/me/fish/consume', { uid }, opts);
  }

  // === pet actions ===

  /** Sell a pet by uid. */
  sellPet(uid, opts) { return this._request('POST', '/api/me/pet/sell', { uid }, opts); }

  // === shop ===

  /** Buy an item from shop (e.g. itemType: "pet_egg"). */
  shopBuy(itemType, opts) {
    return this._request('POST', '/api/me/shop/buy', { itemType }, opts);
  }

  // === meme-cast (meme token) ===

  /** Cast with meme token (different reward pool). */
  memeCast(opts) { return this._request('POST', '/api/me/meme-cast', undefined, opts); }

  /** Get meme-fish inventory. */
  getMemeFish(opts) { return this._request('GET', '/api/me/meme-fish', undefined, opts); }

  // === friends ===

  /** Get friends list, codes, DIDs. */
  getFriends(opts) { return this._request('GET', '/api/me/friends', undefined, opts); }
  sendFriendRequest(wallet, opts) { return this._request('POST', '/api/me/friends/request', { wallet }, opts); }
  acceptFriendRequest(wallet, opts) { return this._request('POST', '/api/me/friends/accept', { wallet }, opts); }

  // === marketplace ===

  getMyListings(opts) { return this._request('GET', '/api/marketplace/my-listings', undefined, opts); }
  getListings(opts) { return this._request('GET', '/api/marketplace/listings', undefined, opts); }
  getFishCaps(opts) { return this._request('GET', '/api/marketplace/fish-caps', undefined, opts); }
  listFish(payload, opts) { return this._request('POST', '/api/marketplace/listings', payload, opts); }
  payoutNotifications(opts) { return this._request('POST', '/api/marketplace/payout-notifications', undefined, opts); }

  // === helpers ===

  /**
   * Pull sellable fish from /api/me/save tradeableAssets.
   * Returns an array of fish objects with {uid, speciesId, weight, rarity, ...} or [].
   */
  async listFish() {
    const save = await this.getSave();
    return save?.tradeableAssets || [];
  }

  /**
   * Set character (name + boat + colors) via WebSocket.
   * Wraps lib/character.js setupCharacter with this API's access token + proxy.
   *
   * @param {object} opts - { name?, boatId?, hullColor?, accentColor?, address, playerId? }
   * @returns {Promise<{ok, name, boatId, hull, accent, warnings, closeCode, closeReason}>}
   */
  async setupCharacter(opts = {}) {
    return setupCharacter({
      accessToken: this.accessToken,
      address: opts.address || this.address,
      proxyUrl: this.proxyUrl,
      name: opts.name,
      boatId: opts.boatId,
      hullColor: opts.hullColor,
      accentColor: opts.accentColor,
      playerId: opts.playerId,
      wsUrl: opts.wsUrl,
      timeoutMs: opts.timeoutMs,
    });
  }
}
