import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketRow } from "../../../shared/types.ts";
import type { Quote } from "../adapters/types.ts";
import { evaluatePair, findOpportunities, type EngineParams } from "./spread.ts";

const market = (id: string, taker: number, wf: Record<string, number> = {}): MarketRow => ({
  id, kind: "mock", name: id, taker_fee_bps: taker, withdrawal_fees: wf, enabled: true,
});
const quote = (market_id: string, bid: number | null, ask: number | null, extra: Partial<Quote> = {}): Quote => ({
  market_id, symbol: "BTC/EUR", bid, ask, bid_size: null, ask_size: null, last: null,
  ts: new Date().toISOString(), listing_id: null, ...extra,
});
const params: EngineParams = { tradeSizeQuote: 1000, slippageBps: 0, transferModel: "prefunded", minNetSpreadBps: 0 };

test("Netto-Spread zieht Taker-Gebühren beider Seiten ab", () => {
  // Kauf 100, Verkauf 101 → brutto 100 bps. Je 10 bps Gebühr → netto knapp 80 bps.
  const c = evaluatePair(quote("a", 99, 100), quote("b", 101, 102), market("a", 10), market("b", 10), params);
  assert.ok(c);
  assert.equal(c.gross_spread_bps, 100);
  assert.ok(Math.abs(c.net_spread_bps - 79.9) < 0.01, `netto war ${c.net_spread_bps}`);
  assert.equal(c.trade_size, 10); // 1000 EUR / 100
  // Gewinn: 10 * 101 * 0.999 - 10 * 100 * 1.001 = 1008.99 - 1001 = 7.99
  assert.equal(c.est_profit_quote, 7.99);
  assert.ok(Math.abs(c.gross_spread_bps - c.fees_bps - c.net_spread_bps) < 1e-9);
});

test("Bid unter Ask ergibt negativen Spread (für die Historie), fehlende Preise ergeben keinen Kandidaten", () => {
  const flat = evaluatePair(quote("a", 99, 100), quote("b", 100, 101), market("a", 10), market("b", 10), params);
  assert.ok(flat);
  assert.equal(flat.gross_spread_bps, 0);
  assert.ok(flat.net_spread_bps < 0);
  assert.equal(evaluatePair(quote("a", 99, null), quote("b", 105, 106), market("a", 0), market("b", 0), params), null);
  // findOpportunities filtert solche Routen heraus.
  const markets = new Map([["a", market("a", 10)], ["b", market("b", 10)]]);
  assert.deepEqual(findOpportunities([quote("a", 99, 100), quote("b", 100, 101)], markets, params), []);
});

test("Slippage-Aufschlag und Abhebegebühr senken den Netto-Spread", () => {
  const base = evaluatePair(quote("a", 99, 100), quote("b", 101, 102), market("a", 0), market("b", 0), params)!;
  const slipped = evaluatePair(quote("a", 99, 100), quote("b", 101, 102), market("a", 0), market("b", 0), { ...params, slippageBps: 10 })!;
  assert.ok(slipped.net_spread_bps < base.net_spread_bps);

  // Abhebegebühr 0.01 BTC bei Kurs 100 = 1 EUR auf 1000 EUR Einsatz = 10 bps.
  const withdrawn = evaluatePair(
    quote("a", 99, 100), quote("b", 101, 102),
    market("a", 0, { BTC: 0.01 }), market("b", 0),
    { ...params, transferModel: "withdraw" },
  )!;
  assert.ok(Math.abs(base.net_spread_bps - withdrawn.net_spread_bps - 10) < 0.01);
});

test("Handelsgröße wird durch verfügbare Tiefe begrenzt", () => {
  const c = evaluatePair(
    quote("a", 99, 100, { ask_size: 2 }), quote("b", 101, 102, { bid_size: 5 }),
    market("a", 0), market("b", 0), params,
  )!;
  assert.equal(c.trade_size, 2);
});

test("findOpportunities prüft alle Marktpaare und filtert nach Schwelle", () => {
  const markets = new Map([["a", market("a", 10)], ["b", market("b", 10)], ["c", market("c", 10)]]);
  const quotes = [quote("a", 99, 100), quote("b", 101, 102), quote("c", 100.1, 100.2)];
  const all = findOpportunities(quotes, markets, params);
  // a→b (100 bps brutto) und c→b (80 bps brutto) bleiben nach 20 bps Gebühren positiv, sortiert absteigend.
  // a→c hat nur 10 bps brutto und fällt wegen der Gebühren weg.
  assert.deepEqual(all.map((c) => `${c.buy_market_id}>${c.sell_market_id}`), ["a>b", "c>b"]);
  const strict = findOpportunities(quotes, markets, { ...params, minNetSpreadBps: 70 });
  assert.deepEqual(strict.map((c) => `${c.buy_market_id}>${c.sell_market_id}`), ["a>b"]);
});

test("Zwei Inserate desselben Marktes bilden ein Paar (Mittelsmann-Fall)", () => {
  const markets = new Map([["listings", market("listings", 0)]]);
  const seller = quote("listings", null, 100, { listing_id: "L1", contact_id: "C1" });
  const buyer = quote("listings", 110, null, { listing_id: "L2", contact_id: "C2" });
  const [c] = findOpportunities([seller, buyer], markets, params);
  assert.ok(c);
  assert.equal(c.buy_listing_id, "L1");
  assert.equal(c.sell_listing_id, "L2");
  assert.equal(c.buy_contact_id, "C1");
  assert.equal(c.sell_contact_id, "C2");
  assert.equal(c.gross_spread_bps, 1000);
});
