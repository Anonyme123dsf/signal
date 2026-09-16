import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOffer, isLiquid, referenceValue } from "./deals.ts";
import { DemoReference } from "./reference.ts";
import { scanOffers } from "./scan.ts";
import type { CardRef, DealParams, Offer } from "./types.ts";

const params: DealParams = { minDiscountPct: 20, minValueEur: 5, sellFeePct: 5, maxTrendGapPct: 30 };
const charizard: CardRef = {
  id: "base1-4", name: "Charizard", setName: "Base Set", number: "4",
  prices: { low: 180, trend: 240, avg7: 235, avg30: 245, averageSell: 250 }, imageUrl: null, url: null,
};

test("referenceValue nimmt Trend, sonst 30-Tage-Schnitt, sonst Durchschnittsverkauf", () => {
  assert.equal(referenceValue(charizard), 240);
  assert.equal(referenceValue({ ...charizard, prices: { ...charizard.prices, trend: null } }), 245);
  assert.equal(referenceValue({ ...charizard, prices: { low: null, trend: null, avg7: null, avg30: null, averageSell: 200 } }), 200);
  assert.equal(referenceValue({ ...charizard, prices: { low: null, trend: null, avg7: null, avg30: null, averageSell: null } }), null);
});

test("Klarer Deal: deutlich unter Wert, Gewinn nach Gebühren, liquider Markt", () => {
  const offer: Offer = { query: "Charizard", number: "4", price: 150, shipping: 5 };
  const r = evaluateOffer(offer, charizard, params);
  assert.equal(r.verdict, "deal");
  assert.equal(r.referenceEur, 240);
  // Rabatt: (240 - 155) / 240 = 35,4 %
  assert.ok(Math.abs((r.discountPct ?? 0) - 35.4) < 0.1);
  // Gewinn: 240 * 0,95 - 155 = 73
  assert.equal(r.estProfitEur, 73);
});

test("Zu kleiner Rabatt wird übersprungen", () => {
  const r = evaluateOffer({ query: "Charizard", number: "4", price: 210 }, charizard, params);
  assert.equal(r.verdict, "skip");
  assert.match(r.reason, /unter Wert/);
});

test("Gebühren können den Gewinn auffressen, obwohl der Rabatt reicht", () => {
  // Rabatt 21 % über der Schwelle, aber hohe Gebühr macht den Gewinn negativ.
  const r = evaluateOffer({ query: "Charizard", number: "4", price: 189 }, charizard, { ...params, sellFeePct: 25 });
  assert.equal(r.verdict, "skip");
  assert.match(r.reason, /kein Gewinn/);
});

test("Billige Karte unter der Bagatellgrenze ist kein Deal, sondern nur beobachten", () => {
  const cheap: CardRef = { ...charizard, name: "Pikachu", prices: { low: 3, trend: 4, avg7: 4, avg30: 4, averageSell: 5 } };
  const r = evaluateOffer({ query: "Pikachu", price: 1 }, cheap, params);
  assert.equal(r.liquidityOk, false);
  assert.equal(r.verdict, "watch");
});

test("Instabiler Markt (Trend weit unter 30-Tage-Schnitt) gilt als nicht liquide", () => {
  const falling: CardRef = { ...charizard, prices: { low: 1, trend: 8, avg7: 12, avg30: 20, averageSell: 15 } };
  assert.equal(isLiquid(falling, 8, params), false);
  const r = evaluateOffer({ query: "x", price: 4 }, falling, params);
  assert.equal(r.verdict, "watch");
});

test("Keine passende Karte ergibt no_match", () => {
  const r = evaluateOffer({ query: "Nichtvorhanden", price: 10 }, null, params);
  assert.equal(r.verdict, "no_match");
});

test("scanOffers sortiert Deals nach Gewinn und nutzt die Demo-Referenz", async () => {
  const offers: Offer[] = [
    { query: "Pikachu", number: "25", price: 2 },
    { query: "Charizard", number: "4", price: 150 },
    { query: "Blastoise", number: "2", price: 80 },
    { query: "Mewtwo", price: 40 },
  ];
  const results = await scanOffers(offers, new DemoReference(), params);
  const deals = results.filter((r) => r.verdict === "deal");
  // Alle drei bekannten Karten sind Deals, sortiert nach höchstem Gewinn.
  assert.deepEqual(deals.map((d) => d.card?.name), ["Charizard", "Blastoise", "Pikachu"]);
  assert.ok((deals[0].estProfitEur ?? 0) > (deals[1].estProfitEur ?? 0));
  assert.ok((deals[1].estProfitEur ?? 0) > (deals[2].estProfitEur ?? 0));
  assert.equal(results[results.length - 1].verdict, "no_match"); // Mewtwo fehlt in der Referenz
});
