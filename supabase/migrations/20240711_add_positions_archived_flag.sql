-- Add archived tracking fields to positions for soft-delete/archive support

alter table if exists public.positions
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

comment on column public.positions.archived is 'Indicates whether the structure has been archived and hidden from the UI.';
comment on column public.positions.archived_at is 'Timestamp when the structure was archived.';
comment on column public.positions.archived_by is 'User who archived the structure.';

alter table if exists public.positions
  drop constraint if exists positions_archived_by_fkey,
  add constraint positions_archived_by_fkey foreign key (archived_by) references auth.users(id) on delete set null;

create index if not exists positions_archived_idx on public.positions(archived);
