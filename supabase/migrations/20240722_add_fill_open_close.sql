-- Add optional open/close marker to fills
alter table public.fills
  add column if not exists open_close public.structure_lifecycle_enum;

comment on column public.fills.open_close is 'Open/close marker for the fill (when provided).';

-- Ensure legacy rows start with a null marker
update public.fills
  set open_close = null
  where open_close is not null;
