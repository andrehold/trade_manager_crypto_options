create extension if not exists "pgcrypto";

-- Existing table already present; extend it with the playbook fields.
alter table public.program_resources
  add column if not exists profit_rule text,
  add column if not exists stop_rule text,
  add column if not exists time_rule text,
  add column if not exists risk_notes text,
  add column if not exists playbook_url text;

-- Ensure title is required for consistency with the application shape.
update public.program_resources
set title = coalesce(title, 'Untitled Playbook')
where title is null;

alter table public.program_resources
  alter column title set not null;

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
