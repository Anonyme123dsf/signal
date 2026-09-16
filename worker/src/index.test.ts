import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketRow } from "../../shared/types.ts";
import { ListingsAdapter } from "./adapters/listings.ts";
import { MockAdapter } from "./adapters/mock.ts";
import type { MarketAdapter, Quote } from "./adapters/types.ts";
import type { Mailer, OutgoingMail } from "./comms/mailer.ts";
import type { Config } from "./config.ts";
import { runCycle, wantedSymbols } from "./index.ts";
import { MemoryStore } from "./store/memory.ts";

/** Adapter mit festen Kursen, um Dreiecke und Historie deterministisch zu testen. */
class StaticAdapter implements MarketAdapter {
  constructor(readonly id: string, private readonly fees: number, public prices: Record<string, [number, number]>) {}
  markets(): MarketRow[] {
    return [{ id: this.id, kind: "mock", name: this.id, taker_fee_bps: this.fees, withdrawal_fees: {}, enabled: true }];
  }
  async init() {}
  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const ts = new Date().toISOString();
    return symbols.filter((s) => this.prices[s]).map((s) => ({
      market_id: this.id, symbol: s, bid: this.prices[s][0], ask: this.prices[s][1],
      bid_size: null, ask_size: null, last: null, ts, listing_id: null,
    }));
  }
  async close() {}
}

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    workerId: "test", store: "memory", supabaseUrl: "", supabaseServiceRoleKey: "",
    adapters: ["mock", "listings"], exchanges: [], symbols: ["BTC/EUR"], pollIntervalMs: 1000,
    tradeSizeQuote: 500, minNetSpreadBps: 10, autoPaperBps: 0, opportunityTtlMs: 15000, slippageBps: 5,
    transferModel: "prefunded", recordTicks: false, triangular: false, triangleStart: "",
    spreadSampleIntervalMs: 0, spreadHistoryDays: 14, executionMode: "paper",
    mailer: "console", mailFrom: "Bot <bot@example.com>", resendApiKey: "",
    smtp: { host: "", port: 587, user: "", pass: "", secure: false }, imap: null, inboxPollMs: 60000,
    mockMarkets: 2, mockSeed: 1, ...overrides,
  };
}

class RecordingMailer implements Mailer {
  readonly kind = "test";
  sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail) {
    this.sent.push(mail);
    return { providerMessageId: `test-${this.sent.length}` };
  }
}

test("Inserate → Gelegenheit → Entwürfe → Freigabe → Versand → Paper-Deal → Ablauf", async () => {
  // 5000 EUR Einsatz, damit die Menge durch das Käufergesuch (0,02) begrenzt wird, nicht durch den Einsatz.
  const cfg = testConfig({ tradeSizeQuote: 5000 });
  const store = new MemoryStore();
  const seller = store.addListing(
    { market_id: "listings", symbol: "BTC/EUR", side: "sell", price: 58000, quantity: 0.05, external_url: "https://example.org/anzeige/1" },
    { name: "Anna", email: "anna@example.com", market_id: "listings", external_ref: null },
  );
  const buyer = store.addListing(
    { market_id: "listings", symbol: "BTC/EUR", side: "buy", price: 60500, quantity: 0.02, external_url: null },
    { name: "Ben", email: "ben@example.com", market_id: "listings", external_ref: null },
  );
  const adapters = [new MockAdapter(cfg.mockMarkets, cfg.mockSeed), new ListingsAdapter(store)];
  const markets = await store.syncMarkets(adapters.flatMap((a) => a.markets()));
  const mailer = new RecordingMailer();

  // Zyklus 1: Gelegenheiten und Entwürfe entstehen.
  const stats = await runCycle(cfg, store, adapters, markets, mailer);
  assert.equal(stats.adapterErrors.length, 0);
  assert.equal(stats.quotes, 4); // 2 Mock-Börsen + 2 Inserate
  assert.ok(stats.newOpportunities >= 1);

  const opps = [...store.opportunities.values()];
  const direct = opps.find((o) => o.buy_listing_id === seller.id && o.sell_listing_id === buyer.id);
  assert.ok(direct, "Verkäufer- und Käuferinserat wurden nicht direkt zusammengeführt");
  assert.ok(Math.abs(direct.gross_spread_bps - ((60500 - 58000) / 58000) * 1e4) < 0.01);
  assert.equal(direct.trade_size, 0.02); // begrenzt durch das Käufergesuch
  assert.equal(direct.status, "open");

  // Nur die Börsenpreise landen in latest_prices, Inserate nicht.
  const prices = await store.getLatestPrices();
  assert.ok(prices.every((p) => p.listing_id === null));
  assert.equal(prices.length, 2);

  // Pro Inserat genau ein Entwurf, obwohl mehrere Gelegenheiten dasselbe Inserat nutzen.
  const drafts = await store.listMessages("draft");
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((d) => d.to_email).sort(), ["anna@example.com", "ben@example.com"]);
  assert.ok(drafts.every((d) => /\[SIG-[0-9A-F]{6}\]/.test(d.subject)));
  assert.ok(drafts.find((d) => d.to_email === "anna@example.com")!.body.includes("example.org/anzeige/1"));
  assert.equal(mailer.sent.length, 0, "Entwürfe dürfen nicht ohne Freigabe verschickt werden");

  // Zyklus 2: Freigabe im Dashboard simuliert, Nachrichten gehen raus, Deal wird ausgeführt.
  for (const d of drafts) await store.updateMessage(d.id, { status: "approved" });
  const deal = await store.createDeal({ opportunity_id: direct.id, mode: "paper", status: "approved" });
  await runCycle(cfg, store, adapters, markets, mailer);

  assert.equal(mailer.sent.length, 2);
  assert.equal((await store.listMessages("sent")).length, 2);
  assert.equal((await store.listMessages("draft")).length, 0);
  const filled = store.deals.get(deal.id)!;
  assert.equal(filled.status, "filled", filled.error ?? "");
  assert.ok(filled.buy_order && filled.sell_order);
  assert.equal(filled.buy_order.price, 58000 * (1 + 5 / 1e4));
  assert.equal(filled.sell_order.price, 60500 * (1 - 5 / 1e4));
  assert.ok((filled.realized_pnl_quote ?? 0) > 0);
  assert.equal(store.opportunities.get(direct.id)!.status, "executed");

  // Antwort per Kennung zuordnen (was der IMAP-Abruf tut).
  const tag = drafts[0].thread_tag;
  assert.equal((await store.findOutboundByThreadTag(tag))?.id, drafts[0].id);

  // Zyklus 3: Inserate geschlossen, TTL 0 → verbleibende Inserat-Gelegenheiten laufen ab.
  for (const l of store.listings.values()) l.status = "closed";
  const stats3 = await runCycle({ ...cfg, opportunityTtlMs: 0 }, store, adapters, markets, mailer);
  assert.ok(stats3.expired >= 1);
  assert.ok([...store.opportunities.values()]
    .filter((o) => o.buy_listing_id || o.sell_listing_id)
    .every((o) => o.status !== "open"));
});

test("Auto-Paper-Deal wird ab Schwelle angelegt und Live-Deals werden abgelehnt", async () => {
  const cfg = testConfig({ autoPaperBps: 1, minNetSpreadBps: 1 });
  const store = new MemoryStore();
  store.addListing({ market_id: "listings", symbol: "BTC/EUR", side: "sell", price: 50000, quantity: 1, external_url: null });
  store.addListing({ market_id: "listings", symbol: "BTC/EUR", side: "buy", price: 51000, quantity: 1, external_url: null });
  const adapters = [new ListingsAdapter(store)];
  const markets = await store.syncMarkets(adapters.flatMap((a) => a.markets()));
  const mailer = new RecordingMailer();

  await runCycle(cfg, store, adapters, markets, mailer);
  const filled = await store.listDeals("filled");
  assert.equal(filled.length, 1);
  assert.equal(filled[0].mode, "paper");
  // Ohne Kontakte am Inserat gibt es auch keine Entwürfe.
  assert.equal((await store.listMessages("draft")).length, 0);

  const live = await store.createDeal({ opportunity_id: filled[0].opportunity_id, mode: "live", status: "approved" });
  await runCycle(cfg, store, adapters, markets, mailer);
  assert.equal(store.deals.get(live.id)!.status, "rejected");
});

test("Dreieck auf einer Börse: Kreuz-Paar wird angefragt, Gelegenheit erkannt, Paper-Deal über drei Legs ausgeführt", async () => {
  const cfg = testConfig({ triangular: true, symbols: ["BTC/EUR", "ETH/EUR"], autoPaperBps: 20, minNetSpreadBps: 5 });
  assert.deepEqual(wantedSymbols(cfg).sort(), ["BTC/ETH", "BTC/EUR", "ETH/BTC", "ETH/EUR"]);

  // ETH/EUR liegt 1 % über dem, was BTC/EUR × ETH/BTC ergibt → EUR→BTC→ETH→EUR gewinnt brutto 100 bps.
  const ex = new StaticAdapter("ex", 10, {
    "BTC/EUR": [49990, 50000], "ETH/BTC": [0.05, 0.05], "ETH/EUR": [2525, 2530],
  });
  const store = new MemoryStore();
  const markets = await store.syncMarkets(ex.markets());
  const mailer = new RecordingMailer();

  const stats = await runCycle(cfg, store, [ex], markets, mailer);
  assert.equal(stats.quotes, 3); // BTC/ETH gibt es auf der Börse nicht
  assert.equal(stats.triangles, 2);
  const opps = [...store.opportunities.values()];
  const tri = opps.find((o) => o.kind === "triangle" && o.symbol === "EUR→BTC→ETH→EUR");
  assert.ok(tri, "Dreieck EUR→BTC→ETH→EUR fehlt");
  assert.equal(tri.buy_market_id, "ex");
  assert.equal(tri.sell_market_id, "ex");
  assert.equal(tri.legs.length, 3);
  assert.equal(tri.trade_size, cfg.tradeSizeQuote);
  // brutto: 2525 / (50000 × 0.05) − 1 = 1 % ; netto: 1.01 × 0.999³ × (1 − 5 bps)³ − 1 ≈ 54.7 bps
  assert.ok(Math.abs(tri.gross_spread_bps - 100) < 0.01, `brutto ${tri.gross_spread_bps}`);
  assert.ok(tri.net_spread_bps > 50 && tri.net_spread_bps < 60, `netto ${tri.net_spread_bps}`);
  // Die Gegenrichtung verliert und darf nicht als Gelegenheit auftauchen.
  assert.ok(!opps.some((o) => o.symbol === "EUR→ETH→BTC→EUR"));

  // Auto-Paper ab 20 bps → Deal wurde im selben Zyklus ausgeführt.
  const [deal] = await store.listDeals("filled");
  assert.ok(deal, "Auto-Paper-Deal fehlt");
  assert.equal(deal.opportunity_id, tri.id);
  assert.equal(deal.fills.length, 3);
  assert.deepEqual(deal.fills.map((f) => `${f.side} ${f.symbol}`), ["buy BTC/EUR", "buy ETH/BTC", "sell ETH/EUR"]);
  assert.deepEqual(deal.fills.map((f) => f.fee_asset), ["EUR", "BTC", "EUR"]);
  assert.equal(deal.buy_order, null);
  assert.ok(Math.abs((deal.realized_pnl_quote ?? 0) - tri.est_profit_quote) < 0.02);
  assert.equal(store.opportunities.get(tri.id)!.status, "executed");

  // Kurs kippt: Paper-Deal auf eine alte Gelegenheit wird zum neuen Kurs gefüllt und verliert.
  ex.prices["ETH/EUR"] = [2450, 2455];
  const { row: reopened } = await store.upsertOpportunity({ ...tri, kind: "triangle", buy_contact_id: null, sell_contact_id: null }, new Date());
  const late = await store.createDeal({ opportunity_id: reopened.id, mode: "paper", status: "approved" });
  await runCycle(cfg, store, [ex], markets, mailer);
  const lateDeal = store.deals.get(late.id)!;
  assert.equal(lateDeal.status, "filled", lateDeal.error ?? "");
  assert.ok((lateDeal.realized_pnl_quote ?? 0) < 0);
});

test("Spread-Historie: alle bewerteten Routen werden im Takt gespeichert, Inserate nicht, alte Messpunkte werden gelöscht", async () => {
  const cfg = testConfig({ triangular: true, symbols: ["BTC/EUR", "ETH/EUR"], spreadSampleIntervalMs: 1000, spreadHistoryDays: 1 });
  const a = new StaticAdapter("a", 10, { "BTC/EUR": [49990, 50000], "ETH/BTC": [0.05, 0.05], "ETH/EUR": [2495, 2500] });
  const b = new StaticAdapter("b", 10, { "BTC/EUR": [50100, 50110], "ETH/EUR": [2500, 2505] });
  const store = new MemoryStore();
  store.addListing({ market_id: "listings", symbol: "BTC/EUR", side: "sell", price: 40000, quantity: 1, external_url: null });
  const listings = new ListingsAdapter(store);
  const markets = await store.syncMarkets([...a.markets(), ...b.markets(), ...listings.markets()]);
  const mailer = new RecordingMailer();

  const state = { lastSampleAt: 0, lastCleanupAt: Date.now() };
  const s1 = await runCycle(cfg, store, [a, b, listings], markets, mailer, state);
  // Cross-Routen zwischen a und b: 2 Symbole × 2 Richtungen = 4; Dreiecke nur auf a: 2. Inserat-Routen fallen raus.
  assert.equal(s1.samples, 6, `samples ${s1.samples}`);
  assert.ok(store.spreadSamples.some((r) => r.net_bps < 0), "auch negative Netto-Spreads gehören in die Historie");
  assert.ok(store.spreadSamples.some((r) => r.kind === "triangle"));
  assert.ok(store.spreadSamples.every((r) => r.buy_market_id !== "listings" && r.sell_market_id !== "listings"));

  // Innerhalb des Intervalls wird nicht erneut gesampelt.
  const s2 = await runCycle(cfg, store, [a, b, listings], markets, mailer, state);
  assert.equal(s2.samples, 0);
  assert.equal(store.spreadSamples.length, 6);

  // Aufräumen: Messpunkte älter als SPREAD_HISTORY_DAYS verschwinden beim nächsten Stundenlauf.
  store.spreadSamples[0].ts = new Date(Date.now() - 2 * 86_400_000).toISOString();
  state.lastCleanupAt = 0;
  state.lastSampleAt = 0;
  await runCycle(cfg, store, [a, b, listings], markets, mailer, state);
  assert.equal(store.spreadSamples.length, 6 + 6 - 1);
});
