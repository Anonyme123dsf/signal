import type { Leg, MarketRow } from "../../../shared/types.ts";
import type { Quote } from "../adapters/types.ts";
import { baseAsset, quoteAsset, type Candidate, type EngineParams } from "./spread.ts";

/**
 * Dreiecks-Arbitrage innerhalb einer Börse: Startwährung S wird über zwei
 * Zwischenwährungen A und B wieder in S getauscht, z. B. EUR→BTC→ETH→EUR.
 * Es gibt keinen Transfer zwischen Börsen, dafür drei Taker-Gebühren.
 */
export interface Triangle {
  /** [S, A, B, S] */
  path: [string, string, string, string];
  /** Für jeden Schritt das Handelspaar, das auf der Börse existiert. */
  symbols: [string, string, string];
}

export function trianglePath(t: Triangle): string {
  return t.path.join("→");
}

/**
 * Welche Kreuz-Paare braucht man, damit die konfigurierten Symbole Dreiecke
 * bilden können? Für BTC/EUR und ETH/EUR sind das ETH/BTC und BTC/ETH; der
 * Adapter behält nur die, die es auf der Börse gibt.
 */
export function crossSymbolsFor(symbols: string[]): string[] {
  const byQuote = new Map<string, string[]>();
  for (const s of symbols) {
    const q = quoteAsset(s);
    if (!q) continue;
    const arr = byQuote.get(q) ?? [];
    if (!arr.includes(baseAsset(s))) arr.push(baseAsset(s));
    byQuote.set(q, arr);
  }
  const out = new Set<string>();
  for (const bases of byQuote.values()) {
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        out.add(`${bases[i]}/${bases[j]}`);
        out.add(`${bases[j]}/${bases[i]}`);
      }
    }
  }
  return [...out].filter((s) => !symbols.includes(s));
}

/**
 * Findet alle Dreiecke mit Start S aus den Symbolen, für die es Quotes gibt.
 * Für jedes Paar von Nachbarn A, B von S mit einem Markt A–B entstehen beide
 * Richtungen S→A→B→S und S→B→A→S.
 */
export function findTriangles(symbols: string[], start: string): Triangle[] {
  const edge = new Map<string, string>(); // "A|B" (sortiert) -> Symbol
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const s of symbols) {
    const b = baseAsset(s);
    const q = quoteAsset(s);
    if (!b || !q || b === q) continue;
    if (!edge.has(key(b, q))) edge.set(key(b, q), s);
  }
  const neighbours = new Set<string>();
  for (const s of symbols) {
    const b = baseAsset(s);
    const q = quoteAsset(s);
    if (b === start) neighbours.add(q);
    if (q === start) neighbours.add(b);
  }
  const n = [...neighbours].sort();
  const out: Triangle[] = [];
  for (let i = 0; i < n.length; i++) {
    for (let j = i + 1; j < n.length; j++) {
      const a = n[i];
      const b = n[j];
      const ab = edge.get(key(a, b));
      if (!ab) continue;
      const sa = edge.get(key(start, a))!;
      const sb = edge.get(key(start, b))!;
      out.push({ path: [start, a, b, start], symbols: [sa, ab, sb] });
      out.push({ path: [start, b, a, start], symbols: [sb, ab, sa] });
    }
  }
  return out;
}

interface Conversion {
  leg: Leg;
  /** Roh-Multiplikator ohne Gebühren und Slippage. */
  grossRate: number;
  /** Multiplikator inklusive Gebühren und Slippage. */
  netRate: number;
  /** Maximale Eingangsmenge, die die Orderbuchtiefe hergibt (Infinity, wenn unbekannt). */
  maxIn: number;
}

/** Tauscht `amountIn` von `from` nach `to` über das Handelspaar `q`. */
function convert(amountIn: number, from: string, to: string, q: Quote, market: MarketRow, slipBps: number): Conversion | null {
  const fee = market.taker_fee_bps / 1e4;
  const slip = slipBps / 1e4;
  const base = baseAsset(q.symbol);
  const quote = quoteAsset(q.symbol);
  if (from === quote && to === base) {
    // Kaufen: Quote rein, Basis raus, zum Ask.
    if (q.ask == null || q.ask <= 0) return null;
    const price = q.ask * (1 + slip);
    const out = (amountIn / price) * (1 - fee);
    const maxIn = q.ask_size != null && q.ask_size > 0 ? q.ask_size * q.ask : Infinity;
    return {
      leg: { market_id: q.market_id, symbol: q.symbol, side: "buy", price, from_asset: from, to_asset: to, amount_in: amountIn, amount_out: out },
      grossRate: 1 / q.ask, netRate: out / amountIn, maxIn,
    };
  }
  if (from === base && to === quote) {
    // Verkaufen: Basis rein, Quote raus, zum Bid.
    if (q.bid == null || q.bid <= 0) return null;
    const price = q.bid * (1 - slip);
    const out = amountIn * price * (1 - fee);
    const maxIn = q.bid_size != null && q.bid_size > 0 ? q.bid_size : Infinity;
    return {
      leg: { market_id: q.market_id, symbol: q.symbol, side: "sell", price, from_asset: from, to_asset: to, amount_in: amountIn, amount_out: out },
      grossRate: q.bid, netRate: out / amountIn, maxIn,
    };
  }
  return null;
}

function runPath(t: Triangle, quotes: Map<string, Quote>, market: MarketRow, startAmount: number, slipBps: number): Conversion[] | null {
  const out: Conversion[] = [];
  let amount = startAmount;
  for (let i = 0; i < 3; i++) {
    const q = quotes.get(t.symbols[i]);
    if (!q) return null;
    const c = convert(amount, t.path[i], t.path[i + 1], q, market, slipBps);
    if (!c) return null;
    out.push(c);
    amount = c.leg.amount_out;
  }
  return out;
}

/**
 * Bewertet ein Dreieck auf einer Börse. Startbetrag ist `tradeSizeQuote` in der
 * Startwährung, begrenzt durch die Orderbuchtiefe jedes Schritts. Ergebnis im
 * selben Format wie Cross-Gelegenheiten: buy_price 1, sell_price = Brutto-Multiplikator.
 */
export function evaluateTriangle(
  t: Triangle,
  quotesBySymbol: Map<string, Quote>,
  market: MarketRow,
  p: EngineParams,
): Candidate | null {
  const probe = runPath(t, quotesBySymbol, market, p.tradeSizeQuote, p.slippageBps);
  if (!probe) return null;

  // Tiefe: Wie viel Startbetrag verträgt jeder Schritt? Rückrechnung über die Netto-Raten davor.
  let start = p.tradeSizeQuote;
  let cumulative = 1;
  for (const c of probe) {
    if (Number.isFinite(c.maxIn)) start = Math.min(start, c.maxIn / cumulative);
    cumulative *= c.netRate;
  }
  if (!(start > 0)) return null;

  const legsRun = start === p.tradeSizeQuote ? probe : runPath(t, quotesBySymbol, market, start, p.slippageBps);
  if (!legsRun) return null;

  const grossMult = legsRun.reduce((m, c) => m * c.grossRate, 1);
  const end = legsRun[2].leg.amount_out;
  const netMult = end / start;
  const gross = (grossMult - 1) * 1e4;
  const net = (netMult - 1) * 1e4;

  return {
    kind: "triangle",
    symbol: trianglePath(t),
    buy_market_id: market.id,
    sell_market_id: market.id,
    buy_price: 1,
    sell_price: round(grossMult, 8),
    trade_size: round(start, 8),
    gross_spread_bps: round(gross, 2),
    fees_bps: round(gross - net, 2),
    net_spread_bps: round(net, 2),
    est_profit_quote: round(end - start, 2),
    buy_listing_id: null,
    sell_listing_id: null,
    buy_contact_id: null,
    sell_contact_id: null,
    legs: legsRun.map((c) => ({
      ...c.leg,
      price: round(c.leg.price, 10),
      amount_in: round(c.leg.amount_in, 10),
      amount_out: round(c.leg.amount_out, 10),
    })),
  };
}

/** Bewertet alle Dreiecke auf allen Börsen (nur Börsenquotes, keine Inserate). */
export function evaluateAllTriangles(
  quotes: Quote[],
  markets: Map<string, MarketRow>,
  start: string,
  p: EngineParams,
): Candidate[] {
  const byMarket = new Map<string, Map<string, Quote>>();
  for (const q of quotes) {
    if (q.listing_id) continue;
    const m = markets.get(q.market_id);
    if (!m || !m.enabled || m.kind === "listings") continue;
    const inner = byMarket.get(q.market_id) ?? new Map<string, Quote>();
    inner.set(q.symbol, q);
    byMarket.set(q.market_id, inner);
  }
  const out: Candidate[] = [];
  for (const [marketId, bySymbol] of byMarket) {
    const market = markets.get(marketId)!;
    for (const t of findTriangles([...bySymbol.keys()], start)) {
      const c = evaluateTriangle(t, bySymbol, market, p);
      if (c) out.push(c);
    }
  }
  return out.sort((a, b) => b.net_spread_bps - a.net_spread_bps);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
