import Link from "next/link";
import { fmtAgo, fmtBps, fmtNum, fmtPct, fmtTime } from "@/lib/arbitrage/format";
import { getHistory, HISTORY_RANGES, routeKey, routeLabel, type HistoryRange } from "@/lib/arbitrage/queries";
import { NotConfigured } from "../components/NotConfigured";
import { MAX_SERIES, SpreadChart, type ChartSeries } from "../components/SpreadChart";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function pick(sp: Search, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const rangeParam = pick(sp, "range");
  const range: HistoryRange = rangeParam && rangeParam in HISTORY_RANGES ? (rangeParam as HistoryRange) : "24h";
  const thresholdRaw = Number(pick(sp, "threshold") ?? "10");
  const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 10;
  const kindFilter = pick(sp, "kind") ?? "all";

  const data = await getHistory(range, threshold);
  if (!data) return <NotConfigured />;

  const stats = data.stats.filter((s) => kindFilter === "all" || s.kind === kindFilter);
  const totalSamples = stats.reduce((n, s) => n + Number(s.samples), 0);
  const weightedAbove = totalSamples ? stats.reduce((n, s) => n + Number(s.samples) * Number(s.share_above), 0) / totalSamples : 0;
  const best = stats[0];

  const topKeys = stats.slice(0, MAX_SERIES).map(routeKey);
  const series: ChartSeries[] = topKeys.map((key) => {
    const r = stats.find((s) => routeKey(s) === key)!;
    return {
      key,
      label: routeLabel(r, data.markets),
      points: data.series.filter((p) => routeKey(p) === key).map((p) => ({ t: new Date(p.bucket).getTime(), v: Number(p.avg_net) })).sort((a, b) => a.t - b.t),
    };
  });
  const from = new Date(data.since).getTime();
  const to = data.fetchedAt;
  const linkTo = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ range, threshold: String(threshold), kind: kindFilter, ...patch });
    return `/arbitrage/history?${q.toString()}`;
  };

  return (
    <>
      <section className="card flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <label>Zeitraum</label>
          <div className="flex gap-1">
            {(Object.keys(HISTORY_RANGES) as HistoryRange[]).map((r) => (
              <Link key={r} href={linkTo({ range: r })} className={`btn ${r === range ? "btn-primary" : ""}`} aria-current={r === range ? "true" : undefined}>
                {r === range ? "✓ " : ""}{HISTORY_RANGES[r].label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <label>Art</label>
          <div className="flex gap-1">
            {[["all", "Alle"], ["cross", "Cross"], ["triangle", "Dreieck"]].map(([k, l]) => (
              <Link key={k} href={linkTo({ kind: k })} className={`btn ${k === kindFilter ? "btn-primary" : ""}`}>{k === kindFilter ? "✓ " : ""}{l}</Link>
            ))}
          </div>
        </div>
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="range" value={range} />
          <input type="hidden" name="kind" value={kindFilter} />
          <div>
            <label htmlFor="threshold">Schwelle (bps)</label>
            <input id="threshold" name="threshold" type="number" step="1" defaultValue={threshold} className="w-28" />
          </div>
          <button className="btn">Anwenden</button>
        </form>
        <div className="text-xs text-[#7c7c9a] ml-auto">
          Messfenster {fmtNum(data.bucketSeconds / 60, 0)} min · Stand {fmtAgo(new Date(data.fetchedAt).toISOString(), data.fetchedAt)}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card"><div className="text-xs text-[#7c7c9a]">Routen im Zeitraum</div><div className="text-lg font-medium">{stats.length}</div></div>
        <div className="card"><div className="text-xs text-[#7c7c9a]">Messpunkte</div><div className="text-lg font-medium">{fmtNum(totalSamples, 0)}</div></div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Anteil über Schwelle</div>
          <div className="text-lg font-medium">{fmtPct(weightedAbove)}</div>
          <div className="text-xs text-[#7c7c9a]">aller Messpunkte ≥ {fmtNum(threshold, 0)} bps</div>
        </div>
        <div className="card">
          <div className="text-xs text-[#7c7c9a]">Beste Route (Ø netto)</div>
          <div className={`text-lg font-medium ${best && Number(best.avg_net) >= 0 ? "text-[#4ade80]" : ""}`}>{best ? fmtBps(best.avg_net) : "–"}</div>
          <div className="text-xs text-[#7c7c9a] truncate">{best ? routeLabel(best, data.markets) : "noch keine Daten"}</div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-medium mb-1">Netto-Spread je Route (Ø pro Messfenster, in bps)</h2>
        <p className="text-xs text-[#7c7c9a] mb-3">
          Die {Math.min(stats.length, MAX_SERIES)} Routen mit dem höchsten Durchschnitt. Nulllinie hell, Schwelle als Linie. Alle Routen stehen in der Tabelle darunter.
        </p>
        <SpreadChart series={series} from={from} to={to} bucketMs={data.bucketSeconds * 1000} thresholdBps={threshold} />
      </section>

      <section className="card overflow-x-auto">
        <h2 className="text-sm font-medium mb-3">Kennzahlen je Route</h2>
        {stats.length === 0 ? (
          <p className="text-sm text-[#7c7c9a]">
            Keine Messpunkte. Der Worker schreibt alle SPREAD_SAMPLE_INTERVAL_MS jede bewertete Route in spread_samples, sobald er läuft.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Art</th><th>Route</th><th className="num">Messpunkte</th><th className="num">Ø netto</th><th className="num">Median</th>
                <th className="num">P90</th><th className="num">Max</th><th className="num">Anteil &gt; 0</th><th className="num">Anteil ≥ Schwelle</th><th className="num">Zuletzt</th><th>Wann</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={routeKey(s)}>
                  <td><span className="badge">{s.kind === "triangle" ? "Dreieck" : "Cross"}</span></td>
                  <td className="whitespace-nowrap">{routeLabel(s, data.markets)}</td>
                  <td className="num">{fmtNum(s.samples, 0)}</td>
                  <td className={`num font-medium ${Number(s.avg_net) >= 0 ? "text-[#4ade80]" : ""}`}>{fmtBps(s.avg_net)}</td>
                  <td className="num">{fmtBps(s.p50_net)}</td>
                  <td className="num">{fmtBps(s.p90_net)}</td>
                  <td className="num">{fmtBps(s.max_net)}</td>
                  <td className="num">{fmtPct(s.share_positive)}</td>
                  <td className="num">{fmtPct(s.share_above)}</td>
                  <td className="num">{fmtBps(s.last_net)}</td>
                  <td className="whitespace-nowrap text-[#9c9cba]">{fmtAgo(s.last_ts, data.fetchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {series.length > 0 && (
        <details className="card">
          <summary className="text-sm font-medium cursor-pointer">Tabellenansicht der Zeitreihe</summary>
          <div className="overflow-x-auto mt-3">
            <table>
              <thead>
                <tr><th>Messfenster</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr>
              </thead>
              <tbody>
                {[...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => b - a).map((t) => (
                  <tr key={t}>
                    <td className="whitespace-nowrap text-[#9c9cba]">{fmtTime(new Date(t).toISOString())}</td>
                    {series.map((s) => {
                      const p = s.points.find((q) => q.t === t);
                      return <td key={s.key} className="num">{p ? fmtBps(p.v) : "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
