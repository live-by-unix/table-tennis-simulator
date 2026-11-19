# Development

## Setup

```bash
npm install
cp .env.example .env
./dev.sh               # API :3000 (tsx watch) + Vite :5173
```

No database setup needed: the server auto-starts embedded PostgreSQL (data in `./data/pg`).
Set `DATABASE_URL` in `.env` to use your own Postgres instead.

Vite proxies `/api` and `/ws` to `:3000`, so the SPA works on `http://localhost:5173`.

Tests (`npm test`) use `embedded-postgres` on a scratch port — no setup required.

## Structure

```
server/src/    Fastify API, WS, game physics/match/manager
server/migrations/  SQL migrations
server/test/   vitest suites (unit + API integration)
client/src/    SPA + Three.js game
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev --workspace=server` | API dev server (tsx watch) |
| `cd client && npx vite` | frontend dev server |
| `npm run build` | production build (server tsc + client vite) |
| `npm test` | vitest (physics, elo, match rules, API integration) |
| `cd server && npm run lint` | typecheck |
| `cd server && npm run migrate` | apply migrations manually |

## Testing notes

- `test/physics.test.ts`, `test/elo.test.ts`, `test/match.test.ts` — pure unit tests, no DB.
- `test/api.test.ts` — boots `embedded-postgres`, runs migrations, exercises auth/profile/matches/Elo end-to-end via Fastify inject.

## Debugging

- Server logs: `LOG_LEVEL=debug`, pino JSON to stdout.
- `run/server.log` when started via `start.sh`.
- WS messages: browser devtools → Network → WS frames.
