#!/usr/bin/env bash
# Restore a database backup. SAFETY: drops & recreates the DB — confirms first.
set -euo pipefail
cd "$(dirname "$0")"
FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Usage: $0 <backup-file.sql[.gz]>" >&2; exit 1; }
set -a; . ./.env 2>/dev/null || true; set +a
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/tabletennis}"
DBNAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')
DBUSER=$(echo "$DATABASE_URL" | sed -E 's|.*//([^:]+):.*|\1|')
echo "This will REPLACE all data in database '$DBNAME'."
read -r -p "Type 'yes' to continue: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 1; }

if [[ "$FILE" == *.gz ]]; then ZCAT="zcat"; else ZCAT="cat"; fi
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DBNAME' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 
  $ZCAT "$FILE" | psql "$DATABASE_URL"
else
  echo "ERROR: psql not found; restore manually" >&2; exit 1
fi
echo "Restore complete."
