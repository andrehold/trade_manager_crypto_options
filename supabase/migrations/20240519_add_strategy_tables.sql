-- Adds strategy catalog + program linkage tables and options structure constraint.

-- 1) Strategy catalog (shared across programs)
create table if not exists public.strategies (
  strategy_code text primary key,
  strategy_name text not null,
  description text,
  created_at timestamptz not null default now()
);

comment on table public.strategies is 'Canonical list of strategies shared across programs.';
comment on column public.strategies.strategy_code is 'Stable identifier used by upstream integrations (e.g. CSV import).';
comment on column public.strategies.strategy_name is 'Human readable label for display.';

-- 2) Program/strategy mapping (effective dated optional columns for future use)
create table if not exists public.program_strategies (
  program_id text not null references public.programs(program_id) on delete cascade,
  strategy_code text not null references public.strategies(strategy_code) on delete cascade,
  effective_from date default current_date,
  effective_to date,
  primary key (program_id, strategy_code)
);

comment on table public.program_strategies is 'Associates strategies with programs; use effective dates when reassigning.';

-- 3) Snapshot columns on positions
alter table public.positions
  add column if not exists strategy_name_at_entry text;

update public.positions
  set strategy_name_at_entry = coalesce(strategy_name_at_entry, strategy_name)
  where strategy_name is not null;

comment on column public.positions.strategy_name_at_entry is 'Human readable strategy label captured when the position is inserted.';

-- 4) Options structure constraint for data integrity
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_options_structure_chk'
      and conrelid = 'public.positions'::regclass
  ) then
    alter table public.positions
      add constraint positions_options_structure_chk
      check (options_structure in (
        'single_option','vertical','calendar','diagonal','butterfly',
        'iron_condor','strangle','straddle','ratio','broken_wing','collar'
      ));
  end if;
end $$;

-- 5) Ensure dependent tables inherit row level security settings
alter table public.strategies enable row level security;
alter table public.program_strategies enable row level security;

-- Optional policies (example): allow owners to manage their catalog entries.
-- adjust for your auth schema as needed.
-- create policy "Strategies are readable" on public.strategies
--   for select using (true);
