-- Program playbook resources per program/strategy
create extension if not exists "pgcrypto";

create table if not exists public.program_resources (
  resource_id uuid primary key default gen_random_uuid(),
  program_id text not null references public.programs(program_id) on delete cascade,
  title text not null,
  profit_rule text,
  stop_rule text,
  time_rule text,
  risk_notes text,
  playbook_url text,
  created_at timestamptz not null default now()
);

comment on table public.program_resources is 'Per-program playbook resources with profit/stop/time guidance and reference links.';
comment on column public.program_resources.resource_id is 'Stable identifier for the playbook resource row.';
comment on column public.program_resources.program_id is 'Program this playbook resource belongs to.';
comment on column public.program_resources.title is 'Display title of the playbook or tactic.';
comment on column public.program_resources.profit_rule is 'Profit-taking guidance.';
comment on column public.program_resources.stop_rule is 'Risk/stop guidance.';
comment on column public.program_resources.time_rule is 'Time-based exit or review guidance.';
comment on column public.program_resources.risk_notes is 'Additional KPIs or conditional guidance specific to the tactic.';
comment on column public.program_resources.playbook_url is 'External resource URL for the playbook.';

create index if not exists program_resources_program_id_idx on public.program_resources(program_id);

alter table public.program_resources enable row level security;
