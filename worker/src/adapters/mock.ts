import type { MarketRow } from "../../../shared/types.ts";
import type { MarketAdapter, Quote } from "./types.ts";

/** Deterministischer Zufall (mulberry32), damit Demos reproduzierbar sind. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_MID: Record<string, number> = { "BTC/EUR": 60000, "ETH/EUR": 3000, "SOL/EUR": 150 };
const FEES_BPS = [10, 25, 40, 60];

/**
 * Synthetische Märkte für Entwicklung und Tests. Jeder Markt hat einen
 * mittelwertrückkehrenden Aufschlag auf den gemeinsamen Mittelkurs; gelegentliche
 * Sprünge erzeugen Arbitrage-Gelegenheiten, die nach ein paar Ticks wieder
 * verschwinden. So lässt sich die ganze Pipeline ohne Börsenzugang durchspielen.
 */
export class MockAdapter implements MarketAdapter {
  readonly id = "mock";
  private readonly rand: () => number;
  private readonly marketRows: MarketRow[];
  private mid: Record<string, number> = {};
  private offset: Record<string, number> = {};

  constructor(count: number, seed: number) {
    this.rand = rng(seed);
    this.marketRows = Array.from({ length: count }, (_, i) => ({
      id: `mock_${String.fromCharCode(97 + i)}`,
      kind: "mock",
      name: `Mock-Börse ${String.fromCharCode(65 + i)}`,
      taker_fee_bps: FEES_BPS[i % FEES_BPS.length],
      withdrawal_fees: { BTC: 0.0002, ETH: 0.002 },
      enabled: true,
    }));
  }

  markets(): MarketRow[] {
    return this.marketRows;
  }

  async init(): Promise<void> {}

  private gauss(): number {
    const u = 1 - this.rand();
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const ts = new Date().toISOString();
    const out: Quote[] = [];
    for (const symbol of symbols) {
      this.mid[symbol] = (this.mid[symbol] ?? BASE_MID[symbol] ?? 100) * (1 + 0.0005 * this.gauss());
      for (const m of this.marketRows) {
        const key = `${m.id}|${symbol}`;
        let off = this.offset[key] ?? 0;
        off += -0.2 * off + 0.0008 * this.gauss();
        if (this.rand() < 0.04) off += (this.rand() < 0.5 ? -1 : 1) * 0.006;
        this.offset[key] = off;
        const mid = this.mid[symbol] * (1 + off);
        const halfSpread = 0.0003;
        out.push({
          market_id: m.id,
          symbol,
          bid: round(mid * (1 - halfSpread), 2),
          ask: round(mid * (1 + halfSpread), 2),
          bid_size: round(0.5 + this.rand() * 4, 4),
          ask_size: round(0.5 + this.rand() * 4, 4),
          last: round(mid, 2),
          ts,
          listing_id: null,
        });
      }
    }
    return out;
  }

  async close(): Promise<void> {}
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
