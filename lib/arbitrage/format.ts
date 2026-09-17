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

export function fmtPct(share: number | string | null | undefined): string {
  if (share === null || share === undefined) return "–";
  const n = Number(share);
  return Number.isFinite(n) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n * 100)} %` : "–";
}

/** Preis mit passender Genauigkeit: 60.000 für BTC/EUR, 0,05012 für ETH/BTC. */
export function fmtPrice(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
}

/** Menge in Basiswährung mit passender Genauigkeit. */
export function fmtAmount(v: number | string | null | undefined, asset = ""): string {
  if (v === null || v === undefined) return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  const s = new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(n);
  return asset ? `${s} ${asset}` : s;
}
