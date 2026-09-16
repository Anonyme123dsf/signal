import type {
  ContactRow, DealRow, ListingRow, MarketRow, MessageRow, OpportunityRow, PriceRow, WorkerHeartbeatRow,
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
