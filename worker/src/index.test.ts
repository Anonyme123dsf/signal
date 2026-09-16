import assert from "node:assert/strict";
import { test } from "node:test";
import { ListingsAdapter } from "./adapters/listings.ts";
import { MockAdapter } from "./adapters/mock.ts";
import type { Mailer, OutgoingMail } from "./comms/mailer.ts";
import type { Config } from "./config.ts";
import { runCycle } from "./index.ts";
import { MemoryStore } from "./store/memory.ts";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    workerId: "test", store: "memory", supabaseUrl: "", supabaseServiceRoleKey: "",
    adapters: ["mock", "listings"], exchanges: [], symbols: ["BTC/EUR"], pollIntervalMs: 1000,
    tradeSizeQuote: 500, minNetSpreadBps: 10, autoPaperBps: 0, opportunityTtlMs: 15000, slippageBps: 5,
    transferModel: "prefunded", recordTicks: false, executionMode: "paper",
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
