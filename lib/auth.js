// lib/auth.js
// Privy SIWS (Sign-In With Solana) auth flow.
//   1. POST /api/v1/siws/init {address} -> {message}
//   2. Sign message with Phantom ed25519 private key
//   3. POST /api/v1/siws/authenticate {message, signature} -> {access_token}
//
// Used by every account before each session. Token lasts ~24h.

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { HttpsProxyAgent } from 'https-proxy-agent';

const PRIVY_BASE = 'https://auth.privy.io';
const VOXEL_BASE = 'https://voxelfishing.com';
const PRIVY_APP_ID = 'cmpxg3h0o00400dla4si4jp4x';
const APP_ORIGIN = 'https://voxelfishing.com';

function makeDispatcher(proxyUrl) {
  if (!proxyUrl) return null;
  // undici ProxyAgent works with both http:// and socks5:// (with experimental)
  return new ProxyAgent({ uri: proxyUrl });
}

function makeNodeFetch(proxyUrl) {
  if (!proxyUrl) {
    return globalThis.fetch.bind(globalThis);
  }
  return (url, opts = {}) => {
    const dispatcher = makeDispatcher(proxyUrl);
    return undiciFetch(url, { ...opts, dispatcher });
  };
}

/**
 * Build the SIWS message exactly as Privy's @privy-io/js-sdk-core does.
 * Source: @privy-io/js-sdk-core/dist/esm/solana/createSiwsMessage.mjs
 *
 *   {domain} wants you to sign in with your Solana account:
 *   {address}
 *
 *   You are proving you own {address}.
 *
 *   URI: {uri}
 *   Version: 1
 *   Chain ID: mainnet
 *   Nonce: {nonce}
 *   Issued At: {issuedAt}
 *   Resources:
 *   - https://privy.io
 */
function buildSiwsMessage({ domain, address, uri, nonce, issuedAt }) {
  return (
    `${domain} wants you to sign in with your Solana account:\n` +
    `${address}\n\n` +
    `You are proving you own ${address}.\n\n` +
    `URI: ${uri}\n` +
    `Version: 1\n` +
    `Chain ID: mainnet\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Resources:\n` +
    `- https://privy.io`
  );
}

/**
 * Step 1: Request the SIWS message from Privy.
 * Returns { nonce, address, expires_at, message, ... } where message is constructed.
 */
async function siwsInit(address, fetchFn) {
  const url = `${PRIVY_BASE}/api/v1/siws/init`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'privy-app-id': PRIVY_APP_ID,
      Origin: APP_ORIGIN,
      Referer: `${APP_ORIGIN}/`,
    },
    body: JSON.stringify({ address }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`SIWS init failed (${res.status}): ${JSON.stringify(body)}`);
  }
  if (!body.nonce) {
    throw new Error(`SIWS init returned no nonce: ${JSON.stringify(body)}`);
  }

  // Construct the SIWS message client-side (matches Privy SDK exactly)
  const issuedAt = new Date().toISOString();
  const message = buildSiwsMessage({
    domain: 'voxelfishing.com',
    uri: 'https://voxelfishing.com',
    address,
    nonce: body.nonce,
    issuedAt,
  });
  return { ...body, message };
}

/**
 * Step 2: Sign the SIWS message with ed25519 (Solana Phantom private key).
 * The signature is base64-encoded (not base58 — Privy expects base64).
 */
function signMessage(messageBytes, secretKey) {
  const sig = nacl.sign.detached(messageBytes, secretKey);
  return Buffer.from(sig).toString('base64');
}

/**
 * Step 3: Submit the signature. Returns {access_token, ...}.
 */
async function siwsAuthenticate(message, signature, fetchFn) {
  const url = `${PRIVY_BASE}/api/v1/siws/authenticate`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'privy-app-id': PRIVY_APP_ID,
      Origin: APP_ORIGIN,
      Referer: `${APP_ORIGIN}/`,
    },
    body: JSON.stringify({ message, signature }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`SIWS authenticate failed (${res.status}): ${JSON.stringify(body)}`);
  }
  if (!body.access_token && !body.token) {
    throw new Error(`SIWS authenticate returned no token: ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Full sign-in: returns { accessToken, refreshToken?, identityToken?, raw }.
 */
export async function signIn(keypair, proxyUrl = null) {
  const fetchFn = makeNodeFetch(proxyUrl);
  const address = keypair.publicKey.toBase58();

  // 1. Get SIWS message
  const init = await siwsInit(address, fetchFn);
  const message = init.message;
  if (!message) throw new Error('No message from SIWS init');

  // 2. Sign — message is a UTF-8 string, signature is base64 of 64-byte sig
  const messageBytes = new TextEncoder().encode(message);
  const signature = signMessage(messageBytes, keypair.secretKey);

  // 3. Authenticate
  const auth = await siwsAuthenticate(message, signature, fetchFn);
  return {
    accessToken: auth.access_token || auth.token,
    refreshToken: auth.refresh_token,
    identityToken: auth.identity_token,
    address,
    raw: auth,
  };
}

/**
 * Test if a saved token is still valid by hitting /api/me/*.
 * Returns true on 200, false on 401.
 */
export async function probeToken(accessToken, proxyUrl = null) {
  const fetchFn = makeNodeFetch(proxyUrl);
  try {
    const r = await fetchFn(`${VOXEL_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}
