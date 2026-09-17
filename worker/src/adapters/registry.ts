import type { Config } from "../config.ts";
import type { Store } from "../store/types.ts";
import { CcxtAdapter } from "./ccxt.ts";
import { ListingsAdapter } from "./listings.ts";
import { MockAdapter } from "./mock.ts";
import type { MarketAdapter } from "./types.ts";

export function buildAdapters(cfg: Config, store: Store): MarketAdapter[] {
  const adapters: MarketAdapter[] = [];
  for (const name of cfg.adapters) {
    switch (name) {
      case "ccxt":
        for (const ex of cfg.exchanges) adapters.push(new CcxtAdapter(ex));
        break;
      case "mock":
        adapters.push(new MockAdapter(cfg.mockMarkets, cfg.mockSeed));
        break;
      case "listings":
        adapters.push(new ListingsAdapter(store));
        break;
      default:
        throw new Error(`Unbekannter Adapter "${name}" in ADAPTERS`);
    }
  }
  if (!adapters.length) throw new Error("Keine Adapter konfiguriert (ADAPTERS ist leer)");
  return adapters;
}
