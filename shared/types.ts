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

/** cross: Kauf auf Markt A, Verkauf auf Markt B. triangle: drei Legs auf einer Börse, z. B. EUR→BTC→ETH→EUR. */
export type OpportunityKind = "cross" | "triangle";

/** Ein Schritt einer Gelegenheit: Menge `amount_in` in `from_asset` wird zu `amount_out` in `to_asset`. */
export interface Leg {
  market_id: string;
  symbol: string;
  side: "buy" | "sell";
  /** Ausführungspreis inklusive Slippage-Aufschlag. */
  price: number;
  from_asset: string;
  to_asset: string;
  amount_in: number;
  amount_out: number;
}

export interface OpportunityRow {
  id: string;
  kind: OpportunityKind;
  /** cross: Handelspaar wie "BTC/EUR". triangle: Pfad wie "EUR→BTC→ETH→EUR". */
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  /** cross: Ask am Kaufmarkt. triangle: 1 (eine Einheit Startwährung). */
  buy_price: number;
  /** cross: Bid am Verkaufsmarkt. triangle: Brutto-Multiplikator des Pfads, z. B. 1.0032. */
  sell_price: number;
  /** cross: Handelsmenge in Basiswährung (z. B. 0.01 BTC). triangle: Startbetrag in der Startwährung (z. B. 500 EUR). */
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
  /** Alle Schritte mit Preisen und Mengen, bei cross zwei, bei triangle drei. */
  legs: Leg[];
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
  /** Menge in Basiswährung des Handelspaars. */
  amount: number;
  /** Gebühr in `fee_asset`, der Quote-Währung des Handelspaars. */
  fee_quote: number;
  fee_asset: string;
  ts: string;
}

export interface DealRow {
  id: string;
  opportunity_id: string;
  mode: DealMode;
  status: DealStatus;
  /** Bei cross-Deals gesetzt; bei triangle-Deals stehen alle Schritte in `fills`. */
  buy_order: OrderFill | null;
  sell_order: OrderFill | null;
  /** Alle Ausführungen in Reihenfolge, für beide Arten befüllt. */
  fills: OrderFill[];
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

/** Ein Messpunkt der Spread-Historie. Enthält auch negative Netto-Spreads, damit die Verteilung sichtbar wird. */
export interface SpreadSampleRow {
  id?: number;
  ts: string;
  kind: OpportunityKind;
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  gross_bps: number;
  fees_bps: number;
  net_bps: number;
  est_profit_quote: number;
  trade_size: number;
}

/** Ergebnis der Postgres-Funktion spread_route_stats. */
export interface SpreadRouteStats {
  kind: OpportunityKind;
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  samples: number;
  avg_net: number;
  max_net: number;
  p50_net: number;
  p90_net: number;
  /** Anteil der Messpunkte mit Netto-Spread über 0 (0..1). */
  share_positive: number;
  /** Anteil der Messpunkte über der übergebenen Schwelle (0..1). */
  share_above: number;
  last_net: number;
  last_ts: string;
}

/** Ergebnis der Postgres-Funktion spread_route_series. */
export interface SpreadSeriesPoint {
  bucket: string;
  kind: OpportunityKind;
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  avg_net: number;
  max_net: number;
}

/** Paper-Bestand je Börse und Asset. Wird nur geführt, wenn PAPER_BALANCES gesetzt ist. */
export interface PaperBalanceRow {
  market_id: string;
  asset: string;
  amount: number;
  /** Startbestand aus der Konfiguration, für die Anzeige der Veränderung. */
  initial_amount: number;
  updated_at: string;
}

/** Veränderung eines Bestands durch eine Ausführung. */
export interface BalanceDelta {
  market_id: string;
  asset: string;
  delta: number;
}

export interface WorkerHeartbeatRow {
  worker_id: string;
  last_seen: string;
  status: Record<string, unknown>;
}
