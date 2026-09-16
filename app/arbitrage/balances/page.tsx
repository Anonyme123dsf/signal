import { fmtAgo, fmtAmount, fmtEur } from "@/lib/arbitrage/format";
import { getBalances, valueInQuote } from "@/lib/arbitrage/queries";
import { AutoRefresh } from "../components/AutoRefresh";
import { NotConfigured } from "../components/NotConfigured";

export const dynamic = "force-dynamic";

export default async function BalancesPage() {
  const data = await getBalances();
  if (!data) return <NotConfigured />;
  const name = (id: string) => data.markets.find((m) => m.id === id)?.name ?? id;

  const rows = data.balances.map((b) => {
    const amount = Number(b.amount);
    const initial = Number(b.initial_amount);
    const value = valueInQuote(b.asset, amount, b.market_id, data.prices);
    const initialValue = valueInQuote(b.asset, initial, b.market_id, data.prices);
    return { ...b, amount, initial, value, initialValue };
  });
  const byMarket = new Map<string, typeof rows>();
  for (const r of rows) byMarket.set(r.market_id, [...(byMarket.get(r.market_id) ?? []), r]);
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const totalInitial = rows.reduce((s, r) => s + (r.initialValue ?? 0), 0);
  const unpriced = rows.filter((r) => r.value === null).length;

  return (
    <>
      <AutoRefresh intervalMs={5000} />
      <p className="text-sm text-[#9c9cba]">
        Paper-Bestände je Börse. Der Worker prüft vor jeder Ausführung, ob der Bestand für jeden Schritt reicht, und bucht danach um.
        Bewertung zum Mittelkurs der jeweiligen Börse in EUR. Startbestände kommen aus PAPER_BALANCES.
      </p>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-[#7c7c9a]">Gesamtwert</div><div className="text-lg font-medium">{fmtEur(total)}</div></div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Startwert (zu heutigen Kursen)</div><div className="text-lg font-medium">{fmtEur(totalInitial)}</div></div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Veränderung</div>
          <div className={`text-lg font-medium ${total - totalInitial >= 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{fmtEur(total - totalInitial)}</div>
        </div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Börsen</div><div className="text-lg font-medium">{byMarket.size}</div>{unpriced > 0 && <div className="text-xs text-[#f87171]">{unpriced} Bestände ohne Kurs</div>}</div>
      </section>

      {rows.length === 0 ? (
        <div className="card"><p className="text-sm text-[#7c7c9a]">Keine Bestände. Im Worker PAPER_BALANCES setzen, z. B. kraken:EUR=1000,bitvavo:EUR=1000,kraken:BTC=0.01.</p></div>
      ) : (
        [...byMarket].map(([marketId, list]) => {
          const sum = list.reduce((s, r) => s + (r.value ?? 0), 0);
          return (
            <section key={marketId} className="card overflow-x-auto">
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-sm font-medium">{name(marketId)}</h2>
                <span className="text-xs text-[#7c7c9a]">Wert {fmtEur(sum)}</span>
              </div>
              <table>
                <thead>
                  <tr><th>Asset</th><th className="num">Bestand</th><th className="num">Start</th><th className="num">Veränderung</th><th className="num">Wert (EUR)</th><th>Aktualisiert</th></tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const diff = r.amount - r.initial;
                    return (
                      <tr key={r.asset}>
                        <td className="font-medium">{r.asset}</td>
                        <td className="num">{fmtAmount(r.amount)}</td>
                        <td className="num text-[#9c9cba]">{fmtAmount(r.initial)}</td>
                        <td className={`num ${Math.abs(diff) < 1e-9 ? "text-[#9c9cba]" : diff > 0 ? "text-[#4ade80]" : "text-[#f87171]"}`}>{diff > 0 ? "+" : ""}{fmtAmount(diff)}</td>
                        <td className="num">{r.value === null ? <span className="text-[#f87171]">kein Kurs</span> : fmtEur(r.value)}</td>
                        <td className="whitespace-nowrap text-[#9c9cba]">{fmtAgo(r.updated_at, data.fetchedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })
      )}
    </>
  );
}
