/**
 * Gemeinsame Typen für Dashboard (Next.js) und Worker.
 * Die Felder entsprechen 1:1 den Spalten in supabase/migrations/0001_arbitrage.sql,
 * damit weder Worker noch Dashboard Mapping-Code brauchen.
 */

export type MarketKind = "crypto_exchange" | "broker" | "listings" | "commodity" | "mock";

export interface MarketRow {
  id: string; // z. B. "kraken"
  kind: MarketKind;
  name: string;
  /** Taker-Gebühr in Basispunkten (26 = 0,26 %). */
  taker_fee_bps: number;
  /** Feste Abhebegebühr pro Basiswährung, z. B. { "BTC": 0.0002 }. */
  withdrawal_fees: Record<string, number>;
  enabled: boolean;
}

/** Aktueller Preis pro Markt und Symbol (Tabelle latest_prices). */
export interface PriceRow {
  market_id: string;
  symbol: string; // "BTC/EUR"
  bid: number | null;
  ask: number | null;
  bid_size: number | null;
  ask_size: number | null;
  last: number | null;
  ts: string; // ISO-Zeitstempel
  /** Nur bei Listings gesetzt: Welches Inserat steckt hinter dem Preis. */
  listing_id: string | null;
}

export type OpportunityStatus = "open" | "expired" | "dismissed" | "executed";

export interface OpportunityRow {
  id: string;
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  buy_price: number;
  sell_price: number;
  /** Handelsmenge in Basiswährung (z. B. 0.01 BTC). */
  trade_size: number;
  gross_spread_bps: number;
  fees_bps: number;
  net_spread_bps: number;
  /** Erwarteter Gewinn in Quote-Währung (z. B. EUR) nach Gebühren. */
  est_profit_quote: number;
  status: OpportunityStatus;
  first_seen: string;
  last_seen: string;
  /** Höchster beobachteter Netto-Spread während der Lebensdauer. */
  max_net_spread_bps: number;
  buy_listing_id: string | null;
  sell_listing_id: string | null;
}

export type DealMode = "paper" | "live";
export type DealStatus =
  | "pending_approval"
  | "approved"
  | "executing"
  | "filled"
  | "failed"
  | "rejected";

export interface OrderFill {
  market_id: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  fee_quote: number;
  ts: string;
}

export interface DealRow {
  id: string;
  opportunity_id: string;
  mode: DealMode;
  status: DealStatus;
  buy_order: OrderFill | null;
  sell_order: OrderFill | null;
  realized_pnl_quote: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  market_id: string | null;
  external_ref: string | null;
  created_at: string;
}

export type ListingSide = "sell" | "buy";

export interface ListingRow {
  id: string;
  market_id: string;
  symbol: string;
  /** "sell": jemand bietet an (Ask). "buy": jemand sucht (Bid). */
  side: ListingSide;
  price: number;
  quantity: number;
  contact_id: string | null;
  external_url: string | null;
  status: "active" | "closed";
  created_at: string;
}

export type MessageDirection = "outbound" | "inbound";
export type MessageStatus = "draft" | "approved" | "sent" | "failed" | "received" | "discarded";

export interface MessageRow {
  id: string;
  deal_id: string | null;
  opportunity_id: string | null;
  contact_id: string | null;
  /** Inserat, auf das sich die Nachricht bezieht. Pro Inserat wird ein Kontakt nur einmal angeschrieben. */
  listing_id: string | null;
  direction: MessageDirection;
  status: MessageStatus;
  subject: string;
  body: string;
  to_email: string;
  from_email: string;
  provider_message_id: string | null;
  /** Kennung im Betreff, über die Antworten zugeordnet werden, z. B. "SIG-4F2A9C". */
  thread_tag: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface WorkerHeartbeatRow {
  worker_id: string;
  last_seen: string;
  status: Record<string, unknown>;
}
