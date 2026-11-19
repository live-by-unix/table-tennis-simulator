#!/usr/bin/env bash
# Table Tennis Simulator - shutdown (never deletes data)
set -uo pipefail
cd "$(dirname "$0")"
RUN_DIR="$PWD/run"
log() { echo "[stop] $*"; }

if [ -f "$RUN_DIR/server.pid" ]; then
  PID=$(cat "$RUN_DIR/server.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    for i in $(seq 1 15); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
    log "Stopped server (pid $PID)"
  else
    log "Server pid $PID not running"
  fi
  rm -f "$RUN_DIR/server.pid"
fi

# docker compose mode
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q .; then
    docker compose stop app 2>/dev/null || true
    log "Stopped docker app service (postgres left running to preserve data; use 'docker compose down' to stop all)"
  fi
fi
log "Done. Database data is preserved."
