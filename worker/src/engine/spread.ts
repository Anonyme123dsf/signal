import type { MarketRow } from "../../../shared/types.ts";
import type { Quote } from "../adapters/types.ts";

export interface EngineParams {
  /** Handelsgröße pro Deal in Quote-Währung (z. B. 500 EUR). */
  tradeSizeQuote: number;
  /** Sicherheitsaufschlag pro Seite in Basispunkten. */
  slippageBps: number;
  transferModel: "prefunded" | "withdraw";
  minNetSpreadBps: number;
}

export interface Candidate {
  symbol: string;
  buy_market_id: string;
  sell_market_id: string;
  buy_price: number;
  sell_price: number;
  trade_size: number;
  gross_spread_bps: number;
  fees_bps: number;
  net_spread_bps: number;
  est_profit_quote: number;
  buy_listing_id: string | null;
  sell_listing_id: string | null;
  /** Ansprechpartner, falls die Kauf- bzw. Verkaufsseite ein Inserat ist. */
  buy_contact_id: string | null;
  sell_contact_id: string | null;
}

export function baseAsset(symbol: string): string {
  return symbol.split("/")[0] ?? symbol;
}

/**
 * Bewertet ein Paar: Kauf zum Ask bei `buy`, Verkauf zum Bid bei `sell`.
 * Rechnet Taker-Gebühren beider Seiten, Slippage-Aufschlag und optional die
 * Abhebegebühr ein. Gibt null zurück, wenn das Paar nicht handelbar ist oder
 * der Netto-Spread unter der Schwelle liegt.
 */
export function evaluatePair(
  buy: Quote,
  sell: Quote,
  buyMarket: MarketRow,
  sellMarket: MarketRow,
  p: EngineParams,
): Candidate | null {
  if (buy.ask == null || sell.bid == null || buy.ask <= 0 || sell.bid <= 0) return null;
  if (sell.bid <= buy.ask) return null;

  let amount = p.tradeSizeQuote / buy.ask;
  if (buy.ask_size != null && buy.ask_size > 0) amount = Math.min(amount, buy.ask_size);
  if (sell.bid_size != null && sell.bid_size > 0) amount = Math.min(amount, sell.bid_size);
  if (!(amount > 0)) return null;

  const slip = p.slippageBps / 1e4;
  const buyPx = buy.ask * (1 + slip);
  const sellPx = sell.bid * (1 - slip);
  const buyCost = amount * buyPx;
  const buyFee = buyCost * (buyMarket.taker_fee_bps / 1e4);
  const sellProceeds = amount * sellPx;
  const sellFee = sellProceeds * (sellMarket.taker_fee_bps / 1e4);

  let transferCost = 0;
  if (p.transferModel === "withdraw") {
    const feeBase = buyMarket.withdrawal_fees[baseAsset(buy.symbol)] ?? 0;
    transferCost = feeBase * buy.ask;
  }

  const profit = sellProceeds - sellFee - buyCost - buyFee - transferCost;
  const gross = ((sell.bid - buy.ask) / buy.ask) * 1e4;
  const net = (profit / buyCost) * 1e4;
  if (net < p.minNetSpreadBps) return null;

  return {
    symbol: buy.symbol,
    buy_market_id: buy.market_id,
    sell_market_id: sell.market_id,
    buy_price: buy.ask,
    sell_price: sell.bid,
    trade_size: round(amount, 8),
    gross_spread_bps: round(gross, 2),
    fees_bps: round(gross - net, 2),
    net_spread_bps: round(net, 2),
    est_profit_quote: round(profit, 2),
    buy_listing_id: buy.listing_id ?? null,
    sell_listing_id: sell.listing_id ?? null,
    buy_contact_id: buy.contact_id ?? null,
    sell_contact_id: sell.contact_id ?? null,
  };
}

/** Zwei Quotes bilden ein Paar, wenn sie von verschiedenen Märkten oder verschiedenen Inseraten stammen. */
function isPair(a: Quote, b: Quote): boolean {
  if (a === b) return false;
  if (a.market_id !== b.market_id) return true;
  return Boolean(a.listing_id && b.listing_id && a.listing_id !== b.listing_id);
}

export function findOpportunities(
  quotes: Quote[],
  markets: Map<string, MarketRow>,
  p: EngineParams,
): Candidate[] {
  const bySymbol = new Map<string, Quote[]>();
  for (const q of quotes) {
    const m = markets.get(q.market_id);
    if (!m || !m.enabled) continue;
    const arr = bySymbol.get(q.symbol) ?? [];
    arr.push(q);
    bySymbol.set(q.symbol, arr);
  }

  const out: Candidate[] = [];
  for (const list of bySymbol.values()) {
    for (const buy of list) {
      for (const sell of list) {
        if (!isPair(buy, sell)) continue;
        const c = evaluatePair(buy, sell, markets.get(buy.market_id)!, markets.get(sell.market_id)!, p);
        if (c) out.push(c);
      }
    }
  }
  return out.sort((a, b) => b.net_spread_bps - a.net_spread_bps);
}

export function candidateKey(c: Pick<Candidate, "symbol" | "buy_market_id" | "sell_market_id" | "buy_listing_id" | "sell_listing_id">): string {
  return [c.symbol, c.buy_market_id, c.sell_market_id, c.buy_listing_id ?? "", c.sell_listing_id ?? ""].join("|");
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
