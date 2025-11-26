-- Add missing general link and note fields for program_resources.
alter table public.program_resources
  add column if not exists url text,
  add column if not exists notes text;

comment on column public.program_resources.url is 'Optional external link for the program resource.';
comment on column public.program_resources.notes is 'Additional general notes for the program resource.';
