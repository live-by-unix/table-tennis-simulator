# Installation

## Requirements

- Node.js >= 20 and npm
- PostgreSQL 16 (or Docker)
- ~500 MB disk

## Option A: Docker (recommended)

```bash
cp .env.example .env
# set SESSION_SECRET (openssl rand -hex 32)
./start.sh
```

`docker-compose.yml` runs PostgreSQL 16 and the app. The database persists in the `pgdata` volume.

## Option B: Native

1. `npm install`
2. Create `.env` from `.env.example`; set `DATABASE_URL`, `SESSION_SECRET`, `ALLOWED_ORIGINS`.
3. Ensure PostgreSQL is running and the database exists:
   ```sql
   CREATE DATABASE tabletennis;
   ```
4. `./dev.sh` for development, or `npm run build && ./start.sh` for production.

## Environment variables

See `.env.example`. Key variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP/WS port |
| `DATABASE_URL` | postgres://… | Postgres connection |
| `SESSION_SECRET` | — | **Required.** Cookie/session security |
| `APP_URL` / `CLIENT_URL` | localhost | Public URLs |
| `ALLOWED_ORIGINS` | localhost:5173,3000 | CORS + WS origin allowlist (comma-sep) |
| `COOKIE_SECURE` | false | Set true behind HTTPS |
| `GAME_TICK_HZ` | 60 | Physics tick rate |
| `MATCH_DISCONNECT_GRACE_MS` | 30000 | Reconnect window |
| `MATCH_POINT_SCORE` | 11 | Points to win |
| `REDIS_URL` | — | Optional, reserved for multi-instance scaling |

## Database

Migrations run automatically at server start (`server/migrations/*.sql`, tracked in `schema_migrations`). Apply manually with `cd server && npm run migrate`.
