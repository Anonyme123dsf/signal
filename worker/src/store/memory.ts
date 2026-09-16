import { randomUUID } from "node:crypto";
import type {
  ContactRow, DealRow, DealStatus, ListingRow, MarketRow, MessageRow, MessageStatus,
  OpportunityRow, OpportunityStatus, PriceRow, WorkerHeartbeatRow,
} from "../../../shared/types.ts";
import { candidateKey, type Candidate } from "../engine/spread.ts";
import type { NewDeal, NewMessage, OpportunityUpsertResult, Store } from "./types.ts";

/** Speichert alles im Prozess. Für Tests und `npm run demo`. */
export class MemoryStore implements Store {
  markets = new Map<string, MarketRow>();
  prices = new Map<string, PriceRow>();
  ticks: PriceRow[] = [];
  listings = new Map<string, ListingRow>();
  contacts = new Map<string, ContactRow>();
  opportunities = new Map<string, OpportunityRow>();
  deals = new Map<string, DealRow>();
  messages = new Map<string, MessageRow>();
  heartbeats = new Map<string, WorkerHeartbeatRow>();

  async init(): Promise<void> {}

  async syncMarkets(defaults: MarketRow[]): Promise<Map<string, MarketRow>> {
    for (const m of defaults) if (!this.markets.has(m.id)) this.markets.set(m.id, { ...m });
    return new Map(this.markets);
  }

  async savePrices(prices: PriceRow[], recordTicks: boolean): Promise<void> {
    for (const p of prices) this.prices.set(`${p.market_id}|${p.symbol}`, p);
    if (recordTicks) this.ticks.push(...prices);
  }

  async getLatestPrices(): Promise<PriceRow[]> {
    return [...this.prices.values()];
  }

  async listActiveListings(): Promise<ListingRow[]> {
    return [...this.listings.values()].filter((l) => l.status === "active");
  }

  async getContact(id: string): Promise<ContactRow | null> {
    return this.contacts.get(id) ?? null;
  }

  async getListing(id: string): Promise<ListingRow | null> {
    return this.listings.get(id) ?? null;
  }

  async upsertOpportunity(c: Candidate, now: Date): Promise<OpportunityUpsertResult> {
    const key = candidateKey(c);
    const ts = now.toISOString();
    for (const row of this.opportunities.values()) {
      if (row.status === "open" && candidateKey(row) === key) {
        Object.assign(row, {
          buy_price: c.buy_price, sell_price: c.sell_price, trade_size: c.trade_size,
          gross_spread_bps: c.gross_spread_bps, fees_bps: c.fees_bps, net_spread_bps: c.net_spread_bps,
          est_profit_quote: c.est_profit_quote, last_seen: ts,
          max_net_spread_bps: Math.max(row.max_net_spread_bps, c.net_spread_bps),
        });
        return { row, created: false };
      }
    }
    const row: OpportunityRow = {
      id: randomUUID(), symbol: c.symbol, buy_market_id: c.buy_market_id, sell_market_id: c.sell_market_id,
      buy_price: c.buy_price, sell_price: c.sell_price, trade_size: c.trade_size,
      gross_spread_bps: c.gross_spread_bps, fees_bps: c.fees_bps, net_spread_bps: c.net_spread_bps,
      est_profit_quote: c.est_profit_quote, status: "open", first_seen: ts, last_seen: ts,
      max_net_spread_bps: c.net_spread_bps, buy_listing_id: c.buy_listing_id, sell_listing_id: c.sell_listing_id,
    };
    this.opportunities.set(row.id, row);
    return { row, created: true };
  }

  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    return this.opportunities.get(id) ?? null;
  }

  async setOpportunityStatus(id: string, status: OpportunityStatus): Promise<void> {
    const row = this.opportunities.get(id);
    if (row) row.status = status;
  }

  async expireOpportunities(before: Date): Promise<number> {
    let n = 0;
    for (const row of this.opportunities.values()) {
      if (row.status === "open" && new Date(row.last_seen) < before) {
        row.status = "expired";
        n++;
      }
    }
    return n;
  }

  async createDeal(d: NewDeal): Promise<DealRow> {
    const ts = new Date().toISOString();
    const row: DealRow = {
      id: randomUUID(), ...d, buy_order: null, sell_order: null, realized_pnl_quote: null, error: null,
      created_at: ts, updated_at: ts,
    };
    this.deals.set(row.id, row);
    return row;
  }

  async listDeals(status: DealStatus): Promise<DealRow[]> {
    return [...this.deals.values()].filter((d) => d.status === status);
  }

  async updateDeal(id: string, patch: Partial<DealRow>): Promise<void> {
    const row = this.deals.get(id);
    if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() });
  }

  async createMessage(m: NewMessage): Promise<MessageRow> {
    const row: MessageRow = { id: randomUUID(), created_at: new Date().toISOString(), ...m };
    this.messages.set(row.id, row);
    return row;
  }

  async listMessages(status: MessageStatus): Promise<MessageRow[]> {
    return [...this.messages.values()].filter((m) => m.status === status);
  }

  async updateMessage(id: string, patch: Partial<MessageRow>): Promise<void> {
    const row = this.messages.get(id);
    if (row) Object.assign(row, patch);
  }

  async hasOutboundMessageForListing(listingId: string): Promise<boolean> {
    for (const m of this.messages.values()) {
      if (m.direction === "outbound" && m.listing_id === listingId && m.status !== "discarded") return true;
    }
    return false;
  }

  async findOutboundByThreadTag(tag: string): Promise<MessageRow | null> {
    for (const m of this.messages.values()) if (m.direction === "outbound" && m.thread_tag === tag) return m;
    return null;
  }

  async heartbeat(row: WorkerHeartbeatRow): Promise<void> {
    this.heartbeats.set(row.worker_id, row);
  }

  /** Testhilfe: Inserat samt Kontakt anlegen. */
  addListing(input: Omit<ListingRow, "id" | "created_at" | "status" | "contact_id">, contact?: Omit<ContactRow, "id" | "created_at">): ListingRow {
    let contact_id: string | null = null;
    if (contact) {
      const c: ContactRow = { id: randomUUID(), created_at: new Date().toISOString(), ...contact };
      this.contacts.set(c.id, c);
      contact_id = c.id;
    }
    const row: ListingRow = { id: randomUUID(), created_at: new Date().toISOString(), status: "active", contact_id, ...input };
    this.listings.set(row.id, row);
    return row;
  }
}
