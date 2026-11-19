#!/usr/bin/env bash
# Stop the app cleanly. Never deletes data.
set -uo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
RUN_DIR="$ROOT/run"
log() { echo "[stop] $*"; }

PID=""
[ -f "$RUN_DIR/server.pid" ] && PID=$(cat "$RUN_DIR/server.pid")
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID" 2>/dev/null || true
  for i in $(seq 1 15); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
  log "Stopped server (pid $PID)"
elif [ -n "$PID" ]; then
  log "Server pid $PID not running"
fi
rm -f "$RUN_DIR/server.pid"

# fallback: stop embedded postgres bound to our data dir (never touches other pg instances)
if [ -d "$ROOT/data/pg" ]; then
  pkill -f "postgres.*-D $ROOT/data/pg" 2>/dev/null && log "Stopped embedded postgres" || true
fi

if [ "${TTS_USE_DOCKER:-0}" = "1" ] && command -v docker >/dev/null 2>&1; then
  docker compose stop app 2>/dev/null || true
fi
log "Done. Data preserved in data/ and backups/."
