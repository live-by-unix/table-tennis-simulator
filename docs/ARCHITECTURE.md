# Architecture

## Overview

```
Browser (Three.js client)  ──HTTP/WS──▶  Fastify server  ──▶  PostgreSQL
        ▲                        │
        └── REST /api/v1         └── authoritative game sim (MatchManager)
```

The client renders and captures input only. **All** authoritative state — ball physics, collisions, scoring, ratings — lives in the Node.js server.

## Backend (`server/src`)

- `index.ts` — Fastify bootstrap, migrations, static client hosting, graceful shutdown
- `routes.ts` — REST API `/api/v1/*`
- `ws.ts` — single WebSocket endpoint `/ws` (lobby + match traffic)
- `auth.ts` — Argon2id hashing, session tokens (SHA-256 hashed at rest), cookies
- `db.ts` — `pg` Pool + transaction helper
- `migrate.ts` — SQL migration runner
- `elo.ts` — Elo rating math
- `game/physics.ts` — ball/paddle/table/net simulation (pure functions, unit-tested)
- `game/match.ts` — match state machine: countdown → serve → rally → point → match end; ITTF scoring rules
- `game/manager.ts` — match registry, matchmaking sweep, private rooms, broadcasts, disconnect handling
- `game/finish.ts` — transactional result persistence (ratings, stats, streaks)

## Physics (`game/physics.ts`)

- Ball: gravity, quadratic drag (~terminal velocity 9.5 m/s), Magnus force from spin vector, spin decay
- Table: restitution 0.9, friction + spin-kick on bounce
- Net: thin collision volume at x=0
- Paddle: oriented disc (position + quaternion + velocity + angular velocity); impulse model transfers swing speed and brush spin to the ball
- Fixed substeps (1/240 s) inside a 60 Hz tick for stable collisions

## Rules (`game/match.ts`)

- First to 11, win by 2; serve rotation every 2 points, every point at deuce
- Serve must bounce server side then receiver side; net before second bounce = let (replay)
- Point ends on: double bounce, ball out, shot not crossing, service fault
- Disconnect: 30 s grace, then forfeit (match marked `abandoned`)

## Frontend (`client/src`)

- `main.ts` / `pages.ts` — hash-router SPA (landing, auth, dashboard, play, match, profile, leaderboard)
- `api.ts` — typed REST client (cookie auth)
- `net.ts` — WebSocket client with auto-reconnect
- `game/world.ts` — Three.js scene: table, net, room, lights, shadows
- `game/matchView.ts` — renderer loop, snapshot interpolation (120 ms delay), local paddle prediction, mouse/keyboard input, HUD

## Database

Tables: `users`, `sessions`, `player_profiles`, `player_statistics`, `player_ratings`, `matches`, `match_players`, `matchmaking_queue`, `private_rooms`, `invitations`, `schema_migrations`. UUID PKs, FK constraints, indexes on hot paths. See `server/migrations/001_init.sql`.

## Scaling notes

Single-instance by default. `REDIS_URL` is reserved for future multi-instance matchmaking/coordination; not required.
