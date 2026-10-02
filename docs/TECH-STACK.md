# WatchSync — Tech Stack and Deployment Plan

**Status:** Draft 2, 2 October 2026, rewritten for the extension-first plan (DEC-015). Choices are either backed by the PRD/TRD revisions or marked as proposals waiting on a Decision (DEC-xxx in Notion Plan v2).
**Scope:** everything needed to build, test, package, deploy and operate WatchSync from v0.1.0 to v1.0.0, plus the v1.1.0 desktop app.

Read with `docs/PRD.md` and `docs/TRD.md` (start with their "Scope revision v2" sections) and `CLAUDE.md`.

---

## 1. The whole system on one page

```text
  Person A's Chrome                                   Person B's Chrome
  ┌───────────────────────────────┐                   ┌───────────────────────────────┐
  │ netflix.com tab (own account) │                   │ netflix.com tab (own account) │
  │  ┌─────────────────────────┐  │                   │  ┌─────────────────────────┐  │
  │  │ content script          │  │                   │  │ content script          │  │
  │  │  Netflix adapter        │  │                   │  │  Netflix adapter        │  │
  │  │  overlay (shadow DOM)   │  │                   │  │  overlay (shadow DOM)   │  │
  │  └──────────┬──────────────┘  │                   │  └──────────┬──────────────┘  │
  │             │ runtime messages│                   │             │                 │
  │  ┌──────────▼──────────────┐  │                   │  ┌──────────▼──────────────┐  │
  │  │ background worker       │  │                   │  │ background worker       │  │
  │  └──────────┬──────────────┘  │                   │  └──────────┬──────────────┘  │
  └─────────────┼─────────────────┘                   └─────────────┼─────────────────┘
                │ WSS (room events, playback state, chat)           │
                └──────────────►  room service (FastAPI)  ◄─────────┘
                                  on Railway, rooms in memory

  Video: each person streams from the service to their own browser. WatchSync never touches it.
  Voice/camera (v0.4): browser ◄══ WebRTC P2P ══► browser, TURN relay only when needed.
```

---

## 2. Repository and packages

### 2.1 Monorepo layout

```text
watchsync/
├── apps/
│   ├── extension/          Chrome MV3 extension (v0.1)
│   ├── website/            Marketing site and docs (v1.0)
│   └── desktop/            Tauri app for local files (v1.1)
├── services/
│   └── signaling/          FastAPI room service (v0.1)
├── packages/
│   ├── protocol/           JSON Schema for every message + generated TS and Python
│   ├── sync-engine/        Pure TS: expected position, drift decisions
│   └── shared-types/       TS types shared by extension, website, desktop
├── docs/
├── .github/workflows/
├── CLAUDE.md
└── CHANGELOG.md
```

Folders appear when their release needs them. v0.1 has `apps/extension`, `services/signaling`, `packages/protocol` and `packages/sync-engine` only.

### 2.2 Package managers

| Area | Tool | Why |
|---|---|---|
| JavaScript/TypeScript | **pnpm workspaces** (proposal, DEC-005) | One lockfile across extension, packages and later website; strict boundaries |
| Python | **uv** | Python version, virtualenv, dependencies and `uv.lock` in one fast tool |
| Rust (v1.1 only) | **cargo** | Desktop app |

Lockfiles are committed. Dependencies are added only after the `CLAUDE.md` §10 checks. Dependabot or Renovate from v0.8.

### 2.3 Shared protocol (DEC-006)

Proposal: **JSON Schema is the single source** in `packages/protocol/schema/`. TypeScript types and Zod validators are generated for the extension; Pydantic models for the service. Generated code is committed and CI fails if regeneration changes anything. Every message uses the envelope `{ id, type, timestamp, payload }`.

v0.1 message families: `ROOM.*` (created, joined, user joined, user left, closed), `PRESENCE.*` (which service and title each person has open, in sync or on their own), `PLAYBACK.*` (play, pause, seek, rate, media changed, state snapshot), `SYS.*` (ping, error).

---

## 3. Browser extension (apps/extension)

### 3.1 Core stack

| Layer | Choice | Notes |
|---|---|---|
| Platform | **Chrome Manifest V3** | Chrome first. Edge uses the same build in v1.0; Firefox gets a build with its MV3 differences isolated in v1.0 |
| Language | **TypeScript (strict)** | |
| Build | **Vite** with multiple entries (background, content scripts, popup, page bridge) | A small Vite plugin or CRXJS for manifest and hot reload; decided at scaffold |
| UI | **React** for popup and (v0.2) sidebar; plain DOM + CSS for the tiny overlay if React is too heavy there | All injected UI in a **shadow root** |
| Styling | Tailwind CSS v4 or plain CSS with the design tokens as variables | Tokens from the design canvas |
| State | `chrome.storage.local` for name, current room, token; in-memory in the background worker | |
| Validation | Zod (generated) on every message between contexts and from the service | |
| Icons | Inline SVG set from the design canvas | |

### 3.2 Extension anatomy

| Part | Runs in | Job |
|---|---|---|
| Background service worker | Extension context | Owns the WebSocket to the room service, room state, routing between tabs and popup. Reconnects when Chrome wakes it (MV3 workers sleep) |
| Content script per supported site | Isolated world on the service page | Loads the right adapter, reports playback state, applies commands, renders the overlay (presence pill, notices, Sync button) |
| Page bridge (only if DEC-019 needs it) | Page's own context, injected script | Calls the player's own API when the video element can't be controlled directly (Netflix). Talks to the content script with `window.postMessage`, validated both ways |
| Popup | Extension page | Name, create or join room, code and link, people in the room, watch on my own, leave |
| Join page (`join.html`) | Extension page | Opens from invite links; also explains how to install when the extension is missing (via the website in v1.0, a simple hosted page before) |

### 3.3 Provider adapters

```ts
interface StreamingProvider {
  id: 'netflix' | 'prime' | 'jiohotstar' /* later: 'youtube' | 'disney' | … */;
  detect(): boolean;
  getState(): PlaybackState;         // playing, position, duration, rate, titleId, episodeId, inAd, buffering
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  onUserChange(cb: (s: PlaybackState) => void): () => void; // fires only for user-caused changes
}
```

| Service | Domains (host permissions) | Known risks to check in the spike (UC-002) |
|---|---|---|
| Netflix | `www.netflix.com` | Seeking the `<video>` element directly causes error M7375; control likely goes through the player's own API from page context. Title ID from `/watch/<id>`. Ad tier inserts ads per user |
| Prime Video | `www.primevideo.com`, `www.amazon.com/gp/video`, regional Amazon domains as needed | Ads on most plans; X-Ray overlay; multiple `<video>` elements during trailers |
| JioHotstar | `www.jiohotstar.com` (and `www.hotstar.com` redirects) | India-only; live sports vs on-demand; ads; player differs between live and on-demand |

The adapter only reads and commands playback. It never reads frames, keys or stream data (TRD §37).

### 3.4 Permissions (v0.1)

- `storage` (name, room, token)
- Host permissions for the three services' domains only, plus the room service's domain
- No `<all_urls>`, no `tabs` unless needed for the "open this title" prompt (decided in UC-005), no `scripting` beyond declared content scripts

### 3.5 Voice and camera (v0.4)

WebRTC runs inside an **extension-origin iframe** in the sidebar, so the mic and camera prompts and permissions belong to WatchSync, not the streaming site. Media goes through a `MediaTransport` interface: `PeerMediaTransport` in v0.4, `SFUMediaTransport` in v0.5 (DEC-007). Echo cancellation and noise suppression on by default.

---

## 4. Room service (services/signaling)

| Layer | Choice | Notes |
|---|---|---|
| Language | **Python 3.12+** | |
| Framework | **FastAPI** with Starlette WebSockets | Thin routes → services → domain → infrastructure |
| Server | **Uvicorn**, **one worker** while rooms live in memory | More instances need Redis first (DEC-003) |
| Models | **Pydantic v2** generated from protocol schemas | |
| Config | `pydantic-settings` | Documented in `.env.example` |
| Logging | `structlog`, JSON lines | Room session ID on every line; never titles, chat text or tokens |
| Rate limiting | In-process token buckets (v0.1) → Redis-backed (when scaled) | Create, join, messages, chat |
| Room codes | `secrets` module, 6 characters, unambiguous alphabet | |
| Tokens | Short-lived signed room tokens (PyJWT, per-room claims), revoked on leave | |

**Data by release:** memory (v0.1–v0.6) → Redis only if more than one instance is needed → **PostgreSQL** from v0.7 (SQLAlchemy 2.0 async, psycopg 3, Alembic, reversible migrations, tested backups). Accounts in v0.7 use Argon2id, short access tokens plus rotating refresh tokens stored in `chrome.storage`, and an email provider (DEC-013).

---

## 5. Real-time media infrastructure (v0.4+)

| Piece | When | Notes |
|---|---|---|
| STUN | v0.4 | Public STUN from config |
| TURN | v0.4 | **Managed TURN** with short-lived HMAC credentials minted by the room service (DEC-012). Railway can't host TURN because it doesn't expose UDP |
| SFU | v0.5 | **LiveKit Cloud** proposed (DEC-007); mediasoup on a UDP-capable VPS is the alternative. Not on Railway |

---

## 6. Website and docs (v1.0)

Proposal (DEC-014): **Astro** with React islands, MDX docs, Pagefind search, hosted on **Cloudflare Pages**. It links to the Chrome Web Store, Edge Add-ons and Firefox Add-ons listings. Before v1.0, a single static page hosts the install guide and the "you need the extension" landing for invite links. Brief: `docs/WEBSITE-PROMPT.md` (needs an extension-first update).

---

## 7. Desktop app (v1.1)

Tauri 2, React, TypeScript, Rust, as designed in Plan v1 and the original TRD §4–6, §25, §35, §62–64: local file playback in sync, signed and notarized `.dmg`, universal binary, macOS 13 minimum (DEC-011, deferred). It joins the same rooms through the same protocol. Re-plan in detail when v1.0 ships.

---

## 8. Testing stack

| Level | Tools | Covers |
|---|---|---|
| TS unit | **Vitest** | sync-engine math (positive and negative drift), message validation, adapters against recorded player-state fixtures |
| Python | **pytest**, `pytest-asyncio`, `httpx`, Starlette `TestClient` for WebSockets | Rooms, tokens, playback state, rate limits |
| Extension E2E | **Playwright** with the unpacked extension loaded in a persistent Chromium context, against a **local mock player page** that mimics each service's player | Popup flows, cross-context messaging, overlay, two-client sync logic |
| Real services | **Manual two-person acceptance** on real accounts | Automated Chromium has no Widevine DRM, so Netflix, Prime Video and JioHotstar can't play in CI |
| Network | Chrome DevTools throttling; `tc netem` for service tests | v0.6 scenarios |
| Accessibility | `axe-core` in Vitest/Playwright | Popup, overlay, sidebar |

Lint and format: **Biome** for TS (proposal) and **ruff** + **mypy** (strict) for Python.

---

## 9. Environments

| Environment | Extension build | Room service | Database | From |
|---|---|---|---|---|
| development | `pnpm dev` with hot reload, pointing at `localhost:8000` | Local Uvicorn | None until v0.7 | Your machine |
| staging | Build with staging URLs, loaded unpacked by testers | Railway `staging` | Railway Postgres (v0.7+) | `dev`, automatic |
| production | Store build | Railway `production` | Railway Postgres (v0.7+) | `main` after a release merge |

The extension bundle contains only public URLs. Service variables (Railway): `ENVIRONMENT`, `ALLOWED_ORIGINS` (the extension origin `chrome-extension://<id>`), `ROOM_TOKEN_SECRET`, `ROOM_IDLE_EXPIRY_SECONDS`, rate-limit settings; from v0.4 `TURN_SHARED_SECRET`, `TURN_URLS`, `STUN_URLS`; from v0.7 `DATABASE_URL`, `EMAIL_API_KEY`.

A fixed extension ID (from the `key` field in the manifest) keeps `ALLOWED_ORIGINS` and invite links stable across unpacked and store builds.

---

## 10. CI/CD (GitHub Actions)

**Every pull request into `dev`:** pnpm install, Biome, `tsc --noEmit`, Vitest, extension build, Playwright mock-player E2E; uv sync, ruff, mypy, pytest; protocol drift check; gitleaks. Any failure blocks the merge. All jobs run on `ubuntu-latest`.

**Merge into `dev`:** Railway redeploys staging; the workflow attaches a zipped staging extension build as an artifact.

**Release (tag `vX.Y.Z` on `main`):**
1. The Ship use case merges `dev` into `main` and creates the tag (pushed only with the owner's approval).
2. The release workflow builds the production extension, zips it, attaches it to a **GitHub Release** with notes from `CHANGELOG.md`.
3. Upload to the Chrome Web Store: manual in v0.1–v0.7 (unlisted per DEC-020), automated with the Chrome Web Store API from v0.8.
4. Railway redeploys production from `main`.

**Versioning:** semver. One script updates `manifest.json`, `package.json` files and the service's `__version__` together. The version shows in the popup and in `GET /health`.

---

## 11. Hosting and deployment by component

| Component | Where | How |
|---|---|---|
| Room service | **Railway** (one service) | Auto from `dev` (staging) and `main` (production); health check on `/health`. A deploy resets in-memory rooms (known issue until Redis) |
| Extension | **Chrome Web Store** (unlisted v0.1–v0.7, public from v0.8); zip on GitHub Releases | Per release |
| Invite landing page | Static page (Cloudflare Pages) | Before v1.0; replaced by the website |
| PostgreSQL | Railway (v0.7) | Migrations as a pre-deploy command |
| TURN | Managed provider (v0.4) | Env vars |
| SFU | LiveKit Cloud or VPS (v0.5) | Separate from Railway |
| Website | Cloudflare Pages (v1.0) | Auto from `main` |
| Desktop app | GitHub Releases `.dmg` (v1.1) | Tag workflow on macOS runners |

---

## 12. Observability and operations

Railway logs (JSON) and `GET /health` from v0.1. Sentry for the extension and service from v0.8 with titles, URLs, chat and names scrubbed and a user switch to turn it off. Uptime checks on `/health` from v0.8. A few anonymous metrics tied to PRD questions from v0.8: rooms created, join success, median drift per service, reconnect rate.

---

## 13. Security baseline

HTTPS and WSS only outside development. CORS and WebSocket origin checks limited to the extension ID and the website. Every message validated against the protocol. Room codes from `secrets`; joins rate-limited. Minimal host permissions. Content Security Policy for extension pages forbids remote scripts (an MV3 requirement anyway). Secrets only in Railway variables and GitHub Actions secrets; gitleaks in CI.

---

## 14. Cost outline

| Item | When | Rough cost |
|---|---|---|
| Railway (room service) | v0.1 | Hobby plan, about $5/month plus usage |
| Chrome Web Store developer registration | v0.1 (if unlisted listing, DEC-020) | One-time $5 fee |
| Static landing page | v0.1 | Free tier |
| TURN | v0.4 | Usage-based; free tiers cover testing |
| SFU | v0.5 | Free tier for testing, usage-based after |
| Domain | when the landing page needs one | About $10–40/year |
| Sentry | v0.8 | Free tier at first |
| Apple Developer Program | v1.1 (desktop signing) | $99/year |

v0.1 runs on a few dollars a month: video never touches our servers.

---

## 15. Open decisions this document depends on

| ID | Question | Proposal | Needed by |
|---|---|---|---|
| DEC-005 | Package manager | pnpm workspaces; uv for Python | UC-001 |
| DEC-006 | Protocol type source | JSON Schema → generated TS, Zod, Pydantic | UC-001 |
| DEC-019 | How each player is read and controlled | Decided by the UC-002 spike | End of S01 |
| DEC-020 | How friends install v0.1 | Unlisted Chrome Web Store listing | UC-012 |
| DEC-021 | Services after the first three | By demand | UC-018 |
| DEC-012 | TURN provider | Managed TURN | UC-021 |
| DEC-007 | SFU | LiveKit Cloud | UC-024 |
| DEC-013 | Email provider | Resend or Postmark | UC-029 |
| DEC-014 | Website stack | Astro on Cloudflare Pages | UC-038 |
