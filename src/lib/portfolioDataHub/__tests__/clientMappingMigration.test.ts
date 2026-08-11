import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// This repository does not have a disposable Supabase/Postgres migration harness.
// These checks deliberately verify the security-critical SQL *contract* only; the
// live acceptance steps documented in docs/DATABASE.md remain required before use.
const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260811_add_portfolio_data_hub_client_mapping.sql',
)
const migration = readFileSync(migrationPath, 'utf8')

describe('Portfolio Data Hub client mapping migration SQL contract', () => {
  it('adds nullable Hub mapping and reporting currency fields with a partial unique mapping index', () => {
    expect(migration).toContain('add column if not exists hub_account_id uuid')
    expect(migration).toContain('add column if not exists hub_account_label text')
    expect(migration).toContain('add column if not exists reporting_currency text')
    expect(migration).toContain('add column if not exists reporting_currency_source text')
    expect(migration).toContain('add column if not exists hub_account_mapped_at timestamptz')
    expect(migration).toContain('create unique index if not exists clients_hub_account_id_unique')
    expect(migration).toContain('where hub_account_id is not null')
    expect(migration).toContain("reporting_currency_source in ('client', 'admin')")
    expect(migration).toContain('clients_hub_mapping_fields_check')
    expect(migration).toContain('clients_reporting_currency_fields_check')
    expect(migration).toContain("reporting_currency ~ '^[A-Z0-9]{2,12}$'")
  })

  it('uses trusted app_metadata helpers and removes the historic broad mutation policies', () => {
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'client_id'")
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'")
    expect(migration).not.toContain("auth.jwt() -> 'user_metadata' ->> 'client_id'")
    expect(migration).toContain('drop policy if exists "Authenticated users can update clients"')
    expect(migration).toContain('drop policy if exists "Authenticated users can delete clients"')
    expect(migration).toContain('create policy "Admins manage clients"')
    expect(migration).toContain('using (helpers.is_admin())')
    expect(migration).toContain('revoke all on schema helpers from public')
    expect(migration).toContain('grant usage on schema helpers to authenticated')
    expect(migration).toContain("where polrelid = 'public.clients'::regclass")
  })

  it('moves every persisted portal-state table from mutable names to trusted client IDs', () => {
    for (const table of [
      'appropriateness_assessments',
      'strategy_selections',
      'risk_limit_selections',
      'exchange_key_events',
      'activation_events',
      'update_approvals',
      'audit_events',
      'position_interventions',
      'transaction_logs',
      'unprocessed_imports',
    ]) {
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('add column if not exists client_id uuid')
    expect(migration).toContain('foreign key (client_id) references public.clients(client_id) on delete restrict')
    expect(migration).toContain('state.client_id is null and state.client_name = client.client_name')
    expect(migration).toContain('create or replace function public.assign_portal_state_client()')
    expect(migration).toContain('new.client_id := v_client_id')
    expect(migration).toContain('new.client_name := v_client_name')
    expect(migration).toContain('client_id = helpers.current_client_id()')
    expect(migration).toContain("execute format('alter table public.%I enable row level security', v_table)")
    expect(migration).toContain("'select polname from pg_policy where polrelid = %L::regclass'")
    expect(migration).toContain("' admins read all'")
    expect(migration).toContain("' admins insert'")
    expect(migration).toContain("(client_id, created_at desc)")
    expect(migration).toContain("' admins manage imports'")
    expect(migration).toContain('on delete restrict')
  })

  it('establishes fail-closed core structure RLS with client read-only access', () => {
    expect(migration).toContain("foreach v_table in array array['positions', 'legs', 'fills']")
    expect(migration).toContain('create policy "Positions admins manage"')
    expect(migration).toContain('create policy "Positions account members read own"')
    expect(migration).toContain('create policy "Legs account members read own"')
    expect(migration).toContain('create policy "Fills account members read own"')
    expect(migration).toContain('where position.position_id = public.legs.position_id')
    expect(migration).toContain('where position.position_id = public.fills.position_id')
    const positionsReadPolicy = migration.slice(
      migration.indexOf('create policy "Positions account members read own"'),
      migration.indexOf('create policy "Legs admins manage"'),
    )
    const legsReadPolicy = migration.slice(
      migration.indexOf('create policy "Legs account members read own"'),
      migration.indexOf('create policy "Fills admins manage"'),
    )
    const fillsReadPolicy = migration.slice(
      migration.indexOf('create policy "Fills account members read own"'),
      migration.indexOf('create or replace function public.assign_portal_state_client()'),
    )
    expect(positionsReadPolicy).not.toContain('with check')
    expect(legsReadPolicy).not.toContain('with check')
    expect(fillsReadPolicy).not.toContain('with check')
  })

  it('does not introduce a client UPDATE policy and provides only a narrow reporting-currency RPC', () => {
    expect(migration).not.toMatch(/create policy "Clients[^"\n]*"[\s\S]{0,120}for update/i)
    expect(migration).toContain('create or replace function public.set_own_reporting_currency(')
    expect(migration).toContain('security definer')
    expect(migration).toContain('where c.client_id = v_client_id')
    expect(migration).toContain('grant execute on function public.set_own_reporting_currency(text) to authenticated')
    expect(migration).toContain('revoke all on function public.set_own_reporting_currency(text) from public')
    expect(migration).toContain('create or replace function public.admin_set_client_reporting_currency(')
    expect(migration).toContain('create or replace function public.admin_set_client_hub_account_mapping(')
    expect(migration).toContain('helpers.is_service_role()')
    expect(migration).toContain("reporting_currency_source = 'client'")
    expect(migration).toContain("reporting_currency_source = 'admin'")
  })

  it('makes mapping timestamps and currency provenance database-managed', () => {
    expect(migration).toContain('create or replace function public.enforce_clients_portfolio_data_hub_fields()')
    expect(migration).toContain('new.hub_account_mapped_at := now()')
    expect(migration).toContain("new.reporting_currency_source := 'admin'")
    expect(migration).toContain("new.reporting_currency_source := 'client'")
    expect(migration).toContain('same-value selection still changes provenance')
    expect(migration).toContain('new.reporting_currency := upper(btrim(new.reporting_currency))')
  })

  it('preserves client-name compatibility and creates immutable account-config history', () => {
    expect(migration).toContain('create or replace function public.cascade_client_name_snapshots()')
    expect(migration).toContain("'positions'")
    expect(migration).toContain('where client_id = $2 and client_name is distinct from $1')
    expect(migration).toContain('create table if not exists public.client_account_config_audit')
    expect(migration).toContain("event_type in ('hub_account_mapping', 'reporting_currency')")
    expect(migration).toContain('old_value   jsonb not null')
    expect(migration).toContain('new_value   jsonb not null')
    expect(migration).toContain('create trigger audit_client_account_config_change')
    expect(migration).toContain("if tg_op = 'INSERT' then")
    expect(migration).toContain('OLD is unassigned for INSERT triggers')
    expect(migration).not.toContain("case when tg_op = 'INSERT' then null else old.")
    expect(migration).not.toContain('api_secret')
  })
})
