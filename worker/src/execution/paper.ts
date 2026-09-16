import type { BalanceDelta, DealRow, Leg, MarketRow, OpportunityRow, OrderFill, PaperBalanceRow, PriceRow } from "../../../shared/types.ts";
import { baseAsset, quoteAsset } from "../engine/spread.ts";
import { evaluateTriangle, findTriangles } from "../engine/triangle.ts";
import { log } from "../log.ts";
import type { Store } from "../store/types.ts";

export interface PaperParams {
  slippageBps: number;
  transferModel: "prefunded" | "withdraw";
  /** Kurse, die älter sind, gelten als unbrauchbar; der Deal schlägt dann fehl statt gegen alte Daten zu füllen. */
  maxQuoteAgeMs: number;
  /** true: Bestände aus paper_balances prüfen und umbuchen (PAPER_BALANCES gesetzt). */
  enforceBalances?: boolean;
}

/** Fehlermeldung, wenn ein Kurs zu alt ist, sonst null. */
function staleError(q: PriceRow, maxAgeMs: number, now: number): string | null {
  const age = now - new Date(q.ts).getTime();
  if (!(age > maxAgeMs)) return null;
  return `Kurs ${q.symbol} auf ${q.market_id} ist ${Math.round(age / 1000)} s alt (Grenze ${Math.round(maxAgeMs / 1000)} s)`;
}

export interface SimulatedDeal {
  buy_order: OrderFill | null;
  sell_order: OrderFill | null;
  fills: OrderFill[];
  realized_pnl_quote: number;
  /** Bestandsveränderungen in Ausführungsreihenfolge. */
  deltas: BalanceDelta[];
}

/**
 * Prüft, ob die Bestände für alle Schritte reichen. Die Deltas werden in Reihenfolge
 * durchgespielt, damit ein Schritt vom Ertrag des vorherigen leben kann (Dreieck),
 * ein Verkauf auf der zweiten Börse aber vorfinanzierten Bestand braucht (Cross).
 */
export function checkBalances(balances: PaperBalanceRow[], deltas: BalanceDelta[]): string | null {
  const running = new Map(balances.map((b) => [`${b.market_id}|${b.asset}`, Number(b.amount)]));
  for (const d of deltas) {
    const key = `${d.market_id}|${d.asset}`;
    const next = (running.get(key) ?? 0) + d.delta;
    if (next < -1e-9) {
      return `Bestand reicht nicht: ${d.market_id} ${d.asset} ${fmt(running.get(key) ?? 0)} vorhanden, ${fmt(-d.delta)} nötig`;
    }
    running.set(key, next);
  }
  return null;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 }).format(n);
}

interface CrossLegs {
  buyPrice: number;
  sellPrice: number;
  amount: number;
}

/**
 * Ermittelt die Ausführungspreise einer Cross-Gelegenheit: Inserate haben feste
 * Preise (aus der Gelegenheit), Börsen werden zum aktuellen Stand aus latest_prices
 * gefüllt. So fließt die Verzögerung zwischen Erkennen und Ausführen in den Paper-PnL ein.
 */
function resolveCrossLegs(opp: OpportunityRow, prices: PriceRow[], maxQuoteAgeMs: number, now: number): CrossLegs | { error: string } {
  const live = (marketId: string) => prices.find((p) => p.market_id === marketId && p.symbol === opp.symbol);

  let buyPrice = Number(opp.buy_price);
  let amount = Number(opp.trade_size);
  if (!opp.buy_listing_id) {
    const q = live(opp.buy_market_id);
    if (!q || q.ask == null) return { error: `Kein aktueller Ask für ${opp.symbol} auf ${opp.buy_market_id}` };
    const stale = staleError(q, maxQuoteAgeMs, now);
    if (stale) return { error: stale };
    buyPrice = Number(q.ask);
    if (q.ask_size != null && Number(q.ask_size) > 0) amount = Math.min(amount, Number(q.ask_size));
  }

  let sellPrice = Number(opp.sell_price);
  if (!opp.sell_listing_id) {
    const q = live(opp.sell_market_id);
    if (!q || q.bid == null) return { error: `Kein aktueller Bid für ${opp.symbol} auf ${opp.sell_market_id}` };
    const stale = staleError(q, maxQuoteAgeMs, now);
    if (stale) return { error: stale };
    sellPrice = Number(q.bid);
    if (q.bid_size != null && Number(q.bid_size) > 0) amount = Math.min(amount, Number(q.bid_size));
  }
  return { buyPrice, sellPrice, amount };
}

export function simulateCrossFills(opp: OpportunityRow, legs: CrossLegs, markets: Map<string, MarketRow>, p: PaperParams): SimulatedDeal {
  const slip = p.slippageBps / 1e4;
  const buyMarket = markets.get(opp.buy_market_id);
  const sellMarket = markets.get(opp.sell_market_id);
  if (!buyMarket || !sellMarket) throw new Error("Markt der Gelegenheit ist nicht mehr konfiguriert");
  const ts = new Date().toISOString();
  const quote = quoteAsset(opp.symbol);

  const buyPx = legs.buyPrice * (1 + slip);
  const sellPx = legs.sellPrice * (1 - slip);
  const buy_order: OrderFill = {
    market_id: opp.buy_market_id, symbol: opp.symbol, side: "buy", price: round(buyPx, 8), amount: legs.amount,
    fee_quote: round(legs.amount * buyPx * (Number(buyMarket.taker_fee_bps) / 1e4), 6), fee_asset: quote, ts,
  };
  const sell_order: OrderFill = {
    market_id: opp.sell_market_id, symbol: opp.symbol, side: "sell", price: round(sellPx, 8), amount: legs.amount,
    fee_quote: round(legs.amount * sellPx * (Number(sellMarket.taker_fee_bps) / 1e4), 6), fee_asset: quote, ts,
  };
  let transferCost = 0;
  if (p.transferModel === "withdraw") {
    transferCost = (buyMarket.withdrawal_fees[baseAsset(opp.symbol)] ?? 0) * legs.buyPrice;
  }
  const realized_pnl_quote = round(
    sell_order.amount * sell_order.price - sell_order.fee_quote
      - buy_order.amount * buy_order.price - buy_order.fee_quote - transferCost,
    4,
  );
  const base = baseAsset(opp.symbol);
  const deltas: BalanceDelta[] = [
    { market_id: opp.buy_market_id, asset: quote, delta: -(buy_order.amount * buy_order.price + buy_order.fee_quote) },
    { market_id: opp.buy_market_id, asset: base, delta: buy_order.amount },
    { market_id: opp.sell_market_id, asset: base, delta: -sell_order.amount },
    { market_id: opp.sell_market_id, asset: quote, delta: sell_order.amount * sell_order.price - sell_order.fee_quote },
  ];
  if (p.transferModel === "withdraw") {
    // Beim Transfer wandert die Basis von der Kaufbörse zur Verkaufsbörse, die Netzgebühr geht dabei verloren.
    const wf = buyMarket.withdrawal_fees[base] ?? 0;
    deltas.splice(2, 0, { market_id: opp.buy_market_id, asset: base, delta: -buy_order.amount }, { market_id: opp.sell_market_id, asset: base, delta: buy_order.amount - wf });
  }
  return { buy_order, sell_order, fills: [buy_order, sell_order], realized_pnl_quote, deltas };
}

/** Wandelt einen Engine-Schritt in eine Ausführung um. Menge und Gebühr beziehen sich auf das Handelspaar. */
function legToFill(leg: Leg, market: MarketRow, ts: string): OrderFill {
  const fee = Number(market.taker_fee_bps) / 1e4;
  const isBuy = leg.side === "buy";
  // Kauf: amount_out ist die Basis-Menge nach Gebühr; Brutto-Menge = amount_out / (1 - fee).
  const amount = isBuy ? leg.amount_out / (1 - fee) : leg.amount_in;
  const grossQuote = isBuy ? leg.amount_in : amount * leg.price;
  return {
    market_id: leg.market_id, symbol: leg.symbol, side: leg.side, price: round(leg.price, 10),
    amount: round(amount, 10), fee_quote: round(grossQuote * fee, 8), fee_asset: quoteAsset(leg.symbol), ts,
  };
}

/**
 * Dreieck: Pfad zu aktuellen Kursen der Börse neu durchrechnen, mit demselben
 * Startbetrag wie in der Gelegenheit. Fehlt ein Kurs, schlägt der Deal fehl.
 */
export function simulateTriangleFills(opp: OpportunityRow, prices: PriceRow[], markets: Map<string, MarketRow>, p: PaperParams): SimulatedDeal {
  const market = markets.get(opp.buy_market_id);
  if (!market) throw new Error("Börse der Gelegenheit ist nicht mehr konfiguriert");
  const symbols = opp.legs.map((l) => l.symbol);
  const quotes = new Map(
    prices.filter((q) => q.market_id === market.id && symbols.includes(q.symbol)).map((q) => [q.symbol, { ...q, contact_id: null }]),
  );
  const missing = symbols.filter((s) => !quotes.has(s));
  if (missing.length) throw new Error(`Kein aktueller Kurs auf ${market.id} für ${missing.join(", ")}`);
  const now = Date.now();
  for (const q of quotes.values()) {
    const stale = staleError(q, p.maxQuoteAgeMs, now);
    if (stale) throw new Error(stale);
  }

  const start = opp.legs[0]?.from_asset;
  const tri = findTriangles(symbols, start).find((t) => t.path.join("→") === opp.symbol);
  if (!tri) throw new Error(`Pfad ${opp.symbol} lässt sich aus ${symbols.join(", ")} nicht mehr bilden`);
  const c = evaluateTriangle(tri, quotes, market, {
    tradeSizeQuote: Number(opp.trade_size), slippageBps: p.slippageBps, transferModel: p.transferModel, minNetSpreadBps: -Infinity,
  });
  if (!c) throw new Error("Dreieck konnte zu aktuellen Kursen nicht bewertet werden");

  const ts = new Date().toISOString();
  const fills = c.legs.map((l) => legToFill(l, market, ts));
  const deltas: BalanceDelta[] = c.legs.flatMap((l) => [
    { market_id: l.market_id, asset: l.from_asset, delta: -l.amount_in },
    { market_id: l.market_id, asset: l.to_asset, delta: l.amount_out },
  ]);
  return { buy_order: null, sell_order: null, fills, realized_pnl_quote: round(c.legs[2].amount_out - c.legs[0].amount_in, 4), deltas };
}

/** Führt alle freigegebenen Paper-Deals aus. Live-Deals werden abgelehnt. */
export async function processApprovedDeals(store: Store, markets: Map<string, MarketRow>, p: PaperParams): Promise<void> {
  const deals = await store.listDeals("approved");
  if (!deals.length) return;
  const prices = await store.getLatestPrices();
  let balances = p.enforceBalances ? await store.listPaperBalances() : null;

  for (const deal of deals) {
    if (deal.mode !== "paper") {
      await store.updateDeal(deal.id, { status: "rejected", error: "Echthandel ist nicht implementiert (EXECUTION_MODE=paper)" });
      continue;
    }
    await store.updateDeal(deal.id, { status: "executing" });
    try {
      const opp = await store.getOpportunity(deal.opportunity_id);
      if (!opp) throw new Error("Gelegenheit nicht gefunden");
      let result: SimulatedDeal;
      if (opp.kind === "triangle") {
        result = simulateTriangleFills(opp, prices, markets, p);
      } else {
        const legs = resolveCrossLegs(opp, prices, p.maxQuoteAgeMs, Date.now());
        if ("error" in legs) throw new Error(legs.error);
        result = simulateCrossFills(opp, legs, markets, p);
      }
      if (balances) {
        const problem = checkBalances(balances, result.deltas);
        if (problem) throw new Error(problem);
        await store.applyBalanceDeltas(result.deltas);
        balances = await store.listPaperBalances();
      }
      const { deltas: _deltas, ...stored } = result;
      const patch: Partial<DealRow> = { status: "filled", ...stored };
      await store.updateDeal(deal.id, patch);
      await store.setOpportunityStatus(opp.id, "executed");
      log.info(`Paper-Deal ${deal.id.slice(0, 8)} ausgeführt: ${opp.kind} ${opp.symbol} auf ${opp.buy_market_id}${opp.kind === "cross" ? `→${opp.sell_market_id}` : ""}, PnL ${result.realized_pnl_quote}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.updateDeal(deal.id, { status: "failed", error: msg });
      log.warn(`Paper-Deal ${deal.id.slice(0, 8)} fehlgeschlagen: ${msg}`);
    }
  }
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
