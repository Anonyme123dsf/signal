-- Arbitrage-Modul: Schema für Worker und Dashboard.
-- Ausführen im Supabase SQL-Editor oder mit `supabase db push`.
-- Alle Tabellen haben RLS aktiviert und keine Policies: Zugriff nur über den
-- Service-Role-Key (Worker und Server-Komponenten), nie über den Anon-Key im Browser.

create extension if not exists pgcrypto;

create table if not exists markets (
  id text primary key,
  kind text not null check (kind in ('crypto_exchange','broker','listings','commodity','mock')),
  name text not null,
  taker_fee_bps numeric not null default 0,
  withdrawal_fees jsonb not null default '{}'::jsonb,
  enabled boolean not null default true
);

create table if not exists latest_prices (
  market_id text not null references markets(id) on delete cascade,
  symbol text not null,
  bid numeric,
  ask numeric,
  bid_size numeric,
  ask_size numeric,
  last numeric,
  ts timestamptz not null default now(),
  listing_id uuid,
  primary key (market_id, symbol)
);

-- Optionale Tick-Historie (RECORD_TICKS=true im Worker). Wächst schnell, deshalb standardmäßig aus.
create table if not exists price_ticks (
  id bigint generated always as identity primary key,
  market_id text not null,
  symbol text not null,
  bid numeric,
  ask numeric,
  ts timestamptz not null default now()
);
create index if not exists price_ticks_symbol_ts on price_ticks (symbol, ts desc);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  market_id text references markets(id),
  external_ref text,
  created_at timestamptz not null default now()
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  market_id text not null references markets(id),
  symbol text not null,
  side text not null check (side in ('sell','buy')),
  price numeric not null check (price > 0),
  quantity numeric not null check (quantity > 0),
  contact_id uuid references contacts(id) on delete set null,
  external_url text,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);
create index if not exists listings_active on listings (status, symbol);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  buy_market_id text not null references markets(id),
  sell_market_id text not null references markets(id),
  buy_price numeric not null,
  sell_price numeric not null,
  trade_size numeric not null,
  gross_spread_bps numeric not null,
  fees_bps numeric not null,
  net_spread_bps numeric not null,
  est_profit_quote numeric not null,
  status text not null default 'open' check (status in ('open','expired','dismissed','executed')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  max_net_spread_bps numeric not null default 0,
  buy_listing_id uuid references listings(id) on delete set null,
  sell_listing_id uuid references listings(id) on delete set null
);
create index if not exists opportunities_status_last_seen on opportunities (status, last_seen desc);
-- Pro Symbol/Marktpaar/Inseratpaar gibt es höchstens eine offene Gelegenheit.
create unique index if not exists opportunities_open_unique
  on opportunities (symbol, buy_market_id, sell_market_id,
                    coalesce(buy_listing_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(sell_listing_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id),
  mode text not null default 'paper' check (mode in ('paper','live')),
  status text not null default 'pending_approval'
    check (status in ('pending_approval','approved','executing','filled','failed','rejected')),
  buy_order jsonb,
  sell_order jsonb,
  realized_pnl_quote numeric,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_status on deals (status, created_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  listing_id uuid references listings(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'draft'
    check (status in ('draft','approved','sent','failed','received','discarded')),
  subject text not null,
  body text not null,
  to_email text not null,
  from_email text not null,
  provider_message_id text,
  thread_tag text not null,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists messages_status on messages (status, created_at desc);
create index if not exists messages_thread_tag on messages (thread_tag);
create index if not exists messages_listing on messages (listing_id);

create table if not exists worker_heartbeats (
  worker_id text primary key,
  last_seen timestamptz not null default now(),
  status jsonb not null default '{}'::jsonb
);

alter table markets enable row level security;
alter table latest_prices enable row level security;
alter table price_ticks enable row level security;
alter table contacts enable row level security;
alter table listings enable row level security;
alter table opportunities enable row level security;
alter table deals enable row level security;
alter table messages enable row level security;
alter table worker_heartbeats enable row level security;
