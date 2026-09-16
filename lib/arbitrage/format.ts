const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function fmtNum(v: number | string | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  return digits === 2 ? num.format(n) : new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(n);
}

export function fmtBps(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${num.format(n)} bps`;
}

export function fmtEur(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const n = Number(v);
  return Number.isFinite(n) ? money.format(n) : "–";
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < 1000) return "gerade eben";
  if (diff < 60_000) return `vor ${Math.round(diff / 1000)} s`;
  if (diff < 3_600_000) return `vor ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `vor ${Math.round(diff / 3_600_000)} h`;
  return new Date(iso).toLocaleString("de-DE");
}

export function fmtTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("de-DE") : "–";
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
