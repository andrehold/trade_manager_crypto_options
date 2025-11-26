-- Create program_playbooks table to store rule sets per program.
create table if not exists public.program_playbooks (
  playbook_id uuid primary key default gen_random_uuid(),
  program_id text not null references public.programs(program_id) on delete cascade,
  title text not null,
  profit_rule text,
  stop_rule text,
  time_rule text,
  risk_notes text,
  playbook_url text,
  sizing_limits jsonb,
  market_signals jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_playbooks_program_id_key unique (program_id)
);

-- Signals that can be rendered alongside the playbook rules.
create table if not exists public.playbook_signals (
  signal_id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.program_playbooks(playbook_id) on delete cascade,
  label text not null,
  trigger text,
  action text,
  created_at timestamptz not null default now()
);

create index if not exists playbook_signals_playbook_id_idx on public.playbook_signals(playbook_id);

-- Migrate existing playbook-like content from program_resources into the new table.
insert into public.program_playbooks (
  program_id,
  title,
  profit_rule,
  stop_rule,
  time_rule,
  risk_notes,
  playbook_url,
  created_at,
  updated_at
)
select
  program_id,
  coalesce(nullif(title, ''), program_id) as title,
  profit_rule,
  stop_rule,
  time_rule,
  risk_notes,
  playbook_url,
  coalesce(created_at, now()) as created_at,
  now() as updated_at
from (
  select distinct on (program_id) *
  from public.program_resources
  order by program_id, created_at asc
) pr
on conflict (program_id) do nothing;

-- Simplify program_resources to link-style resources only.
alter table public.program_resources
  drop constraint if exists program_resources_program_id_url_key,
  drop column if exists profit_rule,
  drop column if exists stop_rule,
  drop column if exists time_rule,
  drop column if exists risk_notes,
  drop column if exists playbook_url;

alter table public.program_playbooks enable row level security;
alter table public.playbook_signals enable row level security;
