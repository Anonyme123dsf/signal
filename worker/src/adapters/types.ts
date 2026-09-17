import type { MarketRow, PriceRow } from "../../../shared/types.ts";

/** Ein Preis, wie ihn ein Adapter liefert. Bei Inseraten ist contact_id gesetzt. */
export type Quote = PriceRow & { contact_id?: string | null };

/**
 * Gemeinsame Schnittstelle für alle Märkte. Neue Branchen kommen als weiterer
 * Adapter dazu, ohne dass Engine, Store oder Dashboard angefasst werden müssen.
 */
export interface MarketAdapter {
  readonly id: string;
  /** Märkte (mit Gebühren), die dieser Adapter bedient. */
  markets(): MarketRow[];
  init(): Promise<void>;
  fetchQuotes(symbols: string[]): Promise<Quote[]>;
  close(): Promise<void>;
}
