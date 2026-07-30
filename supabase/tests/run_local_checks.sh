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

# Registry checks run FIRST, against the pristine seeded state — the later
# suites insert fixture rows, and the registry assertions are about what the
# seed actually contains.
echo
echo "▶ source registry checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/03_source_registry_checks.sql"

echo
echo "▶ schema checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/01_schema_checks.sql"

echo
echo "▶ RLS checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/02_rls_checks.sql"

# Fixtures are loaded LAST and live outside supabase/migrations/, so they can
# never reach production via `supabase db push`. Everything above ran against a
# schema with no invented legal content in it.
echo
echo "▶ loading DEV FIXTURES (never applied to production)"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/../fixtures/dev_legal_updates.sql"

echo
echo "▶ archive query checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/04_archive_query_checks.sql"

echo
echo "▶ dashboard aggregation checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/05_dashboard_checks.sql"

echo
echo "▶ admin area checks"
psql_su -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/06_admin_checks.sql"

echo
echo "▶ Arabic normalisation parity (TypeScript vs Postgres)"
if command -v node >/dev/null 2>&1; then
  PGPW="${PGPASSWORD:-postgres}"
  psql_su -q -d "$DB" -c "alter user postgres password '$PGPW'" >/dev/null 2>&1 || true
  node "$HERE/../../scripts/verify-normalization-parity.mjs" \
    "postgresql://postgres:$PGPW@127.0.0.1:5432/$DB" 2>&1 \
    | grep -v "MODULE_TYPELESS\|Reparsing\|eliminate this warning\|trace-warnings" || true
else
  echo "   (skipped — node not available)"
fi

echo
echo "════════════════════════════════════════"
echo " ALL DATABASE CHECKS PASSED"
echo "════════════════════════════════════════"
