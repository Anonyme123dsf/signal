import { fmtAgo, fmtBps, fmtEur, fmtNum } from "@/lib/arbitrage/format";
import { getOverview } from "@/lib/arbitrage/queries";
import { createPaperDeal, dismissOpportunity } from "./actions";
import { NotConfigured } from "./components/NotConfigured";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const data = await getOverview();
  if (!data) return <NotConfigured />;

  const now = data.fetchedAt;
  const worker = data.heartbeats[0];
  const workerOnline = worker ? now - new Date(worker.last_seen).getTime() < 20_000 : false;
  const status = (worker?.status ?? {}) as Record<string, unknown>;
  const pnl = data.filledDeals.reduce((s, d) => s + Number(d.realized_pnl_quote ?? 0), 0);
  const marketById = new Map(data.markets.map((m) => [m.id, m]));
  const symbols = [...new Set(data.prices.map((p) => p.symbol))].sort();
  const priceMarkets = [...new Set(data.prices.map((p) => p.market_id))].sort();
  const priceAt = (m: string, s: string) => data.prices.find((p) => p.market_id === m && p.symbol === s);

  return (
    <>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Worker</div>
          <div className={`text-lg font-medium ${workerOnline ? "text-[#4ade80]" : "text-[#f87171]"}`}>
            {worker ? (workerOnline ? "online" : "offline") : "nie gesehen"}
          </div>
          <div className="text-xs text-[#7c7c9a]">{worker ? `${worker.worker_id}, ${fmtAgo(worker.last_seen, now)}` : "Worker starten: cd worker && npm run dev"}</div>
        </div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Letzter Zyklus</div>
          <div className="text-lg font-medium">{fmtNum(status.quotes as number, 0)} Preise</div>
          <div className="text-xs text-[#7c7c9a]">{fmtNum(status.candidates as number, 0)} Kandidaten, {fmtNum(status.durationMs as number, 0)} ms</div>
        </div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Offene Gelegenheiten</div>
          <div className="text-lg font-medium">{data.openOpportunities.length}</div>
          <div className="text-xs text-[#7c7c9a]">beste: {data.openOpportunities[0] ? fmtBps(data.openOpportunities[0].net_spread_bps) : "–"}</div>
        </div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Paper-PnL</div>
          <div className={`text-lg font-medium ${pnl >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{fmtEur(pnl)}</div>
          <div className="text-xs text-[#7c7c9a]">{data.filledDeals.length} ausgeführte Deals</div>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="text-sm font-medium mb-3">Aktuelle Kurse (Bid / Ask)</h2>
        {symbols.length === 0 ? (
          <p className="text-sm text-[#7c7c9a]">Noch keine Preise. Läuft der Worker?</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                {priceMarkets.map((m) => (
                  <th key={m} className="num">{marketById.get(m)?.name ?? m}<br /><span className="text-[#5c5c7a]">{fmtNum(marketById.get(m)?.taker_fee_bps, 0)} bps Taker</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((s) => (
                <tr key={s}>
                  <td className="font-medium">{s}</td>
                  {priceMarkets.map((m) => {
                    const p = priceAt(m, s);
                    return (
                      <td key={m} className="num">
                        {p ? <>{fmtNum(p.bid)} / {fmtNum(p.ask)}<br /><span className="text-[#5c5c7a]">{fmtAgo(p.ts, now)}</span></> : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="text-sm font-medium mb-3">Offene Gelegenheiten (nach Netto-Spread)</h2>
        {data.openOpportunities.length === 0 ? (
          <p className="text-sm text-[#7c7c9a]">Gerade keine Gelegenheit über der Schwelle MIN_NET_SPREAD_BPS.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th><th>Kaufen bei</th><th>Verkaufen bei</th>
                <th className="num">Menge</th><th className="num">Brutto</th><th className="num">Kosten</th><th className="num">Netto</th>
                <th className="num">Erw. Gewinn</th><th className="num">Max. Netto</th><th>Zuletzt</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.openOpportunities.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.symbol}</td>
                  <td>{marketById.get(o.buy_market_id)?.name ?? o.buy_market_id}{o.buy_listing_id && <span className="badge ml-1">Inserat</span>}<br /><span className="num text-[#9c9cba]">{fmtNum(o.buy_price)}</span></td>
                  <td>{marketById.get(o.sell_market_id)?.name ?? o.sell_market_id}{o.sell_listing_id && <span className="badge ml-1">Inserat</span>}<br /><span className="num text-[#9c9cba]">{fmtNum(o.sell_price)}</span></td>
                  <td className="num">{fmtNum(o.trade_size, 6)}</td>
                  <td className="num">{fmtBps(o.gross_spread_bps)}</td>
                  <td className="num text-[#f87171]">{fmtBps(-Number(o.fees_bps))}</td>
                  <td className="num text-[#4ade80] font-medium">{fmtBps(o.net_spread_bps)}</td>
                  <td className="num">{fmtEur(o.est_profit_quote)}</td>
                  <td className="num">{fmtBps(o.max_net_spread_bps)}</td>
                  <td className="whitespace-nowrap text-[#9c9cba]">{fmtAgo(o.last_seen, now)}<br /><span className="text-[#5c5c7a]">seit {fmtAgo(o.first_seen, now)}</span></td>
                  <td className="whitespace-nowrap">
                    <form action={createPaperDeal} className="inline"><input type="hidden" name="opportunity_id" value={o.id} /><button className="btn btn-primary mr-1">Paper-Trade</button></form>
                    <form action={dismissOpportunity} className="inline"><input type="hidden" name="opportunity_id" value={o.id} /><button className="btn">Verwerfen</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
