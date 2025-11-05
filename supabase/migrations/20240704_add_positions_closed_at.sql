-- Adds a closed_at timestamp to track when open structures are closed out.
alter table public.positions
  add column if not exists closed_at timestamptz;

comment on column public.positions.closed_at is 'Timestamp when the structure was closed (null when still open).';
