# Deploying the room service

**Production:** https://room-service-production-e5dd.up.railway.app (Railway project `watchsync`, service `room-service`, region us-west2, environment `production`).

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
