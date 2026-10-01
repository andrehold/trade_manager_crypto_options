-- Audit privileged repairs to trusted Auth client claims without storing Auth
-- metadata, tokens, credentials, email addresses, or other personal details.

begin;

create table if not exists public.auth_identity_admin_audit (
  id               uuid primary key default gen_random_uuid(),
  ts               timestamptz not null default now(),
  subject_user_id  uuid not null,
  actor_id         uuid,
  actor_role       text not null,
  old_client_id    uuid,
  new_client_id    uuid,
  change_reference text not null,
  operation_result text not null,
  constraint auth_identity_admin_audit_actor_role_check
    check (actor_role in ('service_role')),
  constraint auth_identity_admin_audit_change_reference_check
    check (btrim(change_reference) <> '' and length(change_reference) <= 128),
  constraint auth_identity_admin_audit_operation_result_check
    check (operation_result in ('applied', 'rolled_back'))
);

create index if not exists auth_identity_admin_audit_subject_ts_idx
  on public.auth_identity_admin_audit (subject_user_id, ts desc);

comment on table public.auth_identity_admin_audit is
  'Append-only record of service-role repairs to trusted app_metadata.client_id claims.';
comment on column public.auth_identity_admin_audit.change_reference is
  'Required non-secret operator change/ticket reference; never store credentials or personal information.';

alter table public.auth_identity_admin_audit enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select polname from pg_policy
    where polrelid = 'public.auth_identity_admin_audit'::regclass
  loop
    execute format('drop policy %I on public.auth_identity_admin_audit', v_policy.polname);
  end loop;
end;
$$;

-- Authenticated clients receive table-level SELECT only. RLS exposes rows only
-- to trusted administrators; ordinary client identities have no policy.
create policy "Identity repair audit admins read all"
  on public.auth_identity_admin_audit
  for select using (helpers.is_admin());

revoke all on table public.auth_identity_admin_audit from public, anon, authenticated, service_role;
grant select on table public.auth_identity_admin_audit to authenticated;

create or replace function public.append_auth_identity_admin_audit(
  p_subject_user_id uuid,
  p_old_client_id uuid,
  p_new_client_id uuid,
  p_change_reference text,
  p_operation_result text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_change_reference text := btrim(p_change_reference);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if p_subject_user_id is null then
    raise exception 'subject user id is required' using errcode = '22023';
  end if;
  if v_change_reference is null or v_change_reference = '' or length(v_change_reference) > 128 then
    raise exception 'a non-secret change reference of at most 128 characters is required'
      using errcode = '22023';
  end if;
  if p_operation_result not in ('applied', 'rolled_back') then
    raise exception 'operation result must be applied or rolled_back' using errcode = '22023';
  end if;

  insert into public.auth_identity_admin_audit (
    subject_user_id,
    actor_id,
    actor_role,
    old_client_id,
    new_client_id,
    change_reference,
    operation_result
  ) values (
    p_subject_user_id,
    auth.uid(),
    'service_role',
    p_old_client_id,
    p_new_client_id,
    v_change_reference,
    p_operation_result
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.append_auth_identity_admin_audit(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.append_auth_identity_admin_audit(uuid, uuid, uuid, text, text)
  to service_role;

commit;
