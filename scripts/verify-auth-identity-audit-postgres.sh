#!/usr/bin/env bash
set -euo pipefail

# Uses the same guarded, disposable local PostgreSQL acceptance environment as
# Slice 2. It never connects to the Hub database or a remote Supabase project.
container="${SLICE2_PG_CONTAINER:-portfolio-data-hub-postgres-1}"
database="${SLICE2_PG_DATABASE:-trade_management_desk_dev}"
database_user="${SLICE2_PG_USER:-portfolio_data_hub}"
workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"
migration_files=(
  "$workspace_dir/supabase/migrations/20260812090000_account_identity_rls_hardening.sql"
  "$workspace_dir/supabase/migrations/20260930120000_auth_identity_admin_audit.sql"
)
migration_hash="$(shasum -a 256 "${migration_files[@]}" | awk '{print $1}' | shasum -a 256 | awk '{print $1}')"

if [[ "$database" != 'trade_management_desk_dev' ]] || [[ "$database" == 'portfolio_data_hub' || "$database" == 'postgres' ]]; then
  echo "Refusing to run: SLICE2_PG_DATABASE must be exactly trade_management_desk_dev (never portfolio_data_hub/postgres)." >&2
  exit 2
fi

run_sql_file() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" < "$1"
}

run_sql_file "$workspace_dir/supabase/tests/slice2_acceptance_bootstrap.sql"

installed_hash="$(docker exec "$container" psql -At -U "$database_user" -d "$database" -c "select coalesce(value, '') from public._slice2_acceptance_harness where key = 'identity-audit-migrations-applied';")"
if [[ -z "$installed_hash" ]]; then
  for migration_file in "${migration_files[@]}"; do
    run_sql_file "$migration_file"
  done
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "insert into public._slice2_acceptance_harness (key, value) values ('identity-audit-migrations-applied', '$migration_hash') on conflict (key) do update set value = excluded.value;" >/dev/null
elif [[ "$installed_hash" != "$migration_hash" ]]; then
  echo "Refusing to run: installed identity-audit migration-set hash differs from the current ordered SQL set. Apply a forward migration; do not test stale schema." >&2
  exit 3
else
  # The persistent Slice 2 bootstrap intentionally grants broad fixture-table
  # access before RLS tests. Reapply this idempotent security migration so its
  # narrow audit-table grants remain authoritative on every repeat run.
  run_sql_file "$workspace_dir/supabase/migrations/20260930120000_auth_identity_admin_audit.sql"
fi

run_sql_file "$workspace_dir/supabase/tests/auth_identity_admin_audit_acceptance.sql"
