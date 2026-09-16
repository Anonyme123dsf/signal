import type { MarketRow, PriceRow } from "../../shared/types.ts";
import { buildAdapters } from "./adapters/registry.ts";
import type { MarketAdapter, Quote } from "./adapters/types.ts";
import { createDraftsForOpportunity } from "./comms/drafts.ts";
import { pollInbox } from "./comms/inbox.ts";
import { createMailer, processApprovedMessages } from "./comms/mailer.ts";
import { loadConfig, type Config } from "./config.ts";
import { findOpportunities } from "./engine/spread.ts";
import { processApprovedDeals } from "./execution/paper.ts";
import { log } from "./log.ts";
import { createStore } from "./store/index.ts";
import type { Store } from "./store/types.ts";

interface CycleStats {
  quotes: number;
  candidates: number;
  newOpportunities: number;
  expired: number;
  adapterErrors: string[];
  durationMs: number;
}

/**
 * Ein Durchlauf der Hauptschleife:
 * 1. Preise aller Adapter holen  2. Börsenpreise speichern  3. Spreads berechnen
 * 4. Gelegenheiten anlegen/aktualisieren, Entwürfe und Auto-Paper-Deals erzeugen
 * 5. Abgelaufene Gelegenheiten schließen  6. Freigegebene Deals und Nachrichten abarbeiten
 */
export async function runCycle(
  cfg: Config,
  store: Store,
  adapters: MarketAdapter[],
  markets: Map<string, MarketRow>,
  mailer: ReturnType<typeof createMailer>,
): Promise<CycleStats> {
  const started = Date.now();
  const now = new Date();
  const adapterErrors: string[] = [];

  const results = await Promise.allSettled(adapters.map((a) => a.fetchQuotes(cfg.symbols)));
  const quotes: Quote[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes.push(...r.value);
    else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      adapterErrors.push(`${adapters[i].id}: ${msg}`);
      log.warn(`Adapter ${adapters[i].id} lieferte keine Preise`, msg);
    }
  });

  // Inserate haben keinen "aktuellen Kurs" pro Markt, nur Börsenpreise landen in latest_prices.
  const exchangePrices: PriceRow[] = quotes.filter((q) => !q.listing_id).map(({ contact_id: _c, ...p }) => p);
  await store.savePrices(exchangePrices, cfg.recordTicks);

  const candidates = findOpportunities(quotes, markets, {
    tradeSizeQuote: cfg.tradeSizeQuote, slippageBps: cfg.slippageBps,
    transferModel: cfg.transferModel, minNetSpreadBps: cfg.minNetSpreadBps,
  });

  let newOpportunities = 0;
  for (const c of candidates) {
    const { row, created } = await store.upsertOpportunity(c, now);
    if (!created) continue;
    newOpportunities++;
    log.info(`Gelegenheit ${c.symbol}: ${c.buy_market_id} ${c.buy_price} → ${c.sell_market_id} ${c.sell_price} | netto ${c.net_spread_bps} bps, ca. ${c.est_profit_quote}`);
    if (c.buy_listing_id || c.sell_listing_id) await createDraftsForOpportunity(store, row, c, cfg.mailFrom);
    if (cfg.autoPaperBps > 0 && c.net_spread_bps >= cfg.autoPaperBps) {
      await store.createDeal({ opportunity_id: row.id, mode: "paper", status: "approved" });
      log.info(`Auto-Paper-Deal für Gelegenheit ${row.id.slice(0, 8)} angelegt`);
    }
  }

  const expired = await store.expireOpportunities(new Date(now.getTime() - cfg.opportunityTtlMs));
  await processApprovedDeals(store, markets, { slippageBps: cfg.slippageBps, transferModel: cfg.transferModel });
  await processApprovedMessages(store, mailer);

  return { quotes: quotes.length, candidates: candidates.length, newOpportunities, expired, adapterErrors, durationMs: Date.now() - started };
}

async function main() {
  const cfg = loadConfig();
  log.info(`Worker ${cfg.workerId} startet`, {
    store: cfg.store, adapters: cfg.adapters, exchanges: cfg.adapters.includes("ccxt") ? cfg.exchanges : [],
    symbols: cfg.symbols, pollIntervalMs: cfg.pollIntervalMs, executionMode: cfg.executionMode, mailer: cfg.mailer,
  });

  const store = createStore(cfg);
  await store.init();
  const adapters = buildAdapters(cfg, store);
  const initResults = await Promise.allSettled(adapters.map((a) => a.init()));
  const live: MarketAdapter[] = [];
  initResults.forEach((r, i) => {
    if (r.status === "fulfilled") live.push(adapters[i]);
    else log.error(`Adapter ${adapters[i].id} konnte nicht initialisiert werden, wird übersprungen`, r.reason instanceof Error ? r.reason.message : String(r.reason));
  });
  if (!live.length) throw new Error("Kein Adapter einsatzbereit");

  const markets = await store.syncMarkets(live.flatMap((a) => a.markets()));
  const mailer = createMailer(cfg);
  log.info(`Märkte: ${[...markets.values()].map((m) => `${m.id} (${m.taker_fee_bps} bps)`).join(", ")}`);

  let running = true;
  let cycleActive = false;
  let lastInboxPoll = 0;
  let consecutiveErrors = 0;

  const shutdown = async (signal: string) => {
    if (!running) return;
    running = false;
    log.info(`${signal} empfangen, Worker fährt herunter`);
    await Promise.allSettled(live.map((a) => a.close()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const tick = async () => {
    if (!running || cycleActive) return;
    cycleActive = true;
    try {
      const stats = await runCycle(cfg, store, live, markets, mailer);
      consecutiveErrors = 0;
      if (cfg.imap && Date.now() - lastInboxPoll >= cfg.inboxPollMs) {
        lastInboxPoll = Date.now();
        try {
          await pollInbox(store, cfg.imap);
        } catch (err) {
          log.warn("Posteingang konnte nicht abgerufen werden", err instanceof Error ? err.message : String(err));
        }
      }
      await store.heartbeat({
        worker_id: cfg.workerId, last_seen: new Date().toISOString(),
        status: { ...stats, adapters: live.map((a) => a.id), symbols: cfg.symbols, executionMode: cfg.executionMode, mailer: mailer.kind },
      });
      log.debug("Zyklus", stats);
    } catch (err) {
      consecutiveErrors++;
      log.error(`Zyklus fehlgeschlagen (${consecutiveErrors} in Folge)`, err instanceof Error ? err.stack ?? err.message : String(err));
    } finally {
      cycleActive = false;
    }
  };

  await tick();
  setInterval(() => void tick(), cfg.pollIntervalMs);
}

const isEntry = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntry) {
  main().catch((err) => {
    log.error("Worker konnte nicht starten", err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
