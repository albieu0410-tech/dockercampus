# Rust Cutover Checklist

Current state (as of 2026-04-27):
- API traffic (`/api`, `api.sudelca.com`) is routed to Rust (`container-engine:8001`).
- Python backend is kept only for `/app/{user_id}/{path}` HTTP proxy + websocket tunnel.

## Remaining blocker before deleting Python backend

1. Port these Python-only endpoints from `backend/app/routers/containers.py` to Rust:
- `GET/POST/... /containers/app/{user_id}/{path:path}` (HTTP reverse proxy)
- `WS /containers/app/{user_id}/{path:path}` (websocket bridge)

2. In Nginx, switch this location from Python to Rust:
- `location ~ ^/app/(.*)$` in `nginx/conf.d/dockcampus.conf`

## Final cutover steps

1. Verify Rust serves all required routes:
- auth/users/classes/github/deployments/hive/routing/resources/jobs/sleep/wireguard/containers app-proxy

2. Update `docker-compose.yml`:
- remove `backend` service
- remove `backend` from `nginx.depends_on`

3. Update environment variables:
- remove Python-only vars (`DATABASE_URL_PYTHON`, `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`, `BACKEND_URL`)
- keep Rust vars (`DATABASE_URL_RUST`/`DATABASE_URL`, `SECRET_KEY`, `RESEND_API_KEY`, etc.)

4. Remove Python backend folder:
- delete `/backend`

5. Deploy and validate:
- login/register/otp flows
- container create/start/stop/wake
- `/app/{user}/...` editor and websocket terminal
- deployment build/run/cancel/retry
- hive/routing/sleep/jobs/wireguard pages

6. Rollback plan:
- revert Nginx `/app` and `/api` upstreams to Python
- restore `backend` service in compose
