#!/usr/bin/env bash
# Development mode: postgres via docker if available, else expects DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d db
else
  echo "[dev] No docker access — ensure PostgreSQL is running at DATABASE_URL"
fi

# install deps if needed
[ -d node_modules ] || npm install

# run migrations
(cd server && npm run migrate)

echo "[dev] API: http://localhost:${PORT:-3000}  Client: http://localhost:5173"
# run both
npm run dev --workspace=server &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
cd client && npx vite --port 5173
