#!/usr/bin/env node
// scripts/edit-account.js — edit a single field of an account
//
//   npm run edit-account -- <name> <field> <value>
//   npm run edit-account -- alt  castMode rod
//   npm run edit-account -- alt  proxy    socks5://user:pass@host:1080
//   npm run edit-account -- alt  proxy    ""                    # clear proxy
//   npm run edit-account -- alt  memeMode parallel
//
// Allowed fields: castMode, magnetMode, memeMode, sellMode, sellMaxRarity,
//                 sellThreshold, sellPets, keepMythics, claimGrants,
//                 claimRelicSet, consumeAbyssLurker, proxy, enabled.
//
// Nested fields use dot: character.mode, character.boat, character.hull, character.accent.

import { loadAccounts, saveAccounts } from '../lib/accounts.js';

const T = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const ALLOWED_TOP = ['castMode', 'magnetMode', 'memeMode', 'memeMaxPerCycle',
                     'sellMode', 'sellThreshold', 'sellMaxRarity', 'keepMythics',
                     'sellPets', 'claimGrants', 'claimRelicSet', 'consumeAbyssLurker',
                     'proxy', 'enabled'];
const ALLOWED_NESTED = ['character.mode', 'character.boat', 'character.hull', 'character.accent'];

function parseVal(field, raw) {
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw === 'null' || raw === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

const [name, field, ...rest] = process.argv.slice(2);
if (!name || !field || rest.length === 0) {
  console.error(`usage: npm run edit-account -- <name> <field> <value>`);
  console.error(`\ntop-level: ${ALLOWED_TOP.join(', ')}`);
  console.error(`nested:    ${ALLOWED_NESTED.join(', ')}`);
  process.exit(1);
}
const rawVal = rest.join(' ');

if (![...ALLOWED_TOP, ...ALLOWED_NESTED].includes(field)) {
  console.error(`${T.red}unknown field "${field}"${T.reset}`);
  console.error(`${T.dim}allowed: ${[...ALLOWED_TOP, ...ALLOWED_NESTED].join(', ')}${T.reset}`);
  process.exit(1);
}

let accounts;
try {
  accounts = loadAccounts();
} catch (e) {
  console.error(`${T.red}error: ${e.message}${T.reset}`);
  process.exit(1);
}
const idx = accounts.findIndex((a) => a.name === name);
if (idx < 0) {
  console.error(`${T.red}no account named "${name}"${T.reset}`);
  process.exit(1);
}

const value = parseVal(field, rawVal);

if (field.startsWith('character.')) {
  const sub = field.split('.')[1];
  accounts[idx] = { ...accounts[idx], character: { ...(accounts[idx].character || {}), [sub]: value } };
} else {
  accounts[idx] = { ...accounts[idx], [field]: value };
}
saveAccounts(accounts);
const display = value === null ? '(null)' : typeof value === 'string' ? `"${value}"` : value;
console.log(`${T.green}✅ ${name}.${field} = ${display}${T.reset}`);
