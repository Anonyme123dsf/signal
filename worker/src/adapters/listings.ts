import type { MarketRow } from "../../../shared/types.ts";
import { LISTINGS_MARKET } from "../markets.ts";
import type { Store } from "../store/types.ts";
import type { MarketAdapter, Quote } from "./types.ts";

/**
 * Macht manuell erfasste Inserate (Tabelle listings) für die Engine sichtbar:
 * ein Verkaufsinserat wird zum Ask, ein Kaufgesuch zum Bid. Jedes Inserat ist
 * ein eigener Quote mit listing_id und contact_id, damit die Engine Käufer und
 * Verkäufer direkt zusammenführen und das Kommunikationsmodul Entwürfe anlegen kann.
 */
export class ListingsAdapter implements MarketAdapter {
  readonly id = "listings";

  constructor(private readonly store: Store) {}

  markets(): MarketRow[] {
    return [LISTINGS_MARKET];
  }

  async init(): Promise<void> {}

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const listings = await this.store.listActiveListings();
    const ts = new Date().toISOString();
    return listings
      .filter((l) => symbols.length === 0 || symbols.includes(l.symbol))
      .map((l) => ({
        market_id: LISTINGS_MARKET.id,
        symbol: l.symbol,
        bid: l.side === "buy" ? l.price : null,
        ask: l.side === "sell" ? l.price : null,
        bid_size: l.side === "buy" ? l.quantity : null,
        ask_size: l.side === "sell" ? l.quantity : null,
        last: null,
        ts,
        listing_id: l.id,
        contact_id: l.contact_id,
      }));
  }

  async close(): Promise<void> {}
}
