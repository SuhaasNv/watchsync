# Deploying and releasing

**Production:** https://room-service-production-e5dd.up.railway.app (Railway project `watchsync`, service `room-service`, region us-west2, environment `production`).

## Environments (DEC-026)

Dev is for experimenting and testing with friends; it may break. Production is `main`: tagged, tested releases only.

| | dev | production |
|---|---|---|
| Git | branch `dev`, every merged use case | branch `main`, only at a release tag |
| Railway environment | `dev` (forked from production) | `production` |
| Room service | its own subdomain (repository variable `DEV_API_URL`), `PUBLIC_URL` to match, **sleep on** | `join.watchsync.space`, sleep off (sleeping ends rooms) |
| Website | its own subdomain (repository variable `DEV_SITE_URL`), `PUBLIC_CHANNEL=dev` (testing strip, noindex, dev download), **sleep on** | `watchsync.space` and `www`, `PUBLIC_SITE_URL=https://watchsync.space` |
| Deploys | Railway auto-deploys `dev` after CI passes | Railway deploys `main`; `main` only moves in a Ship use case |
| Extension | "WatchSync Dev": `pnpm --filter @watchsync/extension zip:dev` with `WATCHSYNC_API` set; DEV badge; checks `dev-latest` for updates | "WatchSync": `pnpm --filter @watchsync/extension zip` |
| Download | rolling pre-release `dev-latest` (`.github/workflows/dev.yml` after CI on `dev`) | GitHub Release `vX.Y.Z` (`release.yml`, tag must be on `main`) |

Invite links use the room service's domain (`__API_URL__/j/CODE`), so a production build against `https://join.watchsync.space` copies links like `https://join.watchsync.space/j/ABC234`.

Repository variables: `DEV_API_URL` (dev room service URL, required by `dev.yml`), `DEV_SITE_URL` (dev website, linked from the Dev build's popup; the dev hostnames are kept out of the repository) and `PROD_API_URL` (production room service URL for release builds; while unset, `zip` uses `https://join.watchsync.space`; the Railway URL above keeps working for installs built before the switch).

Cost: the dev services sleep when idle, so they cost almost nothing when nobody is testing. The first request after a sleep takes a few seconds. Never turn sleep off in dev, and never turn it on in production.

Scaling: environments differ only in variables. If one room-service instance is no longer enough, add Redis to the environment and share room state through it (DEC-003 stays until then).

## How it runs

- Image: `Dockerfile.signaling`, built from the repo root because the service reads the shared schema in `packages/protocol/schema`.
- One uvicorn worker, because rooms live in memory (DEC-003). A redeploy no longer ends the rooms (DEC-031, UC-046): on SIGTERM the service closes every connection with code 4002 ("restarting"), the extension says "WatchSync is updating, back in a moment" and retries every 1 to 3 s, and the new process brings each room back from its people's signed tokens (same code, same names; the first person back restores the title and position). Chat history does not come back. Rooms are restored only within `RESTORE_WINDOW_SECONDS` (default 600) of the new process starting.
- `ROOM_SIGNING_SECRET` (required in production, at least 32 bytes; the service refuses to start without it): signs room tokens. Generate it once with `openssl rand -base64 48`, set it as a service variable on Railway (each environment its own), and keep it across deploys. Changing it ends every open room: old tokens stop verifying and the extension tells people the room has ended. Never commit it, never log it.
- Logs: no access log and `--log-level warning`, because WebSocket URLs carry room tokens (BUG-003).
- The process runs as a non-root user. WebSocket frames are capped at 16 KB and request bodies at 2 KB.
- `TRUST_PROXY=1` (set in `Dockerfile.signaling`): per-client limits key on `X-Real-IP` instead of the TCP peer, which on Railway is always the edge. See "Client addresses" below.
- Abuse limits (defaults; override with service variables): `CREATE_PER_MINUTE=10` and `JOIN_PER_MINUTE=30` per client, `FAILED_JOINS_PER_MINUTE=100` wrong codes from everyone together (past it every join gets 429 for the rest of the minute, BUG-042), `ROOMS_PER_IP=3` live rooms per client that nobody else has joined (BUG-040), `WS_PER_IP=20` open WebSockets per client, `WS_IDLE_SECONDS=120` before a socket that sends nothing (not even the extension's 20 s pings) is closed with 1001, `UNUSED_ROOM_EXPIRY_SECONDS=120` for rooms nobody ever connected to, `ROOM_IDLE_EXPIRY_SECONDS=900` for rooms that have emptied, `MAX_ROOMS=2000` in all. A "client" is an IPv4 address or an IPv6 /64.
- Chat limits (US-043; defaults, override with service variables; the protocol caps `CHAT_MAX_CHARS` at 500 and `CHAT_HISTORY` at 200, so only lower those): `CHAT_MAX_CHARS=500` characters per message, counted in code points as the extension counts them; `CHAT_PER_5S=5` messages per person per 5 seconds (past it the sender gets `CHAT.REJECTED` `rate_limited` with their text back); `CHAT_HISTORY=200` messages a room keeps for people who join later, within `CHAT_ROOM_BYTES=65536` per room and `CHAT_TOTAL_BYTES=33554432` (32 MB) across all rooms; past either byte budget the oldest messages go first (the room's own, then the oldest anywhere). Chat text lives only in memory while its room exists and is deleted when the room ends or the service restarts (DEC-032). The service writes no chat text to its logs, and filters two known leaks out of uvicorn's loggers as a safety net: the WebSocket library's frame lines (DEBUG) and `token=` values in connection and access lines. That is not a reason to raise the level: production stays at `--log-level warning` with no access log, and debug logging is for a local machine only.

### Room tokens

A token is the room code, the person's id, their name and when it was issued, signed with `ROOM_SIGNING_SECRET` (HMAC-SHA256); anyone can read it, nobody can forge one. The extension sends it in the `Sec-WebSocket-Protocol` header (`watchsync.v1, <token>`), so it is not in any URL or access log; `?token=` still works for v0.1.x extensions until v0.8. After a restart a token brings its room back from nothing only if it is under `TOKEN_MAX_AGE_SECONDS` (default 86400) old and not dated in the future (5 minutes of clock tolerance), within `RESTORE_WINDOW_SECONDS` of the start, within `MAX_ROOMS`, and within `RESTORES_PER_IP` rooms per client address (default 3). A room already back keeps taking its people's valid tokens after the window (a laptop that wakes up later). Someone who left a room brought back in this process can't come back with their old token. A live connection is checked against the room's own list, so a long night isn't cut off by the age limit.

What the room was watching comes from its people (ROOM.RESTORE), sent only by an extension the old service told it was restarting. For 10 seconds after a room is back, the most recent knowledge wins (the old service's time of the clock each one last heard), so a friend who was behind and reconnects first can't rewind everyone; a play, pause or jump made in the new process always wins.

The extension holds a Chrome update while it is in a room (an update clears the session storage that holds the room ticket) and applies it when the person leaves the room; otherwise Chrome applies it at the next browser start.

Accepted risks (security audit, October 2026):

- Which rooms ended, and who left, is kept in memory only (no disk, no database). After a restart, a token kept from a room that ended before it can bring that room back, and a token kept by someone who left can put them back in it while the room lives, within the age limit (24 h; bringing a room back from nothing also within the restore window). The extension drops its token when a room ends or the person leaves, so this takes someone deliberately keeping one. `test_a_room_ended_before_a_restart_is_bounded_by_token_age` pins the bound with two real processes.
- The token carries the person's display name in readable form. It no longer travels in URLs, so it doesn't reach logs.
- The service needs up to 2 seconds after SIGTERM to tell every connection it is restarting. Railway must leave more than that between SIGTERM and killing the process (owner to confirm in the service settings).

### Client addresses

The service reads `X-Real-IP` only when `TRUST_PROXY=1`; without it, a client-sent `X-Real-IP` is ignored (tested in `services/signaling/tests/test_rooms.py`). Railway's edge sets `X-Real-IP` to the client's remote address on every request it forwards (Railway docs, Networking > Specs & Limits > Technical specifications). The docs do not say in so many words that a value the client sent is replaced rather than passed through, so check it once on the dev service before relying on it, never on production:

```bash
# 31 wrong-code joins from one machine, each claiming a different address.
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$DEV_API_URL/api/v1/rooms/ZZZZZZ/join" \
    -H "content-type: application/json" -H "X-Real-IP: 203.0.113.$i" -d '{"name":"probe"}'
done
```

The last answer must be `429` (the edge replaced the header, so all 31 counted against your real address). If every answer is `404`, the header is client-controlled: stop and fix how the service finds client addresses before release. Checked: not yet (owner to run on dev).

Service settings, set on Railway rather than in a file:

| Setting | Value |
|---|---|
| Variables | `PORT=8080`, `PUBLIC_URL`, `RAILWAY_DOCKERFILE_PATH=Dockerfile.signaling`, `ROOM_SIGNING_SECRET` (secret, see above) |
| Healthcheck | `/health`, 30 s |
| Restart | on failure, up to 10 retries |
| Sleep | off (sleeping would end the rooms) |

## Deploy

Ask the owner first. Before the first deploy of v0.2, set `ROOM_SIGNING_SECRET` on the service, or the new version won't start (the old one keeps running). With it set, open rooms come back by themselves within seconds; tokens issued by v0.1.x are not signed, so rooms open during that one deploy still end.

```bash
railway link --project watchsync --service room-service --environment production
railway up --detach --service room-service
curl https://room-service-production-e5dd.up.railway.app/health
```

Then check the deploy logs for anything that shouldn't be there.

## Extension build for production

`pnpm --filter @watchsync/extension zip` builds against the production URL. Run the audits first (see UC-012).

## Releasing

A release is a version tag. Pushing it runs `.github/workflows/release.yml`. Each tag push needs the owner's approval, like any push.

1. Bump the version where it appears, keeping them equal: `apps/extension/package.json` (it becomes the manifest version and must match the tag), `services/signaling/pyproject.toml`, and `VERSION` in `services/signaling/app/config.py` (shown by `/health`).
2. Add a `## [X.Y.Z] - <date>` section to `CHANGELOG.md` with `### Added`, `### Fixed` and `### Known issues`. The release notes are that section, as printed by `node scripts/release-notes.mjs X.Y.Z`, followed by a "Check this download" section the workflow adds (commit, build link, SHA-256 of each file); the workflow fails if the section is missing.
3. Commit on `dev` (or merge `dev` into `main` in the Ship use case), then tag that commit: `vX.Y.Z` for a release, `vX.Y.Z-rc.N` for a release candidate.
4. With the owner's go-ahead: `git push origin vX.Y.Z`.

The workflow then:

- runs the full CI (`ci.yml`: lint, protocol drift, typecheck, unit tests, extension end-to-end, room service checks, secret scan);
- checks that the tag, without `v` and any `-rc.N`, equals the version in `apps/extension/package.json`, and stops with a clear error if not;
- runs `pnpm --filter @watchsync/extension zip` (production room service, never a mock build) and checks the manifest has no localhost permission;
- writes `SHA256SUMS.txt` and signs a build provenance attestation for both zips (`actions/attest-build-provenance`, pinned to a commit), so anyone can run `gh attestation verify watchsync-extension.zip -R SuhaasNv/watchsync`;
- publishes the GitHub Release `WatchSync vX.Y.Z` (with "(release candidate)" for an rc), notes from `CHANGELOG.md` plus the commit, a link to the run and the checksums, and three files: `watchsync-extension-vX.Y.Z.zip`, `watchsync-extension.zip` and `SHA256SUMS.txt`.

The website shows the zip's SHA-256 from the notes next to each download on `/releases/`, and the newest one in the install guide's "Is it safe?" section. Both read the ``- `file`: `hash` `` lines the script writes, so keep that format if the script changes.

Release candidates are published as normal releases, not prereleases, so `/releases/latest` serves them while friends test v0.1.

**Stable download URL** (always the newest release; the website links here):
`https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip`

Installed extensions ask `https://api.github.com/repos/SuhaasNv/watchsync/releases/latest` at most once a day, and the popup offers the download when that release's version (without `-rc.N`) is higher than the installed one. A candidate and its final release carry the same manifest version, so going from `v0.1.0-rc.2` to `v0.1.0` is not announced; tell testers directly.

If the workflow fails after it created the release, re-run it: it uploads the files again to the existing release and rewrites the notes, because a rebuilt zip has new checksums. To redo a release completely, delete the GitHub Release and the tag (owner approval), fix, and tag again.

## Website

The marketing site and downloads page (`apps/website`, a static Astro build) run as a second Railway service in the same project.

- Image: `Dockerfile.website`, built from the repo root. It installs the workspace with pnpm, runs `pnpm --filter @watchsync/website build`, and serves `apps/website/dist` with Caddy as a non-root user.
- Caddy's config is `apps/website/Caddyfile`: zstd/gzip, long immutable caching for `/_astro/*` and five minutes for everything else, security headers on every response (CSP allowing self, Google Fonts and `api.github.com`; HSTS; nosniff; `frame-ancestors 'none'`), and `/404.html` for missing pages.
- The CSP allows scripts only from the site's own files. Keep Astro from inlining scripts (for example `vite: { build: { assetsInlineLimit: 0 } }`), or an inlined script is blocked.
- `.dockerignore` is shared by both images, so it is an allowlist of what either Dockerfile copies. Add a path there when a Dockerfile starts copying it.

| Setting | Value |
|---|---|
| Service | `website`, same repo and project as `room-service` |
| Variables | `PORT=8080`, `RAILWAY_DOCKERFILE_PATH=Dockerfile.website` |
| Healthcheck | `/`, 30 s |
| Restart | on failure, up to 10 retries |

A website deploy doesn't touch the room service or its rooms. Check the image locally first:

```bash
docker build -f Dockerfile.website -t watchsync-website .
docker run --rm -p 8080:8080 watchsync-website
curl -sI http://localhost:8080/
```
