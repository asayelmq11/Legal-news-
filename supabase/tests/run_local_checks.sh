#!/usr/bin/env bash
#
# Applies every migration to a throwaway local Postgres database and runs the
# schema and RLS check suites against it.
#
# This verifies the migrations really apply and the access rules really hold —
# it is not a substitute for applying them to Supabase, but it catches
# everything that is not Supabase-specific.
#
# Usage:  supabase/tests/run_local_checks.sh [dbname]
# Requires: a running local Postgres and permission to create databases.

set -euo pipefail

DB="${1:-legal_platform_check}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

# Run psql as a superuser. Locally that is the `postgres` OS user.
psql_su() {
  if [ "$(id -un)" = "postgres" ]; then
    psql "$@"
  else
    su postgres -c "psql $(printf '%q ' "$@")"
  fi
}

echo "▶ recreating database: $DB"
psql_su -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

echo "▶ bootstrapping Supabase stand-ins (auth schema, roles) — LOCAL ONLY"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_bootstrap_local.sql"

echo "▶ applying migrations"
for f in "$MIGRATIONS"/*.sql; do
  echo "   • $(basename "$f")"
  psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done

echo "▶ re-applying migrations to prove idempotency"
for f in "$MIGRATIONS"/*.sql; do
  psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
echo "   ✓ all migrations applied twice with no error"

echo
echo "▶ schema checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/01_schema_checks.sql"

echo
echo "▶ RLS checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/02_rls_checks.sql"

echo
echo "════════════════════════════════════════"
echo " ALL DATABASE CHECKS PASSED"
echo "════════════════════════════════════════"
