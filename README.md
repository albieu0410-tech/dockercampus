# DockCampus

DockCampus is a multi-service platform for managing student development containers.

## Services

- `frontend` (Next.js 15): web app for students/professors
- `container-engine` (Rust + Axum): auth + Docker/container orchestration + monitoring API
- `db` (PostgreSQL 16): persistent data store

## Repository Structure

- `container-engine/` - Rust service with SQLx migrations (API gateway + orchestration)
- `frontend/` - Next.js App Router UI
- `student-container/` - code-server image
- `docker-compose.yml` - local/dev orchestration

## Prerequisites

- Docker + Docker Compose
- Git

## Run Locally

```bash
git clone <your-repo-url>
cd dockercampus
docker compose up --build -d
```

Check services:

```bash
docker compose ps
```

## Default Ports

- Frontend: `3000`
- Container Engine: `8001`
- Postgres: `5432`

## Access URLs

- Local machine: `http://localhost:3000`
- LAN: `http://<raspberry-pi-ip>:3000`

Container Engine is exposed on `http://<host>:8001` unless you place it behind a reverse proxy.

## Frontend API Configuration

The frontend expects `NEXT_PUBLIC_API_URL` at build time.

In `docker-compose.yml`:

```yaml
frontend:
  build:
    context: ./frontend
    args:
      NEXT_PUBLIC_API_URL: https://api.sudelca.com
```

If this value is wrong or unreachable, frontend auth requests will fail in the browser.

## Auth Notes

Current frontend implementation stores token in:

- `localStorage` (`token`)
- non-httpOnly cookie (`token`) used by middleware route checks

This is the current behavior in code; migrate to strict httpOnly cookies if required.

## Domain Deployment (Recommended)

For `https://dockercampus.sudelca.com`:

1. Point DNS (`A` record) to your server public IP.
2. Forward ports `80`/`443` to the host.
3. Use reverse proxy (Nginx/Caddy):
   - `/` -> `frontend:3000`
   - `/api` (or API subdomain) -> `container-engine:8001`
4. Use TLS (Let's Encrypt).
5. Set `NEXT_PUBLIC_API_URL` to the real HTTPS API URL, then rebuild.

## Useful Commands

```bash
# Rebuild all
docker compose up --build -d

# View logs
docker compose logs -f frontend
docker compose logs -f container-engine

# Stop
docker compose down
```
