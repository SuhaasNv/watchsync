# WatchSync

Watch together in sync with friends, each on your own account. A Chrome extension plus a small room service. Works with Netflix, Prime Video and JioHotstar (not affiliated with them).

**Install it (friends):** see [docs/INSTALL.md](docs/INSTALL.md). **Release notes:** [CHANGELOG.md](CHANGELOG.md). **Privacy:** https://room-service-production-e5dd.up.railway.app/privacy

## Supported services (v0.1)

| Service | Sync | Next episode | Ads wait |
|---|---|---|---|
| Netflix | Player API (page bridge) | URL change | Buffering wait only |
| Prime Video | `<video>` | In-player (friends pick it) | Yes (ad timer) |
| JioHotstar | `<video>`, on-demand only | URL change | Buffering wait only |

## Run it locally

```bash
pnpm install
cd services/signaling && uv sync && uv run uvicorn app.main:app --reload   # room service on :8000
pnpm --filter @watchsync/extension dev                                     # builds apps/extension/dist and rebuilds on change
```

Load `apps/extension/dist` in `chrome://extensions` (Developer mode → Load unpacked).

## Checks

```bash
pnpm check                                       # everything below, fail-fast (use before every merge)
pnpm lint && pnpm typecheck && pnpm test          # TypeScript packages
pnpm --filter @watchsync/extension e2e:install    # once: Chromium for the tests, kept in apps/extension/.browsers
pnpm --filter @watchsync/extension e2e            # extension against the local mock player
cd services/signaling && uv run ruff check . && uv run mypy app && uv run pytest
pnpm gen:protocol                                  # after editing packages/protocol/schema
```

## Release build and deploy

`pnpm --filter @watchsync/extension zip` builds the zip against production (it refuses a mock build). The room service runbook is [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

Service settings come from environment variables, extension settings from build-time variables. See `.env.example`.

## Docs

`CLAUDE.md` (how we work), `docs/PRD.md`, `docs/TRD.md`, `docs/TECH-STACK.md`. Plan and status live in Notion.
