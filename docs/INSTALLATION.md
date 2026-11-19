# Installation

## Requirements

- Node.js >= 20 and npm
- That's it. PostgreSQL is bundled (embedded mode) — no Docker, no system packages.

## Option A: Zero-dependency (recommended)

```bash
npm install
npm run build
./start.sh
```

The server automatically starts an embedded PostgreSQL on first run, stores data in
`./data/pg`, and applies migrations. Subsequent starts reuse the same data.

To reset everything: `./stop.sh && rm -rf data/`

## Option B: External PostgreSQL

Set `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgres://user:pass@host:5432/tabletennis
```

The server uses it when reachable; otherwise it falls back to embedded mode.

## Option C: Docker

```bash
cp .env.example .env   # set SESSION_SECRET
TTS_USE_DOCKER=1 ./start.sh
```

`docker-compose.yml` runs PostgreSQL 16 + the app.

## Environment variables

See `.env.example`. Key variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP/WS port |
| `DATABASE_URL` | — | Optional external Postgres; unset → embedded |
| `TTS_PGDATA` | `./data/pg` | Embedded PG data dir |
| `TTS_PG_PORT` | 55432 | Embedded PG port |
| `SESSION_SECRET` | — | Session/cookie secret (set for production) |
| `APP_URL` / `CLIENT_URL` | localhost | Public URLs |
| `ALLOWED_ORIGINS` | localhost:5173,3000 | CORS + WS origin allowlist |
| `COOKIE_SECURE` | false | Set true behind HTTPS |
| `GAME_TICK_HZ` | 60 | Physics tick rate |
| `MATCH_DISCONNECT_GRACE_MS` | 30000 | Reconnect window |
| `MATCH_POINT_SCORE` | 11 | Points to win |

## Database internals

- Embedded mode: `embedded-postgres` npm package (PostgreSQL 18 binaries), data in `TTS_PGDATA`.
- Migrations: `server/migrations/*.sql`, auto-applied at boot, tracked in `schema_migrations`.
- Manual migrate: `cd server && npm run migrate`.
