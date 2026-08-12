import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = (name: string) => readFileSync(
  resolve(process.cwd(), 'supabase/migrations', name),
  'utf8',
)

const accountSecurity = readMigration('20260812090000_account_identity_rls_hardening.sql')
const hubMapping = readMigration('20260812091000_portfolio_data_hub_mapping.sql')
const reportingCurrency = readMigration('20260812092000_reporting_currency_configuration.sql')

describe('account identity and RLS migration', () => {
  it('uses only trusted app_metadata and removes unknown permissive policies', () => {
    expect(accountSecurity).toContain("auth.jwt() -> 'app_metadata' ->> 'client_id'")
    expect(accountSecurity).toContain("auth.jwt() -> 'app_metadata' ->> 'role'")
    expect(accountSecurity).not.toContain("auth.jwt() -> 'user_metadata'")
    expect(accountSecurity).toContain('create policy "Admins manage clients"')
    expect(accountSecurity).toContain('create policy "Clients read own client profile"')
    expect(accountSecurity).not.toMatch(/create policy "Clients[^"\n]*"[\s\S]{0,120}for update/i)
    expect(accountSecurity).toContain('revoke all on schema helpers from public')
  })

  it('moves all persisted portal state to client IDs and explicitly enables RLS', () => {
    for (const table of [
      'appropriateness_assessments', 'strategy_selections', 'risk_limit_selections',
      'exchange_key_events', 'activation_events', 'update_approvals', 'audit_events',
      'position_interventions', 'transaction_logs', 'unprocessed_imports',
    ]) {
      expect(accountSecurity).toContain(`'${table}'`)
    }
    expect(accountSecurity).toContain('foreign key (client_id) references public.clients(client_id) on delete restrict')
    expect(accountSecurity).toContain("execute format('alter table public.%I enable row level security', v_table)")
    expect(accountSecurity).toContain("continue when to_regclass(format('public.%I', v_table)) is null")
    expect(accountSecurity).toContain('create or replace function public.assign_portal_state_client()')
    expect(accountSecurity).toContain('new.client_id := v_client_id')
    expect(accountSecurity).toContain('new.client_name := v_client_name')
    expect(accountSecurity).toContain('create or replace function public.cascade_client_name_snapshots()')
  })

  it('establishes fail-closed read-only client access to positions, legs, and fills', () => {
    expect(accountSecurity).toContain("foreach v_table in array array['positions', 'legs', 'fills']")
    expect(accountSecurity).toContain('create policy "Positions account members read own"')
    expect(accountSecurity).toContain('create policy "Legs account members read own"')
    expect(accountSecurity).toContain('create policy "Fills account members read own"')
    expect(accountSecurity).toContain('where position.position_id = public.legs.position_id')
    expect(accountSecurity).toContain('where position.position_id = public.fills.position_id')
  })
})

describe('Portfolio Data Hub mapping migration', () => {
  it('contains only the routing identity and one-to-one mapping safeguards', () => {
    expect(hubMapping).toContain('add column if not exists hub_account_id uuid')
    expect(hubMapping).toContain('add column if not exists hub_account_label text')
    expect(hubMapping).toContain('add column if not exists hub_account_mapped_at timestamptz')
    expect(hubMapping).toContain('create unique index if not exists clients_hub_account_id_unique')
    expect(hubMapping).toContain('clients_hub_mapping_fields_check')
    expect(hubMapping).not.toContain('reporting_currency')
  })

  it('exposes a narrow admin mapping RPC and immutable mapping audit', () => {
    expect(hubMapping).toContain('create or replace function public.admin_set_client_hub_account_mapping(')
    expect(hubMapping).toContain('helpers.is_service_role()')
    expect(hubMapping).toContain('create table if not exists public.client_account_config_audit')
    expect(hubMapping).toContain("check (event_type in ('hub_account_mapping'))")
    expect(hubMapping).toContain('create trigger audit_client_hub_mapping_change')
    expect(hubMapping).not.toContain('api_secret')
  })
})

describe('reporting currency configuration migration', () => {
  it('adds canonical currency fields without changing the Hub mapping', () => {
    expect(reportingCurrency).toContain('add column if not exists reporting_currency text')
    expect(reportingCurrency).toContain('add column if not exists reporting_currency_source text')
    expect(reportingCurrency).toContain("reporting_currency_source in ('client', 'admin')")
    expect(reportingCurrency).toContain("reporting_currency ~ '^[A-Z0-9]{2,12}$'")
    expect(reportingCurrency).toContain('new.reporting_currency := upper(btrim(new.reporting_currency))')
    expect(reportingCurrency).not.toContain('add column if not exists hub_account_id')
  })

  it('provides narrow client/admin RPCs and extends audit history', () => {
    expect(reportingCurrency).toContain('create or replace function public.set_own_reporting_currency(')
    expect(reportingCurrency).toContain('where c.client_id = v_client_id')
    expect(reportingCurrency).toContain('grant execute on function public.set_own_reporting_currency(text) to authenticated')
    expect(reportingCurrency).toContain('create or replace function public.admin_set_client_reporting_currency(')
    expect(reportingCurrency).toContain("reporting_currency_source = 'client'")
    expect(reportingCurrency).toContain("reporting_currency_source = 'admin'")
    expect(reportingCurrency).toContain("check (event_type in ('hub_account_mapping', 'reporting_currency'))")
    expect(reportingCurrency).toContain('create trigger audit_client_reporting_currency_change')
  })
})
