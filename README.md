# VoxelFishing Bot v3 — Simple

> **Butuh setup cepet?** Loncat ke [Quick Start](#quick-start-untuk-pemula-5-menit) di bawah.
> Versi advanced (cast mode rod/magnet, smart sell, character setup, dll) → [v2 docs](#v2-advanced-features) di bawah.

Multi-account automation for [voxelfishing.com](https://voxelfishing.com) — Privy SIWS sign-in via Phantom, magnet-cast fishing loop, smart fish selling. Per-account SOCKS5/HTTP proxy + humanized timing to avoid detection.

> **Disclaimer**: Use at your own risk. The author is not responsible for any bans or losses. Respect the game's TOS.

---

## What's new in v3

- **`bot.js` rewritten from scratch** (377 lines) — simple, top-to-bottom readable, Indonesian-friendly comments. Anyone can follow.
- **Multi-account CLI helpers** — `add-account`, `edit-account`, `remove-account`, `enable`/`disable`/`toggle`. Tambah akun baru gak perlu edit JSON manual.
- **Setup wizard** — `npm run setup` buat first-time user. Detect placeholder wallet, prompt buat paste key (hidden input), test sign-in.
- **`accounts.example.json` simplified** — 53 lines (was 100+). Comments link ke README buat advanced fields.
- **Global `--no-proxy` flag** — paksa semua akun direct tanpa edit JSON.
- **v2 (advanced) preserved** — `npm run start:v2` masih jalan, fitur lengkap (cast mode, smart sell, character setup, dll).

---

## Quick Start (untuk pemula, 5 menit)

### 1. Install

```bash
cd /root/voxelfishing-bot
npm install
```

### 2. Setup akun pertama

```bash
npm run setup
```

Wizard bakal:
1. Cek `accounts.json` ada (copy template kalo belum)
2. Detect wallet placeholder, prompt lo paste Phantom private key (input di-mask `*****`)
3. Tanya proxy (ENTER buat skip)
4. Save + test sign-in (`--auth-only`)

Atau kalo lo males wizard:
```bash
npm run add-account
```

### 3. Run bot

```bash
npm run start              # jalanin semua akun (parallel)
npm run start -- --no-proxy        # paksa semua akun direct
npm run start -- --account utama  # cuma akun "utama"
npm run once               # smoke test (3 cycle per akun, terus exit)
npm run accounts           # lihat semua akun + status token
```

### 4. Tambah akun kedua

```bash
npm run add-account
# wizard: name? wallet? proxy? done.
```

Atau non-interactive:
```bash
npm run add-account -- --name alt --wallet "<PHANTOM_KEY>" --proxy "socks5://user:pass@host:1080" --cast-mode magnet
```

### 5. Cek status

```bash
npm run accounts
```

Output:
```
=== VoxelFishing: accounts ===

#   name        enabled  castMode  proxy              token        wallet
1   utama       ✓        magnet    —                  ✓           12jbY…W4P9n
2   alt         ✓        magnet    socks5://***@…:…  ✗           5xK9…xx
```

- ✓ enabled / ✗ disabled
- token ✓ = ada di `tokens.json` (sign-in OK), ✗ = perlu login ulang

### 6. Enable / disable akun

```bash
npm run enable  -- alt     # alt.enabled = true
npm run disable -- alt     # alt.enabled = false
npm run toggle  -- alt     # flip
```

### 7. Edit akun

```bash
npm run edit-account -- alt castMode rod
npm run edit-account -- alt proxy "socks5://newproxy:1080"
npm run edit-account -- alt enabled true
```

### 8. Hapus akun

```bash
npm run remove-account -- alt                # confirmation prompt
npm run remove-account -- alt --force        # skip prompt
```

---

## Proxy on/off — gimana caranya?

3 cara, sesuai kebutuhan:

| Level | Cara | Efek |
|---|---|---|
| **Per akun (recommended)** | `"proxy": "socks5://user:pass@host:1080"` di `accounts.json` | Akun spesifik pakai proxy |
| **Per akun direct** | `"proxy": null` di `accounts.json` | Akun spesifik direct |
| **Global override** | `npm run start -- --no-proxy` | Semua akun dipaksa direct (ignore JSON) |

Edit JSON:
```bash
npm run edit-account -- alt proxy "socks5://user:pass@host:1080"
npm run edit-account -- alt proxy null          # balik ke direct
```

Atau tambah akun baru langsung dari CLI:
```bash
npm run add-account -- --name alt2 --wallet "<KEY>" --proxy "socks5://..." --cast-mode magnet
```

Format proxy yang didukung: `socks5://`, `socks4://`, `http://`, `https://` (full URL with `user:pass@host:port`).

---

## File structure (v3 simple)

```
voxelfishing-bot/
├── bot.js                       ← main bot (simple, 377 lines, Indo comments)
├── bot-v2.js                    ← advanced bot (cast mode, smart sell, etc.)
├── lib/
│   ├── auth.js                  ← Privy SIWS sign-in
│   ├── api.js                   ← VoxelAPI wrapper (proxy-aware)
│   ├── wallet.js                ← Phantom multi-format parser
│   ├── accounts.js              ← JSON5 load + surgical writeback
│   └── humanize.js              ← random delay helpers
├── scripts/
│   ├── setup-wizard.js          ← first-time setup (`npm run setup`)
│   ├── add-account.js           ← add new account (`npm run add-account`)
│   ├── list-accounts.js         ← overview (`npm run accounts`)
│   ├── edit-account.js          ← edit field (`npm run edit-account`)
│   ├── toggle-account.js        ← enable/disable (`npm run enable/disable`)
│   └── remove-account.js        ← delete account (`npm run remove-account`)
├── accounts.json                ← YOUR accounts (gitignored, mode 600)
├── accounts.example.json        ← template (commit-safe, 53 lines)
├── tokens.json                  ← JWT cache per account (gitignored)
└── package.json
```

---

## v2 (advanced features)

<details>
<summary>Click to expand v2 docs (cast mode, smart sell, character setup, etc.)</summary>

</details>

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

### Multi-account management

```bash
npm run accounts              # show all accounts + token status
npm run add-account           # interactive wizard — append new account
npm run add-account -- --name alt --wallet 5xK9... --cast-mode rod   # non-interactive
npm run enable  -- alt        # set enabled = true
npm run disable -- alt        # set enabled = false
npm run toggle  -- alt        # flip current value
npm run edit-account -- alt castMode rod              # change one field
npm run edit-account -- alt proxy "socks5://user@host:1080"
npm run edit-account -- alt proxy ""                  # clear proxy (direct)
npm run remove-account -- alt                        # remove (asks confirmation)
npm run remove-account -- alt --force                 # skip confirmation
```

`accounts.json` accepts JSON5 — comments are preserved through edits (`jsonc-parser` surgical updates).

**Workflow:**
1. `npm run accounts` — see what's there
2. `npm run add-account` — answer name/wallet/proxy prompts (wallet hidden by default)
3. `npm run auth:v2 -- --account <name>` — sign-in + write tokens.json for new account
4. `npm run account -- <name>` — smoke test (3 cycles)
5. `npm run start:v2` — run all enabled accounts in parallel

Default behavior: accounts run in **parallel** (via `Promise.all`). Add `[// accounts]: ────────── multi-account helpers ──────────` (cosmetic, ignored by npm) — these are documentation lines, not real scripts.

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