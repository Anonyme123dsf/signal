import type { MarketRow, PriceRow, SpreadSampleRow } from "../../shared/types.ts";
import { buildAdapters } from "./adapters/registry.ts";
import type { MarketAdapter, Quote } from "./adapters/types.ts";
import { createDraftsForOpportunity } from "./comms/drafts.ts";
import { pollInbox } from "./comms/inbox.ts";
import { createMailer, processApprovedMessages } from "./comms/mailer.ts";
import { loadConfig, type Config } from "./config.ts";
import { evaluateAllPairs, filterOpportunities, quoteAsset, type Candidate, type EngineParams } from "./engine/spread.ts";
import { crossSymbolsFor, evaluateAllTriangles } from "./engine/triangle.ts";
import { processApprovedDeals } from "./execution/paper.ts";
import { log } from "./log.ts";
import { createStore } from "./store/index.ts";
import type { Store } from "./store/types.ts";

interface CycleStats {
  quotes: number;
  /** Adapter, die wegen wiederholter Fehler gerade ausgesetzt sind. */
  skippedAdapters: string[];
  /** Bewertete Routen insgesamt (Cross-Paare und Dreiecke), auch unprofitable. */
  routes: number;
  /** Routen über der Schwelle. */
  candidates: number;
  triangles: number;
  newOpportunities: number;
  expired: number;
  samples: number;
  adapterErrors: string[];
  durationMs: number;
}

export interface AdapterHealth {
  failures: number;
  /** Bis zu diesem Zeitpunkt (ms) wird der Adapter nicht befragt. */
  skipUntil: number;
}

/** Zustand, der zwischen zwei Zyklen erhalten bleibt. */
export interface CycleState {
  lastSampleAt: number;
  lastCleanupAt: number;
  health: Map<string, AdapterHealth>;
}

export function newCycleState(now = Date.now()): CycleState {
  return { lastSampleAt: 0, lastCleanupAt: now, health: new Map() };
}

/** Ab so vielen Fehlern in Folge wird ein Adapter ausgesetzt, mit wachsender Pause bis zur Obergrenze. */
export const BACKOFF = { afterFailures: 3, baseMs: 60_000, maxMs: 600_000 };

function recordFailure(state: CycleState, adapterId: string, now: number): number | null {
  const h = state.health.get(adapterId) ?? { failures: 0, skipUntil: 0 };
  h.failures++;
  if (h.failures >= BACKOFF.afterFailures) {
    const pause = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** (h.failures - BACKOFF.afterFailures));
    h.skipUntil = now + pause;
    state.health.set(adapterId, h);
    return pause;
  }
  state.health.set(adapterId, h);
  return null;
}

export function engineParams(cfg: Config): EngineParams {
  return {
    tradeSizeQuote: cfg.tradeSizeQuote, slippageBps: cfg.slippageBps,
    transferModel: cfg.transferModel, minNetSpreadBps: cfg.minNetSpreadBps,
  };
}

/** Konfigurierte Symbole plus die Kreuz-Paare, die Dreiecke brauchen. Jeder Adapter behält nur, was er kennt. */
export function wantedSymbols(cfg: Config): string[] {
  if (!cfg.triangular) return cfg.symbols;
  return [...cfg.symbols, ...crossSymbolsFor(cfg.symbols)];
}

export function triangleStart(cfg: Config): string {
  return cfg.triangleStart || quoteAsset(cfg.symbols[0] ?? "") || "EUR";
}

function toSample(c: Candidate, ts: string): SpreadSampleRow {
  return {
    ts, kind: c.kind, symbol: c.symbol, buy_market_id: c.buy_market_id, sell_market_id: c.sell_market_id,
    gross_bps: c.gross_spread_bps, fees_bps: c.fees_bps, net_bps: c.net_spread_bps,
    est_profit_quote: c.est_profit_quote, trade_size: c.trade_size,
  };
}

/**
 * Ein Durchlauf der Hauptschleife:
 * 1. Preise aller Adapter holen  2. Börsenpreise speichern
 * 3. Alle Routen bewerten: Cross-Paare über Märkte hinweg und Dreiecke innerhalb einer Börse
 * 4. Routen über der Schwelle als Gelegenheit anlegen/aktualisieren, Entwürfe und Auto-Paper-Deals erzeugen
 * 5. Abgelaufene Gelegenheiten schließen  6. Freigegebene Deals und Nachrichten abarbeiten
 * 7. Im Sampling-Takt alle bewerteten Routen in die Historie schreiben, stündlich alte Messpunkte löschen
 */
export async function runCycle(
  cfg: Config,
  store: Store,
  adapters: MarketAdapter[],
  markets: Map<string, MarketRow>,
  mailer: ReturnType<typeof createMailer>,
  state: CycleState = newCycleState(),
): Promise<CycleStats> {
  const started = Date.now();
  const now = new Date();
  const adapterErrors: string[] = [];

  // Adapter mit wiederholten Fehlern werden eine Weile ausgesetzt, damit ein gestörter Anbieter
  // weder das Log flutet noch mit Rate-Limits die anderen ausbremst.
  const active = adapters.filter((a) => (state.health.get(a.id)?.skipUntil ?? 0) <= now.getTime());
  const skippedAdapters = adapters.filter((a) => !active.includes(a)).map((a) => a.id);

  const results = await Promise.allSettled(active.map((a) => a.fetchQuotes(wantedSymbols(cfg))));
  const quotes: Quote[] = [];
  results.forEach((r, i) => {
    const adapter = active[i];
    if (r.status === "fulfilled") {
      quotes.push(...r.value);
      const h = state.health.get(adapter.id);
      if (h?.failures) {
        log.info(`Adapter ${adapter.id} liefert wieder Preise`);
        state.health.delete(adapter.id);
      }
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      adapterErrors.push(`${adapter.id}: ${msg}`);
      const pause = recordFailure(state, adapter.id, now.getTime());
      log.warn(`Adapter ${adapter.id} lieferte keine Preise${pause ? `, wird ${Math.round(pause / 1000)} s ausgesetzt` : ""}`, msg);
    }
  });

  // Inserate haben keinen "aktuellen Kurs" pro Markt, nur Börsenpreise landen in latest_prices.
  const exchangePrices: PriceRow[] = quotes.filter((q) => !q.listing_id).map(({ contact_id: _c, ...p }) => p);
  await store.savePrices(exchangePrices, cfg.recordTicks);

  const params = engineParams(cfg);
  // Cross-Routen nur für die konfigurierten Symbole; Kreuz-Paare dienen allein den Dreiecken.
  const crossRoutes = evaluateAllPairs(quotes.filter((q) => cfg.symbols.includes(q.symbol)), markets, params);
  const triangleRoutes = cfg.triangular ? evaluateAllTriangles(quotes, markets, triangleStart(cfg), params) : [];
  const candidates = filterOpportunities([...crossRoutes, ...triangleRoutes], cfg.minNetSpreadBps)
    .sort((a, b) => b.net_spread_bps - a.net_spread_bps);

  let newOpportunities = 0;
  for (const c of candidates) {
    const { row, created } = await store.upsertOpportunity(c, now);
    if (!created) continue;
    newOpportunities++;
    if (c.kind === "triangle") {
      log.info(`Dreieck ${c.symbol} auf ${c.buy_market_id}: brutto ${c.gross_spread_bps} bps, netto ${c.net_spread_bps} bps, ca. ${c.est_profit_quote} bei Einsatz ${c.trade_size}`);
    } else {
      log.info(`Gelegenheit ${c.symbol}: ${c.buy_market_id} ${c.buy_price} → ${c.sell_market_id} ${c.sell_price} | netto ${c.net_spread_bps} bps, ca. ${c.est_profit_quote}`);
    }
    if (c.buy_listing_id || c.sell_listing_id) await createDraftsForOpportunity(store, row, c, cfg.mailFrom);
    if (cfg.autoPaperBps > 0 && c.net_spread_bps >= cfg.autoPaperBps) {
      await store.createDeal({ opportunity_id: row.id, mode: "paper", status: "approved" });
      log.info(`Auto-Paper-Deal für Gelegenheit ${row.id.slice(0, 8)} angelegt`);
    }
  }

  const expired = await store.expireOpportunities(new Date(now.getTime() - cfg.opportunityTtlMs));
  await processApprovedDeals(store, markets, { slippageBps: cfg.slippageBps, transferModel: cfg.transferModel, maxQuoteAgeMs: cfg.maxQuoteAgeMs });
  await processApprovedMessages(store, mailer);

  // Historie: alle bewerteten Börsenrouten, auch die unprofitablen. Inserate sind statisch und bleiben draußen.
  let samples = 0;
  if (cfg.spreadSampleIntervalMs > 0 && now.getTime() - state.lastSampleAt >= cfg.spreadSampleIntervalMs) {
    const ts = now.toISOString();
    const rows = [...crossRoutes, ...triangleRoutes]
      .filter((c) => !c.buy_listing_id && !c.sell_listing_id)
      .map((c) => toSample(c, ts));
    await store.saveSpreadSamples(rows);
    samples = rows.length;
    state.lastSampleAt = now.getTime();
  }
  if (cfg.spreadHistoryDays > 0 && now.getTime() - state.lastCleanupAt >= 3_600_000) {
    const deleted = await store.deleteSpreadSamplesBefore(new Date(now.getTime() - cfg.spreadHistoryDays * 86_400_000));
    if (deleted) log.info(`${deleted} alte Messpunkte der Spread-Historie gelöscht`);
    state.lastCleanupAt = now.getTime();
  }

  return {
    quotes: quotes.length, skippedAdapters, routes: crossRoutes.length + triangleRoutes.length, candidates: candidates.length,
    triangles: triangleRoutes.length, newOpportunities, expired, samples, adapterErrors, durationMs: Date.now() - started,
  };
}

async function main() {
  const cfg = loadConfig();
  log.info(`Worker ${cfg.workerId} startet`, {
    store: cfg.store, adapters: cfg.adapters, exchanges: cfg.adapters.includes("ccxt") ? cfg.exchanges : [],
    symbols: wantedSymbols(cfg), triangular: cfg.triangular, triangleStart: cfg.triangular ? triangleStart(cfg) : null,
    pollIntervalMs: cfg.pollIntervalMs, spreadSampleIntervalMs: cfg.spreadSampleIntervalMs,
    executionMode: cfg.executionMode, mailer: cfg.mailer,
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
  const state = newCycleState(0);

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
      const stats = await runCycle(cfg, store, live, markets, mailer, state);
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
        status: {
          ...stats, adapters: live.map((a) => a.id), symbols: wantedSymbols(cfg), triangular: cfg.triangular,
          minNetSpreadBps: cfg.minNetSpreadBps, autoPaperBps: cfg.autoPaperBps, tradeSizeQuote: cfg.tradeSizeQuote,
          spreadSampleIntervalMs: cfg.spreadSampleIntervalMs, executionMode: cfg.executionMode, mailer: mailer.kind,
        },
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
