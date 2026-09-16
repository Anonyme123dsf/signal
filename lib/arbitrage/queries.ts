import type {
  ContactRow, DealRow, ListingRow, MarketRow, MessageRow, OpportunityRow, PriceRow,
  SpreadRouteStats, SpreadSeriesPoint, WorkerHeartbeatRow,
} from "@/shared/types";
import { getServiceClient } from "./supabase";

export type DealWithOpportunity = DealRow & { opportunity: OpportunityRow | null };
export type MessageWithContact = MessageRow & { contact: Pick<ContactRow, "name"> | null };
export type ListingWithContact = ListingRow & { contact: Pick<ContactRow, "name" | "email"> | null };

export interface Overview {
  /** Zeitpunkt der Abfrage (ms), damit die Seite relative Zeiten ohne Date.now() im Render berechnen kann. */
  fetchedAt: number;
  heartbeats: WorkerHeartbeatRow[];
  markets: MarketRow[];
  prices: PriceRow[];
  openOpportunities: OpportunityRow[];
  filledDeals: Pick<DealRow, "realized_pnl_quote">[];
}

function must<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data as T;
}

export async function getOverview(): Promise<Overview | null> {
  const db = getServiceClient();
  if (!db) return null;
  const [hb, markets, prices, opps, deals] = await Promise.all([
    db.from("worker_heartbeats").select("*").order("last_seen", { ascending: false }),
    db.from("markets").select("*").order("id"),
    db.from("latest_prices").select("*"),
    db.from("opportunities").select("*").eq("status", "open").order("net_spread_bps", { ascending: false }).limit(50),
    db.from("deals").select("realized_pnl_quote").eq("status", "filled"),
  ]);
  return {
    fetchedAt: Date.now(),
    heartbeats: must(hb, "worker_heartbeats"),
    markets: must(markets, "markets"),
    prices: must(prices, "latest_prices"),
    openOpportunities: must(opps, "opportunities"),
    filledDeals: must(deals, "deals"),
  };
}

export async function getDeals(): Promise<DealWithOpportunity[] | null> {
  const db = getServiceClient();
  if (!db) return null;
  const res = await db.from("deals").select("*, opportunity:opportunities(*)").order("created_at", { ascending: false }).limit(200);
  return must(res, "deals") as DealWithOpportunity[];
}

export async function getMessages(): Promise<MessageWithContact[] | null> {
  const db = getServiceClient();
  if (!db) return null;
  const res = await db.from("messages").select("*, contact:contacts(name)").order("created_at", { ascending: false }).limit(300);
  return must(res, "messages") as MessageWithContact[];
}

export async function getListings(): Promise<{ listings: ListingWithContact[]; markets: MarketRow[] } | null> {
  const db = getServiceClient();
  if (!db) return null;
  const [listings, markets] = await Promise.all([
    db.from("listings").select("*, contact:contacts(name,email)").order("created_at", { ascending: false }).limit(200),
    db.from("markets").select("*").order("id"),
  ]);
  return { listings: must(listings, "listings") as ListingWithContact[], markets: must(markets, "markets") };
}

export const HISTORY_RANGES = {
  "1h": { label: "1 Stunde", ms: 3_600_000, bucketSeconds: 60 },
  "6h": { label: "6 Stunden", ms: 6 * 3_600_000, bucketSeconds: 300 },
  "24h": { label: "24 Stunden", ms: 24 * 3_600_000, bucketSeconds: 900 },
  "7d": { label: "7 Tage", ms: 7 * 86_400_000, bucketSeconds: 3_600 },
} as const;
export type HistoryRange = keyof typeof HISTORY_RANGES;

export interface History {
  fetchedAt: number;
  since: string;
  range: HistoryRange;
  bucketSeconds: number;
  thresholdBps: number;
  stats: SpreadRouteStats[];
  series: SpreadSeriesPoint[];
  markets: MarketRow[];
}

/** Kennzahlen und Zeitreihe der Spread-Historie über die Postgres-Funktionen aus Migration 0002. */
export async function getHistory(range: HistoryRange, thresholdBps: number): Promise<History | null> {
  const db = getServiceClient();
  if (!db) return null;
  const fetchedAt = Date.now();
  const preset = HISTORY_RANGES[range];
  const since = new Date(fetchedAt - preset.ms).toISOString();
  const [stats, series, markets] = await Promise.all([
    db.rpc("spread_route_stats", { since, threshold_bps: thresholdBps }),
    db.rpc("spread_route_series", { since, bucket_seconds: preset.bucketSeconds }),
    db.from("markets").select("*").order("id"),
  ]);
  return {
    fetchedAt, since, range, bucketSeconds: preset.bucketSeconds, thresholdBps,
    stats: must(stats, "spread_route_stats") as SpreadRouteStats[],
    series: must(series, "spread_route_series") as SpreadSeriesPoint[],
    markets: must(markets, "markets"),
  };
}

/** Lesbarer Name einer Route, z. B. "BTC/EUR: kraken → bitvavo" oder "EUR→BTC→ETH→EUR auf kraken". */
export function routeLabel(r: { kind: string; symbol: string; buy_market_id: string; sell_market_id: string }, markets: MarketRow[] = []): string {
  const name = (id: string) => markets.find((m) => m.id === id)?.name ?? id;
  return r.kind === "triangle" ? `${r.symbol} auf ${name(r.buy_market_id)}` : `${r.symbol}: ${name(r.buy_market_id)} → ${name(r.sell_market_id)}`;
}

export function routeKey(r: { symbol: string; buy_market_id: string; sell_market_id: string }): string {
  return `${r.symbol}|${r.buy_market_id}|${r.sell_market_id}`;
}
