import type { OrderFill } from "@/shared/types";
import { fmtAmount, fmtBps, fmtEur, fmtPrice, fmtTime, shortId } from "@/lib/arbitrage/format";
import { getDeals } from "@/lib/arbitrage/queries";
import { NotConfigured } from "../components/NotConfigured";
import { AutoRefresh } from "../components/AutoRefresh";

export const dynamic = "force-dynamic";

const SIDE: Record<OrderFill["side"], string> = { buy: "kaufen", sell: "verkaufen" };

/** Gebühren je Währung zusammenfassen: "0,50 EUR + 0,000002 BTC". */
function fmtFees(fills: OrderFill[]): string {
  const byAsset = new Map<string, number>();
  for (const f of fills) byAsset.set(f.fee_asset, (byAsset.get(f.fee_asset) ?? 0) + Number(f.fee_quote));
  if (!byAsset.size) return "–";
  return [...byAsset].map(([asset, v]) => fmtAmount(v, asset)).join(" + ");
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "wartet auf Freigabe", approved: "freigegeben", executing: "wird ausgeführt",
  filled: "ausgeführt", failed: "fehlgeschlagen", rejected: "abgelehnt",
};

export default async function DealsPage() {
  const deals = await getDeals();
  if (!deals) return <NotConfigured />;
  const filled = deals.filter((d) => d.status === "filled");
  const pnl = filled.reduce((s, d) => s + Number(d.realized_pnl_quote ?? 0), 0);
  const wins = filled.filter((d) => Number(d.realized_pnl_quote ?? 0) > 0).length;

  return (
    <>
      {/* Deals werden vom Worker im nächsten Zyklus ausgeführt. */}
      <AutoRefresh intervalMs={5000} />
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-[#7c7c9a]">Deals gesamt</div><div className="text-lg font-medium">{deals.length}</div></div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Ausgeführt</div><div className="text-lg font-medium">{filled.length}</div></div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Trefferquote</div><div className="text-lg font-medium">{filled.length ? `${Math.round((wins / filled.length) * 100)} %` : "–"}</div></div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Paper-PnL</div><div className={`text-lg font-medium ${pnl >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{fmtEur(pnl)}</div></div>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="text-sm font-medium mb-3">Deals</h2>
        {deals.length === 0 ? (
          <p className="text-sm text-[#7c7c9a]">Noch keine Deals. Auf der Übersicht eine Gelegenheit als Paper-Trade anlegen oder AUTO_PAPER_BPS setzen.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Zeit</th><th>Deal</th><th>Art</th><th>Symbol / Pfad</th><th>Ausführungen</th><th>Modus</th><th>Status</th>
                <th className="num">Gebühren</th><th className="num">PnL</th><th className="num">Erwartet</th></tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const o = d.opportunity;
                const fills: OrderFill[] = d.fills?.length ? d.fills : [d.buy_order, d.sell_order].filter((f): f is OrderFill => Boolean(f));
                const pnlD = Number(d.realized_pnl_quote ?? 0);
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap text-[#9c9cba]">{fmtTime(d.created_at)}</td>
                    <td className="num">{shortId(d.id)}</td>
                    <td><span className="badge">{o?.kind === "triangle" ? "Dreieck" : "Cross"}</span></td>
                    <td className="font-medium whitespace-nowrap">{o?.symbol ?? "–"}</td>
                    <td>
                      {fills.length === 0 ? (
                        <span className="text-[#7c7c9a]">{o ? (o.kind === "triangle" ? `auf ${o.buy_market_id}` : `${o.buy_market_id} → ${o.sell_market_id}`) : "–"}</span>
                      ) : (
                        <ol className="text-xs space-y-0.5">
                          {fills.map((f, i) => (
                            <li key={i}>
                              <span className="text-[#9c9cba]">{f.market_id}</span> {f.symbol} {SIDE[f.side]} <span className="num">{fmtAmount(f.amount)}</span> @ <span className="num">{fmtPrice(f.price)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                    <td><span className="badge">{d.mode}</span></td>
                    <td>{STATUS_LABEL[d.status] ?? d.status}{d.error && <div className="text-xs text-[#f87171]">{d.error}</div>}</td>
                    <td className="num text-xs">{d.status === "filled" ? fmtFees(fills) : "–"}</td>
                    <td className={`num font-medium ${d.status !== "filled" ? "" : pnlD >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{d.status === "filled" ? fmtEur(pnlD) : "–"}</td>
                    <td className="num text-[#9c9cba]">{o ? `${fmtEur(o.est_profit_quote)} (${fmtBps(o.net_spread_bps)})` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
