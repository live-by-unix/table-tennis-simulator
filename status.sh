#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a; . ./.env 2>/dev/null || true; set +a
PORT="${PORT:-3000}"
echo "== App =="
if [ -f run/server.pid ] && kill -0 "$(cat run/server.pid)" 2>/dev/null; then
  echo "server: running (pid $(cat run/server.pid))"
else
  echo "server: not running"
fi
if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
  echo "health: OK (http://localhost:${PORT})"
else
  echo "health: FAIL"
fi
echo "== Database =="
if pgrep -f "postgres.*data/pg" >/dev/null 2>&1; then echo "mode: embedded (data/pg)"; elif [ -n "${DATABASE_URL:-}" ]; then echo "mode: external (DATABASE_URL)"; else echo "mode: unknown"; fi
[ -d data/pg ] && du -sh data/pg 2>/dev/null | awk '{print "pg data size: "$1}'
pgrep -af "postgres.*data/pg" | head -2 || echo "embedded postgres: not running"
