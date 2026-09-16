-- Dreiecks-Arbitrage und Spread-Historie.
-- Nach 0001_arbitrage.sql ausführen. Mehrfaches Ausführen ist unschädlich.

-- Gelegenheiten bekommen eine Art (cross | triangle) und die einzelnen Schritte.
alter table opportunities add column if not exists kind text not null default 'cross';
alter table opportunities drop constraint if exists opportunities_kind_check;
alter table opportunities add constraint opportunities_kind_check check (kind in ('cross','triangle'));
alter table opportunities add column if not exists legs jsonb not null default '[]'::jsonb;

-- Deals speichern alle Ausführungen in Reihenfolge (bei Dreiecken drei Stück).
alter table deals add column if not exists fills jsonb not null default '[]'::jsonb;

-- Spread-Historie: Der Worker schreibt in festem Takt (SPREAD_SAMPLE_INTERVAL_MS) jede bewertete Route,
-- auch mit negativem Netto-Spread. Alte Zeilen löscht er nach SPREAD_HISTORY_DAYS.
create table if not exists spread_samples (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null check (kind in ('cross','triangle')),
  symbol text not null,
  buy_market_id text not null,
  sell_market_id text not null,
  gross_bps numeric not null,
  fees_bps numeric not null,
  net_bps numeric not null,
  est_profit_quote numeric not null,
  trade_size numeric not null
);
create index if not exists spread_samples_ts on spread_samples (ts desc);
create index if not exists spread_samples_route_ts on spread_samples (symbol, buy_market_id, sell_market_id, ts desc);
alter table spread_samples enable row level security;

-- Kennzahlen pro Route seit einem Zeitpunkt. Aufruf aus dem Dashboard per RPC.
create or replace function spread_route_stats(since timestamptz, threshold_bps numeric default 0)
returns table (
  kind text, symbol text, buy_market_id text, sell_market_id text,
  samples bigint, avg_net numeric, max_net numeric, p50_net numeric, p90_net numeric,
  share_positive numeric, share_above numeric, last_net numeric, last_ts timestamptz
)
language sql stable as $$
  select
    s.kind, s.symbol, s.buy_market_id, s.sell_market_id,
    count(*) as samples,
    round(avg(s.net_bps), 2) as avg_net,
    round(max(s.net_bps), 2) as max_net,
    round((percentile_cont(0.5) within group (order by s.net_bps))::numeric, 2) as p50_net,
    round((percentile_cont(0.9) within group (order by s.net_bps))::numeric, 2) as p90_net,
    round(avg((s.net_bps > 0)::int)::numeric, 4) as share_positive,
    round(avg((s.net_bps >= threshold_bps)::int)::numeric, 4) as share_above,
    (array_agg(s.net_bps order by s.ts desc))[1] as last_net,
    max(s.ts) as last_ts
  from spread_samples s
  where s.ts >= since
  group by s.kind, s.symbol, s.buy_market_id, s.sell_market_id
  order by avg_net desc;
$$;

-- Zeitreihe pro Route in Zeitfenstern von bucket_seconds. Für das Verlaufsdiagramm.
create or replace function spread_route_series(since timestamptz, bucket_seconds integer default 300)
returns table (
  bucket timestamptz, kind text, symbol text, buy_market_id text, sell_market_id text,
  avg_net numeric, max_net numeric
)
language sql stable as $$
  select
    to_timestamp(floor(extract(epoch from s.ts) / bucket_seconds) * bucket_seconds) as bucket,
    s.kind, s.symbol, s.buy_market_id, s.sell_market_id,
    round(avg(s.net_bps), 2) as avg_net,
    round(max(s.net_bps), 2) as max_net
  from spread_samples s
  where s.ts >= since
  group by 1, 2, 3, 4, 5
  order by 1;
$$;
