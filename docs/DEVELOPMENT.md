# Development

## Setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL to a dev postgres
./dev.sh               # API :3000 (tsx watch) + Vite :5173
```

Vite proxies `/api` and `/ws` to `:3000`, so the SPA works on `http://localhost:5173`.

No Docker? Tests use `embedded-postgres` (auto-downloaded binaries) — `npm test` works without any database setup.

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
