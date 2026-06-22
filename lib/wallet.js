// lib/wallet.js
// Detect and parse Solana wallet in multiple formats:
//   - base58 private key string (Phantom export)
//   - base58 private key with [123,45,...] bracket wrapping
//   - base64 private key
//   - JSON array of bytes (e.g. from solana-keygen)
//   - hex string with or without 0x prefix (128 chars = 64 bytes, 64 chars = 32 bytes seed)
//
// User owns the wallet — we NEVER generate new ones (per Dimzy rule 2026-06-19).

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const MAX_RETRIES = 1;

/**
 * Try to parse a private key from various input formats.
 * Returns a 64-byte Uint8Array (Solana ed25519 keypair secret).
 * Throws if no format matches.
 */
export function parsePrivateKey(input) {
  if (!input) throw new Error('Empty private key');
  const raw = String(input).trim();

  // JSON array
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length === 64) {
        return Uint8Array.from(arr);
      }
      if (Array.isArray(arr) && arr.length === 32) {
        // 32-byte seed — re-derive to 64-byte by using as full secret
        return Uint8Array.from(arr);
      }
      throw new Error(`JSON array must be 64 bytes (got ${arr.length})`);
    } catch (e) {
      throw new Error(`Invalid JSON array: ${e.message}`);
    }
  }

  // Hex (with or without 0x prefix)
  // 128 chars = 64 bytes (full Solana keypair secret)
  // 64 chars = 32 bytes (32-byte ed25519 seed; use as full secret)
  if (/^0x[0-9a-fA-F]+$/.test(raw) || /^[0-9a-fA-F]+$/.test(raw)) {
    const stripped = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (stripped.length === 128 || stripped.length === 64) {
      const buf = Buffer.from(stripped, 'hex');
      return new Uint8Array(buf);
    }
    // Not standard hex length — fall through to other formats
  }

  // base64
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0) {
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 64) return new Uint8Array(buf);
      if (buf.length === 32) return new Uint8Array(buf);
    } catch (_) {
      // fall through to base58
    }
  }

  // base58 (Phantom default export format)
  try {
    const buf = bs58.decode(raw);
    if (buf.length === 64) return new Uint8Array(buf);
    if (buf.length === 32) return new Uint8Array(buf);
    throw new Error(`Base58 must be 64 bytes (got ${buf.length})`);
  } catch (e) {
    throw new Error(`Could not parse wallet in any format: ${e.message}`);
  }
}

/**
 * Load a Keypair from a private key string.
 * Handles 64-byte full secret (most common) AND 32-byte ed25519 seed.
 */
export function loadKeypair(privateKeyInput) {
  const secret = parsePrivateKey(privateKeyInput);
  if (secret.length === 32) {
    // 32-byte ed25519 seed — derive pubkey from seed
    return Keypair.fromSeed(secret);
  }
  return Keypair.fromSecretKey(secret);
}

/**
 * Read first account from Phantom-style array-of-accounts JSON.
 * (Phantom exports an array; bot takes index 0.)
 */
export function loadFromPhantomExport(exportJson, index = 0) {
  let parsed;
  try {
    parsed = JSON.parse(exportJson);
  } catch (e) {
    throw new Error(`Invalid Phantom export JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Phantom export must be an array of accounts');
  }
  const acct = parsed[index];
  if (!acct) throw new Error(`Account at index ${index} not found`);

  // Phantom export: each entry has "privateKey" or "secretKey" (array of bytes)
  const key = acct.privateKey || acct.secretKey;
  if (!key) throw new Error('No privateKey/secretKey in Phantom export');
  if (typeof key === 'string') return loadKeypair(key);
  if (Array.isArray(key)) return loadKeypair(JSON.stringify(key));
  throw new Error('Unknown key format in Phantom export');
}

/**
 * Validate a Solana public key string.
 */
export function isValidAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  if (addr.length < 32 || addr.length > 44) return false;
  try {
    const decoded = bs58.decode(addr);
    return decoded.length === 32;
  } catch (_) {
    return false;
  }
}
