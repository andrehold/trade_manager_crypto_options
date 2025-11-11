-- Ensure option quantities allow fractional values even if previous migrations
-- did not run. This migration re-applies the numeric casting defensively so
-- environments stuck on integer columns can be upgraded in place.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'legs'
      and column_name = 'qty'
      and data_type in ('integer', 'bigint')
  ) then
    alter table public.legs
      alter column qty type numeric(18,8)
      using qty::numeric;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fills'
      and column_name = 'qty'
      and data_type in ('integer', 'bigint')
  ) then
    alter table public.fills
      alter column qty type numeric(18,8)
      using qty::numeric;
  end if;
end $$;

comment on column public.legs.qty is 'Quantity of contracts for the leg (supports fractional values).';
comment on column public.fills.qty is 'Quantity of contracts for the fill (supports fractional values).';
