-- Allow fractional option contract quantities in legs and fills

alter table if exists public.legs
  alter column qty type numeric(18,8)
  using qty::numeric;

alter table if exists public.fills
  alter column qty type numeric(18,8)
  using qty::numeric;

comment on column public.legs.qty is 'Quantity of contracts for the leg (supports fractional values).';
comment on column public.fills.qty is 'Quantity of contracts for the fill (supports fractional values).';
