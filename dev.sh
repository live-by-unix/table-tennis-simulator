#!/usr/bin/env bash
# Development: API (tsx watch) + Vite. Embedded Postgres auto-starts if needed.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install
(cd server && npm run migrate)
echo "[dev] API: http://localhost:${PORT:-3000}  Client: http://localhost:5173"
npm run dev --workspace=server &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
cd client && npx vite --port 5173
