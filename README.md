<p align="center">
  <a href="https://watchsync.space"><img src="apps/website/public/og.png" alt="WatchSync: press play here, it plays there." width="720" /></a>
</p>

<p align="center">
  <strong>Movie night with friends in other cities, in sync.</strong><br />
  A browser extension for Chrome and Brave. Each of you watches on your own Netflix, Prime Video or JioHotstar account; WatchSync keeps the tabs in step.
</p>

<p align="center">
  <a href="https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip"><strong>Download</strong></a>
  ·
  <a href="https://watchsync.space">Website</a>
  ·
  <a href="https://watchsync.space/install/">How to install</a>
  ·
  <a href="CHANGELOG.md">Release notes</a>
  ·
  <a href="https://watchsync.space/faq/">FAQ</a>
</p>

<p align="center">
  <a href="https://github.com/SuhaasNv/watchsync/actions/workflows/ci.yml"><img src="https://github.com/SuhaasNv/watchsync/actions/workflows/ci.yml/badge.svg?branch=dev" alt="CI" /></a>
</p>

## How it works

1. **Make a room.** Click WatchSync, pick a name, create a room and send the link to your friends.
2. **Open the same title.** If someone is on another episode, WatchSync offers to open the right one.
3. **Press play.** Play, pause and skips reach everyone. When someone hits an ad or a slow connection, the room waits for them and says why, then starts again together.

## Works with

| Service | Play, pause, skip | Next episode | Waits for ads |
|---|---|---|---|
| Netflix | Yes | Yes | Waits while someone buffers |
| Prime Video | Yes | Friends pick it in the player | Yes, with the time left |
| JioHotstar | Yes (not live streams) | Yes | Yes, still being checked on real accounts |

Not affiliated with Netflix, Amazon or JioStar.

## Install

WatchSync isn't in the Chrome Web Store yet, so you load it yourself. It takes a minute:

1. [Download the zip](https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip) and unzip it. Keep the folder.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Pin WatchSync from the puzzle icon in the toolbar.

The [install guide](https://watchsync.space/install/) walks through it with pictures. When a new version is out, the popup tells you.

## Privacy

WatchSync shares only what keeps you in sync: your name, the room, and whether you're playing or paused and where. It never reads the picture, records anything, or touches your account. Rooms live in memory and disappear soon after everyone leaves. Details: [privacy notice](https://watchsync.space/privacy/).

## For developers

A pnpm monorepo: the extension (`apps/extension`, Manifest V3, TypeScript, React popup), the room service (`services/signaling`, FastAPI and WebSockets), the website (`apps/website`, Astro) and the shared protocol (`packages/protocol`, JSON Schema).

```bash
pnpm install
cd services/signaling && uv sync && uv run uvicorn app.main:app --reload   # room service on :8000
pnpm --filter @watchsync/extension dev                                     # builds apps/extension/dist, rebuilds on change
```

Load `apps/extension/dist` with **Load unpacked**. Before a merge, run `pnpm check` (lint, types, unit tests, the extension's end-to-end tests against a mock player, and the room service's tests). The website runs with `pnpm --filter @watchsync/website dev` and tests with `pnpm --filter @watchsync/website e2e`.

Releases are tags on `main`; each one publishes the zip above. Deploys and releases: [docs/DEPLOY.md](docs/DEPLOY.md). Product and architecture: [docs/PRD.md](docs/PRD.md), [docs/TRD.md](docs/TRD.md), [docs/TECH-STACK.md](docs/TECH-STACK.md). How far each part really is: [docs/MATURITY.md](docs/MATURITY.md).

Questions or problems: suhaasnvs@gmail.com.
