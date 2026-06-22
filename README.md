# VoxelFishing Bot v2.1

Multi-account automation for [voxelfishing.com](https://voxelfishing.com) — Privy SIWS sign-in via Phantom, **2 cast modes** (magnet / rod), smart fish selling, pet management, REST-based character detection. Per-account SOCKS5/HTTP proxy + humanized timing to avoid detection.

> **Disclaimer**: Use at your own risk. The author is not responsible for any bans or losses. This bot is for educational purposes — respect the game's TOS.

---

## What's new in v2.1

- **Cast mode switch** — `castMode: "magnet" | "rod"` per account. `rod` flips priority (meme-cast first, magnet as fallback when 402).
- **JSON5 `accounts.json`** — full `//` comment support. Surgical writeback via `jsonc-parser` preserves comments through character auto-detection.
- **UI overhaul** — colored emoji outcomes (`💰 coins`, `🎁 chest`, `🗑️ junk`, `📈 rod lvl 2`), per-cycle tally box, end-of-run summary.
- **Body-level error handling** — `{error:"insufficient_funds"}` and `{error:"rate_limited"}` (HTTP 200 with error in body) now caught cleanly.
- **REST-first character detection** — `skip` mode reads `/api/me/save.boatAppearance` via REST. No WS hello, no name overwrite. `config`/`auto` modes still use WS `applyCharacter`.

---

## Features

| Feature | Status |
|---------|--------|
| Multi-account parallel execution | ✅ |
| Privy SIWS sign-in (Phantom) | ✅ |
| Token cache (`tokens.json`) | ✅ |
| Per-account SOCKS5 / HTTP proxy | ✅ |
| **2 cast modes** (magnet / rod) | ✅ v2.1 |
| **REST character detection** (no WS overwrite) | ✅ v2.1 |
| Daily grants claim | ✅ |
| Relic set bonus claim | ✅ |
| Magnet cast loop | ✅ |
| Meme cast (primary or parallel) | ✅ |
| Smart fish selling (rarity filter, keep mythics) | ✅ |
| Auto-consume targets (Abyss Lurker → Abyssal Aura) | ✅ |
| Pet sell | ✅ |
| **Colored emoji UI + tally + end summary** | ✅ v2.1 |
| Humanize timing (gaussian + jitter) | ✅ |

---

## Stack

- **Runtime**: Node.js ≥ 18 (ESM)
- **Auth**: Privy SIWS (Sign-In With Solana) via Phantom
- **App ID**: `cmpxg3h0o00400dla4si4jp4x` (extracted from voxelfishing.com bundle)
- **Game endpoints**: `https://voxelfishing.com/api/...` (REST, requires Bearer token)
- **Realtime**: `wss://voxelfishing.com/api/ws` (character setup + state sync, used in `config`/`auto` modes only)

### Game endpoints covered (`lib/api.js`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/me/magnet-cast` | Server-side cast with magnet |
| `POST` | `/api/me/meme-cast` | Meme token cast (returns body-level errors: `insufficient_funds`, `rate_limited`) |
| `GET`  | `/api/me/meme-fish` | Meme fish inventory |
| `POST` | `/api/me/grants/claim` | Daily grant claim |
| `POST` | `/api/me/relic-set-claim` | Relic set bonus |
| `POST` | `/api/me/fish/sell` | Sell caught fish (max 500/call) |
| `POST` | `/api/me/fish/consume` | Consume fish (e.g. Abyss Lurker → Abyssal Aura) |
| `POST` | `/api/me/pet/sell` | Sell pet |
| `POST` | `/api/me/shop/buy` | Buy pet eggs |
| `GET`  | `/api/me/save` | Player save data + `boatAppearance` |

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
├── bot.js                 # v1: minimal loop (cast → sell → save) — legacy
├── bot-v2.js              # v2: full feature set (character, meme, smart sell, UI)
├── lib/
│   ├── auth.js            # Privy SIWS sign-in flow
│   ├── api.js             # Thin REST wrapper around game endpoints
│   ├── character.js       # Boat/color allowlist + REST & WS character setup
│   ├── wallet.js          # Multi-format Phantom key parser
│   ├── accounts.js        # JSON5 load + surgical jsonc-parser writeback
│   └── humanize.js        # Gaussian timing + jitter helpers
├── accounts.example.json  # JSON5 template (commit-safe) — copy to accounts.json
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
node bot-v2.js --once        # smoke test (3 cycles, exit)
```

`accounts.json` accepts **JSON5** syntax — use `//` comments freely. Comments are preserved through character writeback (surgical edits via `jsonc-parser`).

### `accounts.json` fields

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `name` | ✅ | — | Unique label for logs |
| `wallet` | ✅ | — | Phantom private key (any format — see [Wallet formats](#wallet-formats-accepted)) |
| `proxy` | ❌ | `null` | `socks5://user:pass@host:port` or `http://...` |
| `enabled` | ❌ | `true` | Skip account when `false` |
| `claimGrants` | ❌ | `true` | Claim daily grants on startup |
| `claimRelicSet` | ❌ | `true` | Claim relic set bonus |
| **`castMode`** | ❌ | `magnet` | `magnet` / `rod` — see [Cast modes](#cast-modes) |
| `magnetMode` | ❌ | `on` | `on` / `off` |
| `memeMode` | ❌ | `off` | `off` / `parallel` / `sequential` |
| `memeMaxPerCycle` | ❌ | `1` | Max meme casts per main cycle |
| `sellMode` | ❌ | `off` | `on` / `off` |
| `sellThreshold` | ❌ | `50` | Fish count threshold |
| `sellMaxRarity` | ❌ | `rare` | Top rarity to sell (`common`/`uncommon`/`rare`/`epic`/`legendary`/`mythic`) |
| `keepMythics` | ❌ | `true` | Never sell mythics (recommended) |
| `consumeAbyssLurker` | ❌ | `true` | Auto-consume Abyss Lurker for Abyssal Aura |
| `consumeTargets` | ❌ | `["abysslurker"]` | List of speciesIds to auto-consume |
| `sellPets` | ❌ | `off` | `off` / `auto` |
| `character.mode` | ❌ | `skip` | `skip` / `config` / `auto` — see [Character setup mode](#character-setup-mode) |
| `character.boat` | ❌ | `tugboat` | Boat ID — see [Boats](#boats) |
| `character.hull` | ❌ | `#a9743f` | Hull color hex (`#RRGGBB`) |
| `character.accent` | ❌ | `#7fd4e8` | Accent color hex (`#RRGGBB`) |

> ⚠️ **NEVER commit `accounts.json`** — it contains private keys. Already in `.gitignore`.

### Wallet formats accepted

`lib/wallet.js` auto-detects format and normalizes to a `Keypair`:

- **Phantom JSON export**: `[12,34,56,...]` (64 bytes)
- **base58**: `5xK9...` (Phantom "Export Private Key")
- **base64**: `U3VQRXJ...`
- **Hex (with `0x` prefix)**: `0xab12...` — 128 chars = 64 bytes, 64 chars = 32-byte seed
- **Hex (no prefix)**: `ab12cd...` — same length rules; auto-detected

The parser rejects invalid lengths and malformed input with clear error messages. Tested with 7 valid formats + 5 negative cases.

---

## Cast modes

`castMode` switches which cast is **PRIMARY** each cycle:

| Mode | Magnet-cast | Meme-cast | When to use |
|------|-------------|-----------|-------------|
| **`magnet`** (default) | Primary (free) | Parallel (paid, secondary) | You want to build wealth on the free cast, occasionally spend on memes |
| **`rod`** | Fallback (when 402) | Primary (paid) | You have funds to burn and want to chase meme-fish |

### Example cycle — `castMode: "magnet"`

```
🟢 [utama] cycle 1 · magnet #1 → 💰 +25 coins (5 xp)
⚪ [utama] cycle 1 · meme #1 → ⚠ 402 insufficient (skip)
🟢 [utama] cycle 2 · magnet #2 → 🎁 +112 chest (30 xp) [rare]
🟢 [utama] cycle 2 · meme #2 → 🟢 23 success
🟢 [utama] cycle 3 · magnet #3 → 🗑️ junk (car_bumper)
⚪ [utama] cycle 3 · meme #3 → ⚠ 402 insufficient (skip)
```

### Example cycle — `castMode: "rod"`

```
🟢 [utama] cycle 1 · meme #1 → ⚠ 402 insufficient (skip)
🟢 [utama] cycle 1 · magnet #1 → 💰 +25 coins (5 xp) [fallback]
🟢 [utama] cycle 2 · meme #2 → 🟢 23 success
🟢 [utama] cycle 2 · magnet #2 → 💰 +18 coins (5 xp) [fallback]
```

### End-of-run summary (both modes)

```
✓ [utama] finished · 3 cycles · 13s · 💰 19 coins · ⭐ 15 xp
╭─ [utama] tally after 3 cycles (13s) ──────────
│ 💰 19 coins   ⭐ 15 xp
│ 🎁 0 chest   🗑️ 2 junk
│ 📈 0 rod upgrades   ⚠ 0 meme skipped
╰──────────────────────────────────────────────
```

---

## Character setup mode (`character.mode`)

| Mode | Detection | Behavior | When to use |
|------|-----------|----------|-------------|
| **`skip`** *(default)* | REST `/api/me/save.boatAppearance` | **Never** send `rename`/`appearance` | You manage character in browser, bot leaves it alone |
| `config` | REST first, then WS `applyCharacter` | Force `accounts.json` values every run | You want the bot to own character state and sync to your config |
| `auto` | REST first, then WS `applyCharacter` | Set once from cache, then skip until you change config | Idempotent set — bot sets once, doesn't touch again |

**Why REST for detection?** The `boatAppearance` lives in `/api/me/save` (server source of truth). Reading it via REST is reliable + cheap. WS `players` broadcasts only happen on connect, and the WS `hello` message doesn't echo character state. So `skip` mode uses REST to detect, and never opens WS at all (saves the 1s WS handshake + 100% avoids accidental name/boat overwrite).

**Auto-mode state file**: `.hermes/character-<id>.json` (gitignored). Delete to force a re-set on next run.

> **Note on `name`**: The character name lives in WS hello state (NOT in `saveData`). The bot cannot reliably read/write the name without overwriting it. **Set name in browser, not in `accounts.json`.**

---

## Run

```bash
npm run start:v2              # run all enabled accounts (v2)
npm run auth:v2               # sign-in only, write tokens.json, exit
npm run once                  # 3 cycles per account, then exit (smoke test)
npm run account -- main       # run single account by name
```

### CLI flags

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

> **Validation**: The server validates `boatType` against the allowlist and rejects unknown IDs. Hex colors must match `/^#[0-9a-fA-F]{6}$/`.

---

## Color palettes

The frontend picker offers these 10 hull + 10 accent colors, but the server accepts **any** valid 6-digit hex.

**Hull**: `#a9743f` `#c0552f` `#3f6fa9` `#3f9a7a` `#9a3f6f` `#6a4f8a` `#d4a73f` `#4a5560` `#c44f4f` `#e6e0d4`

**Accent**: `#7fd4e8` `#f5c542` `#d6483b` `#7be07b` `#ff8fc8` `#b48cff` `#f4f1e8` `#2b2b33` `#ff7a3d` `#3de0d0`

---

## Smart sell logic

The bot protects against accidentally selling your best fish:

1. **Rarity ceiling** (`sellMaxRarity`): fish above this tier are never sold.
2. **Mythic defense** (`keepMythics`, default `true`): mythic+ fish are NEVER sold, regardless of ceiling. (You want to **consume** these for auras, not sell.)
3. **Filter order**: `keepMythics` check first, then ceiling check, then sell.

Example policy `{sellMaxRarity: "rare", keepMythics: true}`:
- ✅ Sells: common, uncommon, rare
- ❌ Skips: epic, mythic, legendary (both filters)
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

### v2.1 cast mode + UI smoke test

```
✓ accounts.js switched to JSON5 + jsonc-parser surgical writeback
✓ castMode=magnet — backward compat, magnet PRIMARY, meme parallel
✓ castMode=rod — meme PRIMARY, magnet fallback on 402
✓ UI: emoji outcomes, per-cycle tally, end summary
✓ Body-level errors (insufficient_funds, rate_limited) handled
```

### v2 character setup (REST + WS)

- **`skip` mode** (default): REST `/api/me/save.boatAppearance` → read boat/hull/accent. **No WS** → no name overwrite.
- **`config`/`auto` modes**: REST detect first, then WS `applyCharacter` if mismatch.
- See [Character setup mode](#character-setup-mode-charactermode) for details.

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

---

## Notes & gotchas

- **NEVER generates new wallets** — uses only the private keys you provide.
- **Token cache** (`tokens.json`): if a saved token still passes probe, the bot reuses it. Otherwise re-signs in.
- **Per-account proxy**: SOCKS5 via `socks-proxy-agent`, HTTP/HTTPS via undici `ProxyAgent`.
- **Errors**:
  - `401` → re-sign-in next cycle.
  - `402` (meme-cast) → fall back to magnet (rod mode) or skip (magnet mode).
  - `429` → slow down (5-10s extra pause).
  - Body-level `{error:"insufficient_funds"}` (HTTP 200) → same as 402.
  - Body-level `{error:"rate_limited"}` with `waitMs` → wait that long.
  - Network errors → 15-30s backoff.
- **The 3D cast (mouse click on canvas)** cannot be done server-side — only the server-validated `magnet-cast` and inventory actions are automatable from Node. To automate the visual cast, use a browser/headless runner (Tampermonkey userscript or Puppeteer).
- **The game frontend caches character state in `localStorage`** under key `voxel-ocean-fishing-boat-v1`. The server is the source of truth for other players; bot character setup writes via WS only in `config`/`auto` modes.

---

## License

MIT — but use responsibly. The author is not responsible for bans, losses, or other consequences.