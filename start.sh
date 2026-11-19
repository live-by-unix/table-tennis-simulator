#!/usr/bin/env bash
# Table Tennis Simulator - production startup
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
RUN_DIR="$ROOT/run"
mkdir -p "$RUN_DIR" backups

log() { echo "[start] $*"; }
err() { echo "[start] ERROR: $*" >&2; }

# 1. Dependencies
for cmd in node npm; do
  command -v "$cmd" >/dev/null || { err "Missing dependency: $cmd"; exit 1; }
done
node -e "process.exit(parseInt(process.versions.node)>=20?0:1)" || { err "Node.js >= 20 required"; exit 1; }

# 2. Config
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    err ".env created from .env.example — EDIT IT (set SESSION_SECRET) before real use"
  else
    err ".env missing"; exit 1
  fi
fi
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/tabletennis}"
export SESSION_SECRET="${SESSION_SECRET:-}"
[ -z "$SESSION_SECRET" ] && { err "SESSION_SECRET must be set in .env"; exit 1; }

PORT="${PORT:-3000}"

# 3. Docker mode vs native mode
USE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then USE_DOCKER=1; fi

if [ "$USE_DOCKER" = "1" ] && [ "${TTS_NO_DOCKER:-0}" != "1" ]; then
  log "Using Docker Compose (postgres + app)"
  docker compose up -d --build
  # wait for health
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
      log "Server healthy: http://localhost:${PORT}"
      exit 0
    fi
    sleep 2
  done
  err "Server did not become healthy"; exit 1
else
  log "Native mode (no docker access)"
  # 3a. ensure deps
  [ -d node_modules ] || npm install
  # 3b. check postgres reachable
  if ! node -e "
    const {Client}=require('pg');
    const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
    c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));
  " 2>/dev/null; then
    err "Cannot connect to PostgreSQL at DATABASE_URL."
    err "Start postgres yourself or run with docker: ./start.sh (with docker access)"
    err "Or use embedded dev DB: see docs/DEVELOPMENT.md"
    exit 1
  fi
  # 3c. migrations (idempotent)
  (cd server && npm run migrate)
  # 3d. build if needed
  [ -d client/dist ] || npm run build
  # 3e. start
  NODE_ENV="${NODE_ENV:-production}" nohup node server/dist/index.js >"$RUN_DIR/server.log" 2>&1 &
  echo $! > "$RUN_DIR/server.pid"
  log "Server PID $(cat $RUN_DIR/server.pid)"
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
      log "Server healthy: http://localhost:${PORT}"
      exit 0
    fi
    sleep 1
  done
  err "Server failed to start; see run/server.log"; exit 1
fi
