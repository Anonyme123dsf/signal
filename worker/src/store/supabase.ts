import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ContactRow, DealRow, DealStatus, ListingRow, MarketRow, MessageRow, MessageStatus,
  OpportunityRow, OpportunityStatus, PriceRow, SpreadSampleRow, WorkerHeartbeatRow,
} from "../../../shared/types.ts";
import type { Candidate } from "../engine/spread.ts";
import type { NewDeal, NewMessage, OpportunityUpsertResult, Store } from "./types.ts";

function fail(ctx: string, error: { message: string } | null): never {
  throw new Error(`${ctx}: ${error?.message ?? "unbekannter Fehler"}`);
}

/** Persistenz über Supabase (PostgREST) mit dem Service-Role-Key. */
export class SupabaseStore implements Store {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    if (!url || !serviceRoleKey) {
      throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (oder STORE=memory verwenden)");
    }
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async init(): Promise<void> {
    const { error } = await this.db.from("markets").select("id").limit(1);
    if (error) fail("Verbindung zu Supabase fehlgeschlagen (Migration ausgeführt?)", error);
  }

  async syncMarkets(defaults: MarketRow[]): Promise<Map<string, MarketRow>> {
    const { data, error } = await this.db.from("markets").select("*");
    if (error) fail("markets lesen", error);
    const map = new Map<string, MarketRow>((data as MarketRow[]).map((m) => [m.id, m]));
    const missing = defaults.filter((m) => !map.has(m.id));
    if (missing.length) {
      const { error: insErr } = await this.db.from("markets").insert(missing);
      if (insErr) fail("markets anlegen", insErr);
      for (const m of missing) map.set(m.id, m);
    }
    return map;
  }

  async savePrices(prices: PriceRow[], recordTicks: boolean): Promise<void> {
    if (!prices.length) return;
    const { error } = await this.db.from("latest_prices").upsert(prices, { onConflict: "market_id,symbol" });
    if (error) fail("latest_prices schreiben", error);
    if (recordTicks) {
      const ticks = prices.map((p) => ({ market_id: p.market_id, symbol: p.symbol, bid: p.bid, ask: p.ask, ts: p.ts }));
      const { error: tErr } = await this.db.from("price_ticks").insert(ticks);
      if (tErr) fail("price_ticks schreiben", tErr);
    }
  }

  async getLatestPrices(): Promise<PriceRow[]> {
    const { data, error } = await this.db.from("latest_prices").select("*");
    if (error) fail("latest_prices lesen", error);
    return data as PriceRow[];
  }

  async listActiveListings(): Promise<ListingRow[]> {
    const { data, error } = await this.db.from("listings").select("*").eq("status", "active");
    if (error) fail("listings lesen", error);
    return data as ListingRow[];
  }

  async getContact(id: string): Promise<ContactRow | null> {
    const { data, error } = await this.db.from("contacts").select("*").eq("id", id).maybeSingle();
    if (error) fail("contact lesen", error);
    return (data as ContactRow | null) ?? null;
  }

  async getListing(id: string): Promise<ListingRow | null> {
    const { data, error } = await this.db.from("listings").select("*").eq("id", id).maybeSingle();
    if (error) fail("listing lesen", error);
    return (data as ListingRow | null) ?? null;
  }

  async upsertOpportunity(c: Candidate, now: Date): Promise<OpportunityUpsertResult> {
    const ts = now.toISOString();
    let q = this.db.from("opportunities").select("*").eq("status", "open")
      .eq("symbol", c.symbol).eq("buy_market_id", c.buy_market_id).eq("sell_market_id", c.sell_market_id);
    q = c.buy_listing_id ? q.eq("buy_listing_id", c.buy_listing_id) : q.is("buy_listing_id", null);
    q = c.sell_listing_id ? q.eq("sell_listing_id", c.sell_listing_id) : q.is("sell_listing_id", null);
    const { data: existing, error } = await q.maybeSingle();
    if (error) fail("opportunity suchen", error);

    const values = {
      buy_price: c.buy_price, sell_price: c.sell_price, trade_size: c.trade_size,
      gross_spread_bps: c.gross_spread_bps, fees_bps: c.fees_bps, net_spread_bps: c.net_spread_bps,
      est_profit_quote: c.est_profit_quote, last_seen: ts, legs: c.legs,
    };
    if (existing) {
      const row = existing as OpportunityRow;
      const patch = { ...values, max_net_spread_bps: Math.max(Number(row.max_net_spread_bps), c.net_spread_bps) };
      const { error: upErr } = await this.db.from("opportunities").update(patch).eq("id", row.id);
      if (upErr) fail("opportunity aktualisieren", upErr);
      return { row: { ...row, ...patch }, created: false };
    }
    const insert = {
      ...values, kind: c.kind, symbol: c.symbol, buy_market_id: c.buy_market_id, sell_market_id: c.sell_market_id,
      status: "open", first_seen: ts, max_net_spread_bps: c.net_spread_bps,
      buy_listing_id: c.buy_listing_id, sell_listing_id: c.sell_listing_id,
    };
    const { data, error: insErr } = await this.db.from("opportunities").insert(insert).select("*").single();
    if (insErr) fail("opportunity anlegen", insErr);
    return { row: data as OpportunityRow, created: true };
  }

  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const { data, error } = await this.db.from("opportunities").select("*").eq("id", id).maybeSingle();
    if (error) fail("opportunity lesen", error);
    return (data as OpportunityRow | null) ?? null;
  }

  async setOpportunityStatus(id: string, status: OpportunityStatus): Promise<void> {
    const { error } = await this.db.from("opportunities").update({ status }).eq("id", id);
    if (error) fail("opportunity status setzen", error);
  }

  async expireOpportunities(before: Date): Promise<number> {
    const { data, error } = await this.db.from("opportunities").update({ status: "expired" })
      .eq("status", "open").lt("last_seen", before.toISOString()).select("id");
    if (error) fail("opportunities ablaufen lassen", error);
    return data?.length ?? 0;
  }

  async createDeal(d: NewDeal): Promise<DealRow> {
    const { data, error } = await this.db.from("deals").insert(d).select("*").single();
    if (error) fail("deal anlegen", error);
    return data as DealRow;
  }

  async listDeals(status: DealStatus): Promise<DealRow[]> {
    const { data, error } = await this.db.from("deals").select("*").eq("status", status).order("created_at");
    if (error) fail("deals lesen", error);
    return data as DealRow[];
  }

  async updateDeal(id: string, patch: Partial<DealRow>): Promise<void> {
    const { error } = await this.db.from("deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) fail("deal aktualisieren", error);
  }

  async createMessage(m: NewMessage): Promise<MessageRow> {
    const { data, error } = await this.db.from("messages").insert(m).select("*").single();
    if (error) fail("message anlegen", error);
    return data as MessageRow;
  }

  async listMessages(status: MessageStatus): Promise<MessageRow[]> {
    const { data, error } = await this.db.from("messages").select("*").eq("status", status).order("created_at");
    if (error) fail("messages lesen", error);
    return data as MessageRow[];
  }

  async updateMessage(id: string, patch: Partial<MessageRow>): Promise<void> {
    const { error } = await this.db.from("messages").update(patch).eq("id", id);
    if (error) fail("message aktualisieren", error);
  }

  async hasOutboundMessageForListing(listingId: string): Promise<boolean> {
    const { count, error } = await this.db.from("messages").select("id", { count: "exact", head: true })
      .eq("direction", "outbound").eq("listing_id", listingId).neq("status", "discarded");
    if (error) fail("messages zählen", error);
    return (count ?? 0) > 0;
  }

  async findOutboundByThreadTag(tag: string): Promise<MessageRow | null> {
    const { data, error } = await this.db.from("messages").select("*")
      .eq("direction", "outbound").eq("thread_tag", tag).limit(1).maybeSingle();
    if (error) fail("message per thread_tag suchen", error);
    return (data as MessageRow | null) ?? null;
  }

  async heartbeat(row: WorkerHeartbeatRow): Promise<void> {
    const { error } = await this.db.from("worker_heartbeats").upsert(row, { onConflict: "worker_id" });
    if (error) fail("heartbeat schreiben", error);
  }

  async saveSpreadSamples(rows: SpreadSampleRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db.from("spread_samples").insert(rows);
    if (error) fail("spread_samples schreiben", error);
  }

  async deleteSpreadSamplesBefore(before: Date): Promise<number> {
    const { data, error } = await this.db.from("spread_samples").delete().lt("ts", before.toISOString()).select("id");
    if (error) fail("spread_samples aufräumen", error);
    return data?.length ?? 0;
  }
}
