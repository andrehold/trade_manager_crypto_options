#!/usr/bin/env bash
set -euo pipefail

# Runs only against the dedicated local portal database, never Portfolio Data Hub's
# portfolio_data_hub database. Bootstrap/migration state persist; acceptance data
# rolls back, so this command is repeatable and non-destructive.
container="${SLICE2_PG_CONTAINER:-portfolio-data-hub-postgres-1}"
database="${SLICE2_PG_DATABASE:-trade_management_desk_dev}"
database_user="${SLICE2_PG_USER:-portfolio_data_hub}"
workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"
migration_file="$workspace_dir/supabase/migrations/20260811_add_portfolio_data_hub_client_mapping.sql"
migration_hash="$(shasum -a 256 "$migration_file" | awk '{print $1}')"

if [[ "$database" != 'trade_management_desk_dev' ]] || [[ "$database" == 'portfolio_data_hub' || "$database" == 'postgres' ]]; then
  echo "Refusing to run: SLICE2_PG_DATABASE must be exactly trade_management_desk_dev (never portfolio_data_hub/postgres)." >&2
  exit 2
fi

run_sql_file() {
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" < "$1"
}

run_sql_file "$workspace_dir/supabase/tests/slice2_acceptance_bootstrap.sql"

installed_hash="$(docker exec "$container" psql -At -U "$database_user" -d "$database" -c "select coalesce(value, '') from public._slice2_acceptance_harness where key = 'migration-applied';")"
if [[ -z "$installed_hash" ]]; then
  marker_exists="$(docker exec "$container" psql -At -U "$database_user" -d "$database" -c "select exists (select 1 from public._slice2_acceptance_harness where key = 'migration-applied');")"
  if [[ "$marker_exists" == 't' ]]; then
    # A prior harness installed Slice 2 before hashes existed. The real migration
    # is repeatable against this disposable portal DB, so reapply it successfully
    # before binding the persistent install to this exact SQL hash.
    run_sql_file "$migration_file"
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "update public._slice2_acceptance_harness set value = '$migration_hash' where key = 'migration-applied';" >/dev/null
  else
    run_sql_file "$migration_file"
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "insert into public._slice2_acceptance_harness (key, value) values ('migration-applied', '$migration_hash');" >/dev/null
  fi
elif [[ "$installed_hash" != "$migration_hash" ]]; then
  echo "Refusing to run: installed Slice 2 migration hash ($installed_hash) differs from current SQL ($migration_hash). Apply a new forward migration; do not test stale schema." >&2
  exit 3
fi

# Plain PostgreSQL does not grant Supabase's default table privileges. Grants are
# intentionally broad at the SQL privilege layer so this harness proves RLS, while
# SECURITY DEFINER RPC grants remain exactly as defined by the real migration.
docker exec "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" -c "grant usage on schema public, auth, helpers to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;" >/dev/null

run_sql_file "$workspace_dir/supabase/tests/slice2_acceptance.sql"

# Expected browser-role denials are executed in separate rollback transactions so
# PostgreSQL can return 42501 without aborting the successful acceptance run.
expect_client_denial() {
  local label="$1"
  local statement="$2"
  local claims='{"role":"authenticated","sub":"c0000000-0000-4000-8000-000000000003","app_metadata":{"client_id":"a0000000-0000-4000-8000-000000000001"}}'
  # Seed the referenced account before assuming the browser role. Without this
  # fixture, a denied insert could be a foreign-key/ownership-trigger failure
  # rather than proof that RLS rejected an otherwise valid client operation.
  if printf "begin; insert into public.clients (client_id, client_name) values ('a0000000-0000-4000-8000-000000000001', 'Alpha'); set local role authenticated; set local request.jwt.claims = '%s'; %s rollback;\n" "$claims" "$statement" \
    | docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database" >/dev/null 2>&1; then
    echo "Acceptance failure: client operation was unexpectedly allowed: $label" >&2
    exit 4
  fi
}

expect_client_denial 'direct configuration-audit insert' "insert into public.client_account_config_audit (client_id, actor_role, event_type, old_value, new_value) values ('a0000000-0000-4000-8000-000000000001', 'client', 'reporting_currency', '{}'::jsonb, '{}'::jsonb);"
expect_client_denial 'transaction-log insert' "insert into public.transaction_logs (client_name) values ('Alpha');"
expect_client_denial 'unprocessed-import insert' "insert into public.unprocessed_imports (client_name) values ('Alpha');"

echo 'Slice 2 PostgreSQL acceptance passed.'
