# VoxelFishing Bot v2

Multi-account automation for [voxelfishing.com](https://voxelfishing.com) — character setup, magnet/meme casting, smart fish selling, pet management. Privy SIWS sign-in via Phantom wallet, with per-account SOCKS5/HTTP proxy + humanized timing to avoid detection.

> **Disclaimer**: Use at your own risk. The author is not responsible for any bans or losses. This bot is for educational purposes — respect the game's TOS.

---

## Features

| Feature | Status |
|---------|--------|
| Multi-account parallel execution | ✅ |
| Privy SIWS sign-in (Phantom) | ✅ |
| Token cache (`tokens.json`) | ✅ |
| Per-account SOCKS5 / HTTP proxy | ✅ |
| Character setup (name + boat + 2 colors) via WS | ✅ v2 |
| Daily grants claim | ✅ |
| Relic set bonus claim | ✅ v2 |
| Magnet cast loop | ✅ |
| Meme cast (parallel secondary) | ✅ v2 |
| Smart fish selling (rarity filter, keep mythics) | ✅ v2 |
| Auto-consume targets (Abyss Lurker → Abyssal Aura) | ✅ v2 |
| Pet sell | ✅ v2 |
| Humanize timing (gaussian + jitter) | ✅ |

---

## Stack

- **Runtime**: Node.js ≥ 18 (ESM)
- **Auth**: Privy SIWS (Sign-In With Solana) via Phantom
- **App ID**: `cmpxg3h0o00400dla4si4jp4x` (extracted from voxelfishing.com bundle)
- **Game endpoints**: `https://voxelfishing.com/api/...` (REST, requires Bearer token)
- **Realtime**: `wss://voxelfishing.com/api/ws` (character setup + state sync)

### Game endpoints covered (`lib/api.js`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/me/magnet-cast` | Server-side cast with magnet |
| `POST` | `/api/me/meme-cast` | Meme token cast |
| `GET` | `/api/me/meme-fish` | Meme fish inventory |
| `POST` | `/api/me/grants/claim` | Daily grant claim |
| `POST` | `/api/me/relic-set-claim` | Relic set bonus |
| `POST` | `/api/me/fish/sell` | Sell caught fish (max 500/call) |
| `POST` | `/api/me/fish/consume` | Consume fish (e.g. Abyss Lurker → Abyssal Aura) |
| `POST` | `/api/me/pet/sell` | Sell pet |
| `POST` | `/api/me/shop/buy` | Buy pet eggs |
| `GET` | `/api/me/save` | Player save data + inventory |

### SIWS Message Format (Privy-specific)

```
{domain} wants you to sign in with your Solana account:
{address}

You are proving you own {address}.

URI: {uri}
Version: 1
Chain ID: mainnet
Nonce: {nonce}
Issued At: {issuedAt}
Resources:
- https://privy.io
```

Source: `@privy-io/js-sdk-core/dist/esm/solana/createSiwsMessage.mjs`.

**Gotcha**: Privy SIWS messages **must** include `Chain ID: mainnet`, the `You are proving you own {address}.` statement, and the `Resources: - https://privy.io` footer. Standard SIWS templates without these fields return `Invalid SIWS message and/or nonce`.

---

## Project structure

```
voxelfishing-bot/
├── bot.js                 # v1: minimal loop (cast → sell → save)
├── bot-v2.js              # v2: full feature set (character, meme, smart sell)
├── lib/
│   ├── auth.js            # Privy SIWS sign-in flow
│   ├── api.js             # Thin REST wrapper around game endpoints
│   ├── character.js       # Boat/color allowlist + WebSocket character setup
│   ├── wallet.js          # Multi-format Phantom key parser
│   ├── accounts.js        # Load accounts.json + persist tokens.json
│   └── humanize.js        # Gaussian timing + jitter helpers
├── accounts.example.json  # Template (copy to accounts.json)
├── package.json
├── package-lock.json
├── .gitignore             # Excludes accounts.json + tokens.json
└── README.md
```

---

## Setup

```bash
cd /root/voxelfishing-bot
npm install
cp accounts.example.json accounts.json
# Edit accounts.json with your Phantom private keys + proxies
```

### `accounts.json` fields

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `name` | ✅ | — | Unique label for logs |
| `wallet` | ✅ | — | Phantom private key (any format) |
| `proxy` | ❌ | `null` | `socks5://user:pass@host:port` or `http://...` |
| `enabled` | ❌ | `true` | Skip account when `false` |
| `character.mode` | ❌ | `skip` | `skip` (never touch), `config` (force on every run), `auto` (set first run, then skip) |
| `character.name` | ❌ | random | Captain name (max 24 chars) |
| `character.boat` | ❌ | `tugboat` | Boat ID — see [Boats](#boats) |
| `character.hull` | ❌ | `#a9743f` | Hull color hex (`#RRGGBB`) |
| `character.accent` | ❌ | `#7fd4e8` | Accent color hex (`#RRGGBB`) |
| `claimGrants` | ❌ | `true` | Claim daily grants on startup |
| `claimRelicSet` | ❌ | `true` | Claim relic set bonus |
| `magnetMode` | ❌ | `on` | `on` / `off` |
| `memeMode` | ❌ | `off` | `off` / `parallel` (secondary cast loop) |
| `memeMaxPerCycle` | ❌ | `1` | Max meme casts per main cycle |
| `sellMode` | ❌ | `auto` | `auto` / `threshold` / `off` |
| `sellThreshold` | ❌ | `50` | Fish count threshold for `threshold` mode |
| `sellMaxRarity` | ❌ | `rare` | Top rarity to sell (`common`/`uncommon`/`rare`/`epic`/`mythical`/`legendary`/`off`) |
| `keepMythics` | ❌ | `true` | Defense: never sell mythical+ fish (recommended) |
| `consumeAbyssLurker` | ❌ | `true` | Auto-consume Abyss Lurker for Abyssal Aura |
| `consumeTargets` | ❌ | `["abysslurker"]` | List of speciesIds to auto-consume |
| `sellPets` | ❌ | `off` | `off` / `auto` |

### Wallet formats accepted

`lib/wallet.js` auto-detects format and normalizes to a `Keypair`:

- **Phantom JSON export**: `[12,34,56,...]` (64 bytes)
- **base58**: `5xK9...` (Phantom "Export Private Key")
- **base64**: `U3VQRXJ...`
- **Hex (with `0x` prefix)**: `0xab12...` — 128 chars = 64 bytes, 64 chars = 32-byte seed
- **Hex (no prefix)**: `ab12cd...` — same length rules; auto-detected

The parser rejects invalid lengths and malformed input with clear error messages. Tested with 7 valid formats + 5 negative cases.

> ⚠️ **NEVER commit `accounts.json`** — it contains private keys. Already in `.gitignore`.

### Character setup mode (`character.mode`)

The bot **detects the current character from the server** (via WS `players` broadcast) before doing anything. This avoids the "bot overwrote my carefully-picked boat" problem. Three modes:

| Mode | Behavior | When to use |
|------|----------|-------------|
| `skip` *(default)* | Detect only, **never** send `rename`/`appearance` | You manage character in the browser, bot should leave it alone |
| `config` | Detect, then **force** `accounts.json` values on every run | You want the bot to own character state and sync it to your config |
| `auto` | Detect, compare to `.hermes/character-<id>.json` cache. **Set on first run only**, then skip until you change config | Idempotent character set — bot sets it once, doesn't touch it again |

**Why not just "always set"?** Server stores character per playerId, but there's no "fetch current" REST endpoint. WS `welcome` doesn't echo character; only `players` broadcasts do. So the bot connects, sends a minimal hello, waits for the first `players` snapshot, reads its own row, and acts.

**Auto-mode state file**: `bot/.hermes/character-<acctId>.json` (gitignored). Delete it to force a re-set on next run.

**Example — keep your browser character**:

```json
{
  "name": "main",
  "wallet": "...",
  "character": { "mode": "skip" }
}
```

**Example — bot owns the character, set once, never touch again**:

```json
{
  "name": "alt",
  "wallet": "...",
  "character": {
    "mode": "auto",
    "name": "Kraken Hunter",
    "boat": "pirateBoat",
    "hull": "#c44f4f",
    "accent": "#f5c542"
  }
}
```

---

## Run

### v1 (minimal loop)

```bash
npm start                       # run all enabled accounts in parallel
npm run auth                    # sign-in only, write tokens.json, exit
node bot.js --account main      # single account
node bot.js --once              # 3 cycles then exit (smoke test)
node bot.js --no-proxy          # ignore account.proxy
node bot.js --verbose           # log all API calls
```

### v2 (full feature set — recommended)

```bash
npm run start:v2                # run all enabled accounts (v2)
npm run auth:v2                 # sign-in only (v2)
npm run once                    # 3 cycles then exit
npm run account -- main         # single account by name
```

### CLI flags (work for both v1 and v2)

| Flag | Effect |
|------|--------|
| `--auth-only` | Just refresh tokens, then exit |
| `--account <name>` | Run only the named account |
| `--once` | 3 cycles per account, then exit |
| `--no-proxy` | Force direct connection |
| `--verbose` | Log every API call |

---

## Boats

26 boat IDs supported. The first 7 are free; the other 19 are premium (priced or reward-only).

### Free

| ID | Name | Blurb |
|----|------|-------|
| `tugboat` | Tugboat | Chunky harbour classic |
| `sailboat` | Sailboat | Breezy and graceful |
| `fishingBoat` | Fishing Boat | Built for the catch |
| `speedboat` | Speedboat | Zippy little racer |
| `pirateBoat` | Pirate Boat | Yarr, plunder the seas |
| `cargoBoat` | Cargo Boat | Hauls a heavy load |
| `rowboat` | Rowboat | Humble and cozy |

### Premium (sample — see `lib/character.js` for full list)

| ID | Name | Price |
|----|------|-------|
| `goldTugboat` | Metallic Gold | 30,000 |
| `platinumTugboat` | Metallic Platinum | 50,000 |
| `diamondTugboat` | Diamond Crystal | 100,000 |
| `catBoat` | Void Kitty | 500 |
| `pepeBoat` | Pepe Boat | 500 |
| `wifBoat` | Wif | 500 |
| `luffyBoat` | Monkey D. Luffy | 5,000 |
| `spiderBoat` | Spider-Man | reward-only |
| `squidBoat` | Kraken's Vessel | reward-only |

> **Validation**: The server validates `boatType` against the allowlist and rejects unknown IDs. Hex colors must match `/^#[0-9a-fA-F]{6}$/`. Names are auto-truncated to 24 chars.

---

## Color palettes

The frontend picker offers these 10 hull + 10 accent colors, but the server accepts **any** valid 6-digit hex.

**Hull**: `#a9743f` `#c0552f` `#3f6fa9` `#3f9a7a` `#9a3f6f` `#6a4f8a` `#d4a73f` `#4a5560` `#c44f4f` `#e6e0d4`

**Accent**: `#7fd4e8` `#f5c542` `#d6483b` `#7be07b` `#ff8fc8` `#b48cff` `#f4f1e8` `#2b2b33` `#ff7a3d` `#3de0d0`

---

## Smart sell logic

The bot protects against accidentally selling your best fish:

1. **Rarity ceiling** (`sellMaxRarity`): fish above this tier are never sold.
2. **Mythic defense** (`keepMythics`, default `true`): mythical+ fish are NEVER sold, regardless of ceiling. (You want to **consume** these for auras, not sell.)
3. **Filter order**: `keepMythics` check first, then ceiling check, then sell.

Example policy `{sellMaxRarity: "rare", keepMythics: true}`:
- ✅ Sells: common, uncommon, rare
- ❌ Skips: epic, mythical, legendary (both filters)
- 🌟 Consumed separately (Abyss Lurker → Abyssal Aura)

To sell literally everything except mythics:
```json
{ "sellMaxRarity": "legendary", "keepMythics": true }
```

To turn off selling entirely:
```json
{ "sellMaxRarity": "off" }
```

---

## Humanize

To avoid bot detection, the bot:

- **Per-cycle pause**: 3-9s, with 8% chance of 10-16s (mimics "rest")
- **Magnet cast cycle**: 3-5s baseline with gaussian jitter
- **30% chance** of extra 1.5-4s pause after cast
- **Sell batches**: ≤100 uids per request, 1.5-3.5s between batches
- **All inter-action delays**: `gaussianDelay` distribution

---

## Verified (2026-06-22)

### v1 smoke test (parallel sign-in)

```
[i] VoxelFishing bot v1.0 — 2026-06-22T03:24:54.571Z
[i] Loaded 2 account(s): acc1, acc2
[acc1] signing in via Privy SIWS…
[acc2] signing in via Privy SIWS…
[✓] [acc1] signed in: 9zHbKgV9pGw38ZsVoTvg9mqZo43FbL7J732u4E1DUFVD
[✓] [acc2] signed in: 79sZSKiU5RwFVzs8WPBEya4K9mLHKQSJ2QBVAoud71Wa
[acc1] cast #1 (magnet): {"ok":true,"outcome":"chest","chestCoins":150,...}
[acc2] cast #1 (magnet): {"ok":true,"outcome":"junk","junkId":"tin_can",...}
[✓] [acc1] finished after 17s (3 cycles)
[✓] [acc2] finished after 16s (3 cycles)
```

### v2 character setup (reverse-engineered from bundle)

The character (name + boat + 2 colors) is set via WebSocket on `wss://voxelfishing.com/api/ws`. The bot:

1. Opens WS with `SocksProxyAgent` (if proxy configured)
2. Sends `{t: "hello", ..., authToken: <JWT>}` to authenticate
3. Sends `{t: "rename", name}` to set the captain name
4. Sends `{t: "appearance", boatType, hull, accent}` to set boat + colors
5. Closes the connection

Idempotent — safe to run on every startup.

---

## Notes & gotchas

- **NEVER generates new wallets** — uses only the private keys you provide.
- **Token cache** (`tokens.json`): if a saved token still passes probe, the bot reuses it. Otherwise re-signs in.
- **Per-account proxy**: SOCKS5 via `socks-proxy-agent`, HTTP/HTTPS via undici `ProxyAgent`.
- **Errors**: `401` → re-sign-in next cycle. Network errors → 15-30s backoff.
- **The 3D cast (mouse click on canvas)** cannot be done server-side — only the server-validated `magnet-cast` and inventory actions are automatable from Node. To automate the visual cast, use a browser/headless runner (Tampermonkey userscript or Puppeteer).
- **The game frontend caches character state in `localStorage`** under key `voxel-ocean-fishing-boat-v1`. The server is the source of truth for other players; bot character setup writes via WS regardless.

---

## License

MIT — but use responsibly. The author is not responsible for bans, losses, or other consequences.