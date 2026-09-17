-- Zählfunktion für Deals, damit Anzahl und Gewinn serverseitig berechnet werden.
-- Ohne sie kappt Supabase die Zeilenausgabe bei 1000, und die Anzeige bleibt dort stehen.
-- Nach 0003 ausführen. Mehrfaches Ausführen ist unschädlich.
create or replace function deal_summary()
returns table (total bigint, filled bigint, wins bigint, pnl numeric)
language sql stable as $$
  select
    count(*) as total,
    count(*) filter (where status = 'filled') as filled,
    count(*) filter (where status = 'filled' and realized_pnl_quote > 0) as wins,
    coalesce(sum(realized_pnl_quote) filter (where status = 'filled'), 0) as pnl
  from deals;
$$;
