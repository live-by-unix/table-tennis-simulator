#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a; . ./.env 2>/dev/null || true; set +a
PORT="${PORT:-3000}"
echo "== App =="
if [ -f run/server.pid ] && kill -0 "$(cat run/server.pid)" 2>/dev/null; then
  echo "server: running (pid $(cat run/server.pid))"
else
  echo "server: not running (pidfile)"
fi
if curl -sf "http://localhost:${PORT}/api/v1/health" >/dev/null 2>&1; then
  echo "health: OK (http://localhost:${PORT})"
else
  echo "health: FAIL"
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "== Docker =="
  docker compose ps 2>/dev/null || true
fi
