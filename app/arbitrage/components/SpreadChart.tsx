"use client";

import { useEffect, useRef, useState } from "react";

export interface ChartSeries {
  key: string;
  label: string;
  points: { t: number; v: number }[];
}

interface Props {
  series: ChartSeries[];
  /** Zeitfenster in ms, damit die X-Achse auch bei Lücken das ganze Fenster zeigt. */
  from: number;
  to: number;
  /** Abstand zweier Messfenster in ms; größere Lücken unterbrechen die Linie. */
  bucketMs: number;
  thresholdBps: number;
}

/** Kategoriale Farben (dunkle Stufen), gegen die Kartenfläche #0f0f1e validiert. Feste Reihenfolge, nie zyklisch. */
const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
export const MAX_SERIES = SERIES_COLORS.length;

/** Rechts bleibt Platz für die Endbeschriftung ("+12,3"), damit nichts abgeschnitten wird. */
const M = { top: 12, right: 52, bottom: 28, left: 52 };

/** Runde Zeitschritte für die X-Achse, vom Viertelstunden- bis zum Tagesraster. */
const TIME_STEPS = [15, 30, 60, 120, 180, 360, 720, 1440].map((min) => min * 60_000);

function timeTicks(from: number, to: number, maxTicks: number): number[] {
  const span = to - from;
  const step = TIME_STEPS.find((st) => span / st <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}
const H = 280;

function niceStep(span: number, target = 5): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function yScale(series: ChartSeries[], thresholdBps: number) {
  let lo = Math.min(0, thresholdBps);
  let hi = Math.max(0, thresholdBps);
  for (const s of series) for (const p of s.points) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Number(v.toFixed(6)));
  return { yMin: lo, yMax: hi, yTicks: ticks };
}

const fmtBps = (v: number) => `${v >= 0 ? "+" : ""}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(v)}`;
const fmtTime = (t: number, long: boolean) =>
  new Date(t).toLocaleString("de-DE", long ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

/**
 * Liniendiagramm des Netto-Spreads je Route über die Zeit. Eine Achse, 2px-Linien,
 * Nulllinie und Schwellenlinie als Hairlines, Legende oben, Fadenkreuz mit Tooltip
 * über alle Serien am nächsten Messfenster. Werte sind auch in der Tabelle darunter lesbar.
 */
export function SpreadChart({ series, from, to, bucketMs, thresholdBps }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  // Wertebereich: enthält immer Null und die Schwelle, plus etwas Luft. Die Berechnungen sind billig,
  // deshalb ohne manuelles Memoisieren (das übernimmt der React Compiler).
  const { yMin, yMax, yTicks } = yScale(series, thresholdBps);

  const x = (t: number) => M.left + ((t - from) / (to - from)) * plotW;
  const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const xTicks = timeTicks(from, to, Math.max(2, Math.min(8, Math.floor(plotW / 100))));
  const longTime = to - from > 24 * 3_600_000;

  // Alle Zeitpunkte, damit das Fadenkreuz auf ein Messfenster einrastet.
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);

  const paths = series.map((s) => {
    let d = "";
    let prev: { t: number; v: number } | null = null;
    for (const p of s.points) {
      const gap = prev ? p.t - prev.t > bucketMs * 2.5 : true;
      d += `${gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      prev = p;
    }
    return d;
  });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!times.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = from + ((px - M.left) / plotW) * (to - from);
    let best = times[0];
    for (const c of times) if (Math.abs(c - t) < Math.abs(best - t)) best = c;
    setHover({ t: best, x: x(best) });
  };

  const hoverRows = hover ? series.map((s, i) => ({ s, i, p: s.points.find((p) => p.t === hover.t) })) : [];
  const tooltipLeft = hover ? (hover.x > width * 0.6 ? hover.x - 230 : hover.x + 12) : 0;

  // Endbeschriftung nur, wenn die Linienenden mindestens 12px auseinanderliegen; sonst tragen Legende und Tooltip.
  const ends = series
    .map((s, i) => ({ i, p: s.points[s.points.length - 1] }))
    .filter((e): e is { i: number; p: { t: number; v: number } } => Boolean(e.p))
    .map((e) => ({ i: e.i, yy: y(e.p.v), v: e.p.v }))
    .sort((a, b) => a.yy - b.yy);
  const endsSeparated = ends.every((e, k) => k === 0 || e.yy - ends[k - 1].yy >= 12);
  const endLabels = endsSeparated && series.length <= 4 ? ends : [];

  return (
    <div ref={wrapRef} className="relative" style={{ ["--ink" as string]: "#ffffff", ["--ink-2" as string]: "#c3c2b7", ["--muted" as string]: "#898781", ["--grid" as string]: "#2c2c2a", ["--axis" as string]: "#383835" }}>
      {series.length >= 2 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2" aria-label="Legende">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES_COLORS[i] }} />
              <span style={{ color: "var(--ink-2)" }}>{s.label}</span>
            </li>
          ))}
        </ul>
      )}
      <svg
        width={width} height={H} role="img"
        aria-label="Netto-Spread in Basispunkten je Route über die Zeit"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        style={{ display: "block", touchAction: "none" }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={M.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtBps(v)}</text>
          </g>
        ))}
        {thresholdBps !== 0 && thresholdBps > yMin && thresholdBps < yMax && (
          <g>
            <line x1={M.left} x2={M.left + plotW} y1={y(thresholdBps)} y2={y(thresholdBps)} stroke="var(--ink-2)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={M.left + plotW - 4} y={y(thresholdBps) - 4} textAnchor="end" fontSize={10} fill="var(--ink-2)">Schwelle {fmtBps(thresholdBps)} bps</text>
          </g>
        )}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(t, longTime)}</text>
        ))}
        {paths.map((d, i) => (
          <path key={series[i].key} d={d} fill="none" stroke={SERIES_COLORS[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {endLabels.map((e) => (
          <text key={e.i} x={M.left + plotW + 4} y={e.yy} dominantBaseline="middle" fontSize={11} fill="var(--ink-2)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtBps(e.v)}</text>
        ))}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={M.top} y2={M.top + plotH} stroke="var(--ink-2)" strokeWidth={1} shapeRendering="crispEdges" />
            {hoverRows.map(({ i, p }) => p && (
              <circle key={i} cx={hover.x} cy={y(p.v)} r={4} fill={SERIES_COLORS[i]} stroke="#0f0f1e" strokeWidth={2} />
            ))}
          </g>
        )}
        {series.length === 0 && (
          <text x={M.left + plotW / 2} y={M.top + plotH / 2} textAnchor="middle" fontSize={12} fill="var(--muted)">Keine Messpunkte im Zeitraum</text>
        )}
      </svg>
      {hover && (
        <div className="absolute pointer-events-none rounded-md border border-[#33335a] bg-[#0f0f1e] px-3 py-2 text-xs shadow-lg" style={{ left: tooltipLeft, top: M.top, width: 220 }}>
          <div className="mb-1" style={{ color: "var(--muted)" }}>{fmtTime(hover.t, true)}</div>
          {hoverRows.map(({ s, i, p }) => (
            <div key={s.key} className="flex items-center gap-2 leading-5">
              <strong className="num w-16 text-right" style={{ color: "var(--ink)" }}>{p ? fmtBps(p.v) : "–"}</strong>
              <span aria-hidden className="inline-block w-2.5 h-0.5 rounded" style={{ background: SERIES_COLORS[i] }} />
              <span className="truncate" style={{ color: "var(--ink-2)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
