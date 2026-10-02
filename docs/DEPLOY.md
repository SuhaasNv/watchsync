# Deploying and releasing

**Production:** https://room-service-production-e5dd.up.railway.app (Railway project `watchsync`, service `room-service`, region us-west2, environment `production`).

## Environments (DEC-026)

Dev is for experimenting and testing with friends; it may break. Production is `main`: tagged, tested releases only.

| | dev | production |
|---|---|---|
| Git | branch `dev`, every merged use case | branch `main`, only at a release tag |
| Railway environment | `dev` (forked from production) | `production` |
| Room service | `join-dev.watchsync.space`, `PUBLIC_URL` to match, **sleep on** | `join.watchsync.space`, sleep off (sleeping ends rooms) |
| Website | `dev.watchsync.space`, `PUBLIC_CHANNEL=dev` (testing strip, noindex, dev download), **sleep on** | `watchsync.space` and `www`, `PUBLIC_SITE_URL=https://watchsync.space` |
| Deploys | Railway auto-deploys `dev` after CI passes | Railway deploys `main`; `main` only moves in a Ship use case |
| Extension | "WatchSync Dev": `pnpm --filter @watchsync/extension zip:dev` with `WATCHSYNC_API` set; DEV badge; checks `dev-latest` for updates | "WatchSync": `pnpm --filter @watchsync/extension zip` |
| Download | rolling pre-release `dev-latest` (`.github/workflows/dev.yml` after CI on `dev`) | GitHub Release `vX.Y.Z` (`release.yml`, tag must be on `main`) |

Invite links use the room service's domain (`__API_URL__/j/CODE`), so a production build against `https://join.watchsync.space` copies links like `https://join.watchsync.space/j/ABC234`.

Repository variables: `DEV_API_URL` (dev room service URL, required by `dev.yml`) and `PROD_API_URL` (production room service URL for release builds; while unset, `zip` falls back to the Railway URL above).

Cost: the dev services sleep when idle, so they cost almost nothing when nobody is testing. The first request after a sleep takes a few seconds. Never turn sleep off in dev, and never turn it on in production.

Scaling: environments differ only in variables. If one room-service instance is no longer enough, add Redis to the environment and share room state through it (DEC-003 stays until then).

## How it runs

- Image: `Dockerfile.signaling`, built from the repo root because the service reads the shared schema in `packages/protocol/schema`.
- One uvicorn worker, because rooms live in memory (DEC-003). A redeploy ends every room.
- Logs: no access log and `--log-level warning`, because WebSocket URLs carry room tokens (BUG-003).
- The process runs as a non-root user. WebSocket frames are capped at 16 KB and request bodies at 2 KB.
- `TRUST_PROXY=1`: rate limits key on `X-Real-IP`, which Railway's edge sets.

Service settings, set on Railway rather than in a file:

| Setting | Value |
|---|---|
| Variables | `PORT=8080`, `PUBLIC_URL`, `RAILWAY_DOCKERFILE_PATH=Dockerfile.signaling` |
| Healthcheck | `/health`, 30 s |
| Restart | on failure, up to 10 retries |
| Sleep | off (sleeping would end the rooms) |

## Deploy

Ask the owner first: a deploy ends every open room.

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
2. Add a `## [X.Y.Z] - <date>` section to `CHANGELOG.md` with `### Added`, `### Fixed` and `### Known issues`. The release notes are that section, as printed by `node scripts/release-notes.mjs X.Y.Z`; the workflow fails if it is missing.
3. Commit on `dev` (or merge `dev` into `main` in the Ship use case), then tag that commit: `vX.Y.Z` for a release, `vX.Y.Z-rc.N` for a release candidate.
4. With the owner's go-ahead: `git push origin vX.Y.Z`.

The workflow then:

- runs the full CI (`ci.yml`: lint, protocol drift, typecheck, unit tests, extension end-to-end, room service checks, secret scan);
- checks that the tag, without `v` and any `-rc.N`, equals the version in `apps/extension/package.json`, and stops with a clear error if not;
- runs `pnpm --filter @watchsync/extension zip` (production room service, never a mock build) and checks the manifest has no localhost permission;
- publishes the GitHub Release `WatchSync vX.Y.Z` (with "(release candidate)" for an rc), notes from `CHANGELOG.md`, and two copies of the zip: `watchsync-extension-vX.Y.Z.zip` and `watchsync-extension.zip`.

Release candidates are published as normal releases, not prereleases, so `/releases/latest` serves them while friends test v0.1.

**Stable download URL** (always the newest release; the website links here):
`https://github.com/SuhaasNv/watchsync/releases/latest/download/watchsync-extension.zip`

Installed extensions ask `https://api.github.com/repos/SuhaasNv/watchsync/releases/latest` at most once a day, and the popup offers the download when that release's version (without `-rc.N`) is higher than the installed one. A candidate and its final release carry the same manifest version, so going from `v0.1.0-rc.2` to `v0.1.0` is not announced; tell testers directly.

If the workflow fails after it created the release, re-run it: it uploads the files again to the existing release. To redo a release completely, delete the GitHub Release and the tag (owner approval), fix, and tag again.

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
