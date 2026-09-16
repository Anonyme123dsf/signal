-- Paper-Bestände je Börse und Asset. Nach 0002 ausführen. Mehrfaches Ausführen ist unschädlich.
create table if not exists paper_balances (
  market_id text not null references markets(id) on delete cascade,
  asset text not null,
  amount numeric not null default 0,
  initial_amount numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (market_id, asset)
);
alter table paper_balances enable row level security;
