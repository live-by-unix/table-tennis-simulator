#!/usr/bin/env bash
# Restore a backup. Replaces ALL data — asks for confirmation.
set -euo pipefail
cd "$(dirname "$0")"
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Usage: $0 <backup.json.gz|backup.sql.gz>" >&2; exit 1; }
echo "This will REPLACE all data in the database."
read -r -p "Type 'yes' to continue: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 1; }

set -a; . ./.env 2>/dev/null || true; set +a
DATABASE_URL="${DATABASE_URL:-}"

if [[ "$FILE" == *.json.gz ]]; then
  [ -f server/dist/dbbackup.js ] || npm run build --workspace=server
  (cd server && node dist/dbbackup.js restore "../$FILE" --yes)
elif command -v psql >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  DBNAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')
  psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DBNAME' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  if [[ "$FILE" == *.gz ]]; then zcat "$FILE"; else cat "$FILE"; fi | psql "$DATABASE_URL"
  (cd server && npm run migrate)
else
  echo "ERROR: cannot restore this file type without psql/docker" >&2; exit 1
fi
echo "Restore complete."
