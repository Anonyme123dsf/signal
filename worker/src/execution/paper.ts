import type { DealRow, MarketRow, OpportunityRow, OrderFill, PriceRow } from "../../../shared/types.ts";
import { baseAsset } from "../engine/spread.ts";
import { log } from "../log.ts";
import type { Store } from "../store/types.ts";

export interface PaperParams {
  slippageBps: number;
  transferModel: "prefunded" | "withdraw";
}

interface Legs {
  buyPrice: number;
  sellPrice: number;
  amount: number;
}

/**
 * Ermittelt die Ausführungspreise: Inserate haben feste Preise (aus der
 * Gelegenheit), Börsen werden zum aktuellen Stand aus latest_prices gefüllt.
 * So fließt die Verzögerung zwischen Erkennen und Ausführen in den Paper-PnL ein.
 */
function resolveLegs(opp: OpportunityRow, prices: PriceRow[]): Legs | { error: string } {
  const live = (marketId: string) => prices.find((p) => p.market_id === marketId && p.symbol === opp.symbol);

  let buyPrice = Number(opp.buy_price);
  let amount = Number(opp.trade_size);
  if (!opp.buy_listing_id) {
    const q = live(opp.buy_market_id);
    if (!q || q.ask == null) return { error: `Kein aktueller Ask für ${opp.symbol} auf ${opp.buy_market_id}` };
    buyPrice = Number(q.ask);
    if (q.ask_size != null && Number(q.ask_size) > 0) amount = Math.min(amount, Number(q.ask_size));
  }

  let sellPrice = Number(opp.sell_price);
  if (!opp.sell_listing_id) {
    const q = live(opp.sell_market_id);
    if (!q || q.bid == null) return { error: `Kein aktueller Bid für ${opp.symbol} auf ${opp.sell_market_id}` };
    sellPrice = Number(q.bid);
    if (q.bid_size != null && Number(q.bid_size) > 0) amount = Math.min(amount, Number(q.bid_size));
  }
  return { buyPrice, sellPrice, amount };
}

export function simulateFills(opp: OpportunityRow, legs: Legs, markets: Map<string, MarketRow>, p: PaperParams) {
  const slip = p.slippageBps / 1e4;
  const buyMarket = markets.get(opp.buy_market_id);
  const sellMarket = markets.get(opp.sell_market_id);
  if (!buyMarket || !sellMarket) throw new Error("Markt der Gelegenheit ist nicht mehr konfiguriert");
  const ts = new Date().toISOString();

  const buyPx = legs.buyPrice * (1 + slip);
  const sellPx = legs.sellPrice * (1 - slip);
  const buy_order: OrderFill = {
    market_id: opp.buy_market_id, symbol: opp.symbol, side: "buy", price: round(buyPx, 8), amount: legs.amount,
    fee_quote: round(legs.amount * buyPx * (Number(buyMarket.taker_fee_bps) / 1e4), 4), ts,
  };
  const sell_order: OrderFill = {
    market_id: opp.sell_market_id, symbol: opp.symbol, side: "sell", price: round(sellPx, 8), amount: legs.amount,
    fee_quote: round(legs.amount * sellPx * (Number(sellMarket.taker_fee_bps) / 1e4), 4), ts,
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
  return { buy_order, sell_order, realized_pnl_quote };
}

/** Führt alle freigegebenen Paper-Deals aus. Live-Deals werden abgelehnt. */
export async function processApprovedDeals(store: Store, markets: Map<string, MarketRow>, p: PaperParams): Promise<void> {
  const deals = await store.listDeals("approved");
  if (!deals.length) return;
  const prices = await store.getLatestPrices();

  for (const deal of deals) {
    if (deal.mode !== "paper") {
      await store.updateDeal(deal.id, { status: "rejected", error: "Echthandel ist nicht implementiert (EXECUTION_MODE=paper)" });
      continue;
    }
    await store.updateDeal(deal.id, { status: "executing" });
    try {
      const opp = await store.getOpportunity(deal.opportunity_id);
      if (!opp) throw new Error("Gelegenheit nicht gefunden");
      const legs = resolveLegs(opp, prices);
      if ("error" in legs) throw new Error(legs.error);
      const result = simulateFills(opp, legs, markets, p);
      await store.updateDeal(deal.id, { status: "filled", ...result });
      await store.setOpportunityStatus(opp.id, "executed");
      log.info(`Paper-Deal ${deal.id.slice(0, 8)} ausgeführt: ${opp.symbol} ${opp.buy_market_id}→${opp.sell_market_id}, PnL ${result.realized_pnl_quote}`);
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
