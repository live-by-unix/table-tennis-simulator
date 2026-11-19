#!/usr/bin/env bash
# Table Tennis Simulator - production startup (no Docker required).
# PostgreSQL is auto-provisioned (embedded binaries) unless DATABASE_URL points
# to an external server. Set TTS_USE_DOCKER=1 to use docker compose instead.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
RUN_DIR="$ROOT/run"
mkdir -p "$RUN_DIR" backups data

log() { echo "[start] $*"; }
err() { echo "[start] ERROR: $*" >&2; }

for cmd in node npm; do
  command -v "$cmd" >/dev/null || { err "Missing dependency: $cmd"; exit 1; }
done
node -e "process.exit(parseInt(process.versions.node)>=20?0:1)" || { err "Node.js >= 20 required"; exit 1; }

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a
PORT="${PORT:-3000}"

if [ "${TTS_USE_DOCKER:-0}" = "1" ]; then
  command -v docker >/dev/null 2>&1 || { err "TTS_USE_DOCKER=1 but docker not installed"; exit 1; }
  SESSION_SECRET="${SESSION_SECRET:-}" ; [ -z "$SESSION_SECRET" ] && { err "SESSION_SECRET must be set in .env"; exit 1; }
  log "Using Docker Compose"
  docker compose up -d --build
  for i in $(seq 1 60); do
    curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1 && { log "Server healthy: http://localhost:${PORT}"; exit 0; }
    sleep 2
  done
  err "Server did not become healthy"; exit 1
fi

# ---- native mode (embedded or external Postgres) ----
log "Native mode"
[ -d node_modules ] || npm install
# build if missing
[ -f server/dist/index.js ] || npm run build
[ -d client/dist ] || npm run build --workspace=client

NODE_ENV="${NODE_ENV:-production}" nohup node server/dist/index.js >"$RUN_DIR/server.log" 2>&1 &
echo $! > "$RUN_DIR/server.pid"
log "Server PID $(cat "$RUN_DIR/server.pid")"
for i in $(seq 1 90); do
  if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
    log "Server healthy: http://localhost:${PORT}"
    log "Data dir: $ROOT/data  (delete it to reset ALL data)"
    exit 0
  fi
  sleep 1
done
err "Server failed to start; see run/server.log"; tail -20 "$RUN_DIR/server.log" >&2; exit 1
