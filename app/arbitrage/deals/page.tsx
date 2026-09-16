import { fmtBps, fmtEur, fmtNum, fmtTime, shortId } from "@/lib/arbitrage/format";
import { getDeals } from "@/lib/arbitrage/queries";
import { NotConfigured } from "../components/NotConfigured";

export const dynamic = "force-dynamic";

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
              <tr><th>Zeit</th><th>Deal</th><th>Symbol</th><th>Route</th><th>Modus</th><th>Status</th>
                <th className="num">Kauf</th><th className="num">Verkauf</th><th className="num">Menge</th><th className="num">Gebühren</th><th className="num">PnL</th><th className="num">Erwartet</th></tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const o = d.opportunity;
                const fees = (d.buy_order?.fee_quote ?? 0) + (d.sell_order?.fee_quote ?? 0);
                const pnlD = Number(d.realized_pnl_quote ?? 0);
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap text-[#9c9cba]">{fmtTime(d.created_at)}</td>
                    <td className="num">{shortId(d.id)}</td>
                    <td className="font-medium">{o?.symbol ?? "–"}</td>
                    <td>{o ? `${o.buy_market_id} → ${o.sell_market_id}` : "–"}</td>
                    <td><span className="badge">{d.mode}</span></td>
                    <td>{STATUS_LABEL[d.status] ?? d.status}{d.error && <div className="text-xs text-[#f87171]">{d.error}</div>}</td>
                    <td className="num">{fmtNum(d.buy_order?.price)}</td>
                    <td className="num">{fmtNum(d.sell_order?.price)}</td>
                    <td className="num">{fmtNum(d.buy_order?.amount ?? o?.trade_size, 6)}</td>
                    <td className="num">{d.status === "filled" ? fmtEur(fees) : "–"}</td>
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
