-- Adds lifecycle tracking and linking metadata to positions.

-- 1) Enum for lifecycle states (idempotent creation)
do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'structure_lifecycle_enum'
  ) then
    create type public.structure_lifecycle_enum as enum ('open', 'close');
  end if;
end $$;

-- 2) New lifecycle + linking columns on positions
alter table public.positions
  add column if not exists lifecycle public.structure_lifecycle_enum not null default 'open',
  add column if not exists close_target_structure_id uuid,
  add column if not exists linked_structure_ids uuid[] default array[]::uuid[];

-- Backfill lifecycle for existing rows (in case column was nullable during creation)
update public.positions
  set lifecycle = 'open'
  where lifecycle is null;

-- 3) Enforce relational integrity and business rules
alter table public.positions
  drop constraint if exists positions_close_target_structure_id_fkey,
  add constraint positions_close_target_structure_id_fkey
    foreign key (close_target_structure_id)
    references public.positions(position_id)
    on delete set null;

alter table public.positions
  drop constraint if exists positions_lifecycle_close_requires_link,
  add constraint positions_lifecycle_close_requires_link
    check (
      lifecycle <> 'close'
      or (
        close_target_structure_id is not null
        and array_length(linked_structure_ids, 1) >= 1
      )
    );

alter table public.positions
  drop constraint if exists positions_close_target_must_be_linked,
  add constraint positions_close_target_must_be_linked
    check (
      close_target_structure_id is null
      or linked_structure_ids @> array[close_target_structure_id]
    );

-- 4) Helpful indexes for lookup + membership checks
create index if not exists positions_close_target_structure_id_idx
  on public.positions(close_target_structure_id);

create index if not exists positions_linked_structure_ids_gin_idx
  on public.positions
  using gin (linked_structure_ids);

-- 5) Document the new columns
comment on column public.positions.lifecycle is 'Lifecycle state for the structure entry overlay (open or close).';
comment on column public.positions.close_target_structure_id is 'Structure that this position is closing out (required when lifecycle = close).';
comment on column public.positions.linked_structure_ids is 'Other related structures (includes close target when lifecycle = close).';
