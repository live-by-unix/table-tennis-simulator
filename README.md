# 🏓 Table Tennis Simulator

A real-time multiplayer 3D table tennis simulator. Play ranked matches against real players, create private rooms with friends, and climb the global leaderboard.

**Fully self-hostable** — no external services required. All game state, physics, scoring, and rankings are authoritative on the server.

## Features

- **Real 3D gameplay** — Three.js rendering with regulation table, net, realistic lighting and shadows
- **Server-authoritative physics** — ball flight, spin (topspin/backspin/sidespin), Magnus effect, table/net/paddle collisions all simulated on the server at 60 Hz
- **Official rules** — first to 11, win by 2, correct serve rotation, service faults, let serves, double-bounce and out-of-bounds detection
- **Multiplayer** — WebSocket real-time sync, ranked matchmaking with rating-based pairing, private rooms with invite codes, spectating, disconnect/reconnect with grace period
- **Accounts & profiles** — Argon2id password hashing, secure session cookies, avatars, stats, match history
- **Elo rankings** — global leaderboard, rating before/after per match
- **PostgreSQL** — relational schema with migrations, pooling, transactions
- **Docker** — one-command deployment with `docker compose`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript, Three.js, Vite |
| Backend | Node.js, TypeScript, Fastify, WebSockets (`@fastify/websocket`) |
| Database | PostgreSQL 16 |
| Auth | Argon2id, HTTP-only session cookies |
| Infra | Docker, Docker Compose |

## Quick Start

```bash
git clone https://github.com/live-by-unix/table-tennis-simulator.git
cd table-tennis-simulator
npm install
npm run build
./start.sh
```

That's it — **no Docker, no external database required**. On first start the server
auto-provisions an embedded PostgreSQL (binaries bundled with the app) into `./data/pg`
and runs migrations automatically.

Open http://localhost:3000 — register two accounts (use two browsers/profiles) and play.

Optional: set `DATABASE_URL` in `.env` to use your own PostgreSQL instead, or
`TTS_USE_DOCKER=1 ./start.sh` to deploy via Docker Compose.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for full instructions.

## Scripts

| Script | Purpose |
|---|---|
| `./start.sh` | Production start (Docker if available, else native) |
| `./stop.sh` | Clean shutdown (preserves data) |
| `./dev.sh` | Development mode |
| `./build.sh` | Production build |
| `./test.sh` | Run test suite |
| `./backup.sh` / `./restore.sh` | Database backup/restore |
| `./status.sh` | Service status |

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Gameplay & controls](docs/GAMEPLAY.md)
- [Multiplayer & WebSocket protocol](docs/MULTIPLAYER.md) · [WEBSOCKETS.md](docs/WEBSOCKETS.md)
- [REST API](docs/API.md)
- [Self-hosting guide](docs/SELF_HOSTING.md)
- [Development](docs/DEVELOPMENT.md)
- [Security](docs/SECURITY.md)

## License

BSD 3-Clause — see [LICENSE](LICENSE).
