import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketRow } from "../../../shared/types.ts";
import type { Quote } from "../adapters/types.ts";
import type { EngineParams } from "./spread.ts";
import { crossSymbolsFor, evaluateAllTriangles, evaluateTriangle, findTriangles, trianglePath } from "./triangle.ts";

const market = (id: string, taker: number): MarketRow => ({ id, kind: "mock", name: id, taker_fee_bps: taker, withdrawal_fees: {}, enabled: true });
const q = (symbol: string, bid: number, ask: number, extra: Partial<Quote> = {}): Quote => ({
  market_id: "x", symbol, bid, ask, bid_size: null, ask_size: null, last: null, ts: new Date().toISOString(), listing_id: null, ...extra,
});
const params: EngineParams = { tradeSizeQuote: 1000, slippageBps: 0, transferModel: "prefunded", minNetSpreadBps: 0 };

test("crossSymbolsFor leitet die nötigen Kreuz-Paare aus den Symbolen ab", () => {
  assert.deepEqual(crossSymbolsFor(["BTC/EUR", "ETH/EUR"]).sort(), ["BTC/ETH", "ETH/BTC"]);
  assert.deepEqual(crossSymbolsFor(["BTC/EUR", "ETH/EUR", "SOL/EUR"]).length, 6);
  assert.deepEqual(crossSymbolsFor(["BTC/EUR", "ETH/USDT"]), []); // verschiedene Quotes, kein Dreieck über EUR
  assert.deepEqual(crossSymbolsFor(["BTC/EUR"]), []);
});

test("findTriangles findet beide Richtungen und nutzt das vorhandene Kreuz-Paar", () => {
  const tris = findTriangles(["BTC/EUR", "ETH/EUR", "ETH/BTC"], "EUR");
  assert.deepEqual(tris.map(trianglePath).sort(), ["EUR→BTC→ETH→EUR", "EUR→ETH→BTC→EUR"]);
  const viaBtc = tris.find((t) => trianglePath(t) === "EUR→BTC→ETH→EUR")!;
  assert.deepEqual(viaBtc.symbols, ["BTC/EUR", "ETH/BTC", "ETH/EUR"]);
  // Ohne Kreuz-Paar kein Dreieck.
  assert.deepEqual(findTriangles(["BTC/EUR", "ETH/EUR"], "EUR"), []);
});

test("evaluateTriangle rechnet den Pfad EUR→BTC→ETH→EUR korrekt durch", () => {
  // Konsistente Preise: BTC 50000, ETH 2500, ETH/BTC 0.05 → kein Brutto-Gewinn.
  const quotes = new Map([
    ["BTC/EUR", q("BTC/EUR", 50000, 50000)],
    ["ETH/BTC", q("ETH/BTC", 0.05, 0.05)],
    ["ETH/EUR", q("ETH/EUR", 2500, 2500)],
  ]);
  const tri = findTriangles([...quotes.keys()], "EUR").find((t) => trianglePath(t) === "EUR→BTC→ETH→EUR")!;
  const flat = evaluateTriangle(tri, quotes, market("x", 0), params)!;
  assert.ok(Math.abs(flat.gross_spread_bps) < 1e-6);
  assert.ok(Math.abs(flat.net_spread_bps) < 1e-6);
  assert.equal(flat.legs.length, 3);
  assert.deepEqual(flat.legs.map((l) => l.side), ["buy", "buy", "sell"]);
  assert.deepEqual(flat.legs.map((l) => `${l.from_asset}>${l.to_asset}`), ["EUR>BTC", "BTC>ETH", "ETH>EUR"]);
  assert.ok(Math.abs(flat.legs[0].amount_out - 0.02) < 1e-9); // 1000 / 50000
  assert.ok(Math.abs(flat.legs[1].amount_out - 0.4) < 1e-9); // 0.02 / 0.05
  assert.ok(Math.abs(flat.legs[2].amount_out - 1000) < 1e-6); // 0.4 * 2500

  // ETH/EUR zieht auf 2525 an, ETH/BTC bleibt: 1 % Brutto auf dem Pfad, 3 × 10 bps Gebühren.
  quotes.set("ETH/EUR", q("ETH/EUR", 2525, 2525));
  const c = evaluateTriangle(tri, quotes, market("x", 10), params)!;
  assert.ok(Math.abs(c.gross_spread_bps - 100) < 0.01, `brutto ${c.gross_spread_bps}`);
  // netto: 1.01 * 0.999^3 - 1 = 0.006973 → 69.73 bps
  assert.ok(Math.abs(c.net_spread_bps - 69.73) < 0.01, `netto ${c.net_spread_bps}`);
  assert.ok(Math.abs(c.fees_bps - (c.gross_spread_bps - c.net_spread_bps)) < 1e-9);
  assert.equal(c.trade_size, 1000);
  assert.equal(c.buy_price, 1);
  assert.ok(Math.abs(c.sell_price - 1.01) < 1e-6);
  assert.ok(Math.abs(c.est_profit_quote - 6.97) < 0.01);
  assert.equal(c.kind, "triangle");
  assert.equal(c.symbol, "EUR→BTC→ETH→EUR");
});

test("Slippage wirkt auf jedem der drei Schritte", () => {
  const quotes = new Map([
    ["BTC/EUR", q("BTC/EUR", 50000, 50000)], ["ETH/BTC", q("ETH/BTC", 0.05, 0.05)], ["ETH/EUR", q("ETH/EUR", 2525, 2525)],
  ]);
  const tri = findTriangles([...quotes.keys()], "EUR")[0];
  const a = evaluateTriangle(tri, quotes, market("x", 0), params)!;
  const b = evaluateTriangle(tri, quotes, market("x", 0), { ...params, slippageBps: 10 })!;
  // 3 Schritte × 10 bps ≈ 30 bps weniger; multiplikativ auf 1.01 sind es 30.27 bps.
  assert.ok(Math.abs(a.net_spread_bps - b.net_spread_bps - 30) < 0.5, `${a.net_spread_bps} vs ${b.net_spread_bps}`);
});

test("Orderbuchtiefe begrenzt den Startbetrag über die Rückrechnung", () => {
  // Zweiter Schritt (ETH/BTC kaufen) bietet nur 0.1 ETH an → 0.005 BTC → 250 EUR Startbetrag.
  const quotes = new Map([
    ["BTC/EUR", q("BTC/EUR", 50000, 50000)],
    ["ETH/BTC", q("ETH/BTC", 0.05, 0.05, { ask_size: 0.1 })],
    ["ETH/EUR", q("ETH/EUR", 2525, 2525)],
  ]);
  const tri = findTriangles([...quotes.keys()], "EUR").find((t) => trianglePath(t) === "EUR→BTC→ETH→EUR")!;
  const c = evaluateTriangle(tri, quotes, market("x", 0), params)!;
  assert.ok(Math.abs(c.trade_size - 250) < 1e-6, `trade_size ${c.trade_size}`);
  assert.ok(Math.abs(c.legs[1].amount_out - 0.1) < 1e-9);
  assert.ok(Math.abs(c.est_profit_quote - 2.5) < 0.01);
});

test("evaluateAllTriangles bewertet pro Börse und ignoriert Inserate", () => {
  const markets = new Map([["a", market("a", 10)], ["b", market("b", 10)], ["listings", { ...market("listings", 0), kind: "listings" as const }]]);
  const quotes: Quote[] = [
    q("BTC/EUR", 50000, 50000, { market_id: "a" }), q("ETH/BTC", 0.05, 0.05, { market_id: "a" }), q("ETH/EUR", 2525, 2525, { market_id: "a" }),
    q("BTC/EUR", 50000, 50000, { market_id: "b" }), q("ETH/EUR", 2500, 2500, { market_id: "b" }), // kein Kreuz-Paar auf b
    q("BTC/EUR", 1, 1, { market_id: "listings", listing_id: "L1" }),
  ];
  const all = evaluateAllTriangles(quotes, markets, "EUR", params);
  assert.equal(all.length, 2); // nur Börse a, beide Richtungen
  assert.ok(all.every((c) => c.buy_market_id === "a" && c.sell_market_id === "a"));
  assert.ok(all[0].net_spread_bps > 0 && all[1].net_spread_bps < 0); // eine Richtung gewinnt, die andere verliert
});
