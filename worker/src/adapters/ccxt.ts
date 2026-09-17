import ccxt, { type Exchange, type Ticker } from "ccxt";
import type { MarketRow } from "../../../shared/types.ts";
import { defaultExchangeMarket } from "../markets.ts";
import { log } from "../log.ts";
import type { MarketAdapter, Quote } from "./types.ts";

/**
 * Bindet eine Börse über CCXT an. Öffentliche Marktdaten brauchen keinen
 * API-Key. Für späteren Echthandel werden Keys aus <ID>_API_KEY / <ID>_SECRET
 * gelesen, z. B. KRAKEN_API_KEY.
 */
export class CcxtAdapter implements MarketAdapter {
  readonly id: string;
  private readonly exchange: Exchange;
  private readonly market: MarketRow;
  private available = new Set<string>();

  constructor(exchangeId: string) {
    const Ctor = (ccxt as unknown as Record<string, new (o: object) => Exchange>)[exchangeId];
    if (typeof Ctor !== "function") throw new Error(`CCXT kennt keine Börse "${exchangeId}"`);
    const envId = exchangeId.toUpperCase();
    this.exchange = new Ctor({
      enableRateLimit: true,
      apiKey: process.env[`${envId}_API_KEY`],
      secret: process.env[`${envId}_SECRET`],
    });
    this.id = exchangeId;
    this.market = defaultExchangeMarket(exchangeId);
  }

  markets(): MarketRow[] {
    return [this.market];
  }

  async init(): Promise<void> {
    const markets = await this.exchange.loadMarkets();
    this.available = new Set(Object.keys(markets));
    log.info(`${this.id}: ${this.available.size} Märkte geladen`);
  }

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const wanted = symbols.filter((s) => this.available.has(s));
    const missing = symbols.filter((s) => !this.available.has(s));
    if (missing.length) log.debug(`${this.id}: nicht handelbar: ${missing.join(", ")}`);
    if (!wanted.length) return [];

    const tickers: Record<string, Ticker> = {};
    if (this.exchange.has["fetchTickers"]) {
      Object.assign(tickers, await this.exchange.fetchTickers(wanted));
    } else {
      for (const s of wanted) tickers[s] = await this.exchange.fetchTicker(s);
    }

    const now = new Date().toISOString();
    return wanted
      .map((s) => tickers[s])
      .filter((t): t is Ticker => Boolean(t))
      .map((t) => ({
        market_id: this.id,
        symbol: t.symbol ?? "",
        bid: t.bid ?? null,
        ask: t.ask ?? null,
        bid_size: t.bidVolume ?? null,
        ask_size: t.askVolume ?? null,
        last: t.last ?? null,
        ts: t.timestamp ? new Date(t.timestamp).toISOString() : now,
        listing_id: null,
      }));
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}
