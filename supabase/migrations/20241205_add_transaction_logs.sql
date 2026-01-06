create table if not exists public.transaction_logs (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  exchange text not null,
  trade_id text,
  order_id text,
  instrument text,
  timestamp text,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists transaction_logs_exchange_idx
  on public.transaction_logs (exchange);

create index if not exists transaction_logs_client_idx
  on public.transaction_logs (client_name);

create index if not exists transaction_logs_trade_idx
  on public.transaction_logs (trade_id);

create index if not exists transaction_logs_order_idx
  on public.transaction_logs (order_id);
