#!/usr/bin/env bash
# Rebuilds a LOCAL TEST database from the migrations. Never point this at a real project.
# Usage: ADMIN_URL=postgres://user:pass@host:5432/postgres DB_NAME=coldstore_test scripts/db-reset.sh
set -euo pipefail
: "${ADMIN_URL:?set ADMIN_URL to a superuser connection (database 'postgres')}"
DB_NAME="${DB_NAME:-coldstore_test}"
case "$DB_NAME" in *test*|*local*|*dev*) ;; *) echo "refusing to reset database '$DB_NAME' (name must contain test/local/dev)"; exit 1;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB_NAME\" with (force)" -c "create database \"$DB_NAME\""
TARGET="${ADMIN_URL%/*}/$DB_NAME"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "ready: $TARGET"
