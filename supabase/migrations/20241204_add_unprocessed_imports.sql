-- Track imported-but-unprocessed trades so their IDs can be excluded from future imports.
create table if not exists public.unprocessed_imports (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  trade_id text,
  order_id text,
  instrument text not null,
  side text not null,
  amount numeric not null,
  price numeric not null,
  fee numeric,
  timestamp text,
  exchange text,
  raw jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists unprocessed_imports_client_trade_idx
  on public.unprocessed_imports (client_name, trade_id);

create index if not exists unprocessed_imports_client_order_idx
  on public.unprocessed_imports (client_name, order_id);
