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

/** Mittelkurse in EUR. Kreuz-Paare wie ETH/BTC werden daraus abgeleitet, damit Dreiecke konsistent sind. */
const BASE_MID_EUR: Record<string, number> = { EUR: 1, BTC: 60000, ETH: 3000, SOL: 150 };
/** Übliche Orientierung: Die Quote-Währung steht in dieser Liste vor der Basis (ETH/BTC ja, BTC/ETH nein). */
const ASSET_ORDER = ["EUR", "BTC", "ETH", "SOL"];
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
  /** Aktueller Mittelkurs je Asset in EUR (Random Walk). */
  private mid: Record<string, number> = { ...BASE_MID_EUR };
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

  /**
   * Mittelkurs eines Paars aus den Asset-Kursen; null, wenn ein Asset unbekannt ist
   * oder die Orientierung unüblich wäre (es gibt ETH/BTC, aber kein BTC/ETH).
   */
  private pairMid(symbol: string): number | null {
    const [base, quote] = symbol.split("/");
    if (!base || !quote || this.mid[base] === undefined || this.mid[quote] === undefined) return null;
    if (ASSET_ORDER.indexOf(quote) >= ASSET_ORDER.indexOf(base)) return null;
    return this.mid[base] / this.mid[quote];
  }

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const ts = new Date().toISOString();
    const out: Quote[] = [];
    for (const asset of Object.keys(this.mid)) {
      if (asset !== "EUR") this.mid[asset] *= 1 + 0.0005 * this.gauss();
    }
    for (const symbol of symbols) {
      const pairMid = this.pairMid(symbol);
      if (pairMid === null) continue;
      for (const m of this.marketRows) {
        const key = `${m.id}|${symbol}`;
        let off = this.offset[key] ?? 0;
        off += -0.2 * off + 0.0008 * this.gauss();
        if (this.rand() < 0.04) off += (this.rand() < 0.5 ? -1 : 1) * 0.006;
        this.offset[key] = off;
        const mid = pairMid * (1 + off);
        const halfSpread = 0.0003;
        out.push({
          market_id: m.id,
          symbol,
          bid: roundSig(mid * (1 - halfSpread)),
          ask: roundSig(mid * (1 + halfSpread)),
          bid_size: round(0.5 + this.rand() * 4, 4),
          ask_size: round(0.5 + this.rand() * 4, 4),
          last: roundSig(mid),
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

/** Rundet auf 7 signifikante Stellen, passt für 60000 (BTC/EUR) wie für 0.05 (ETH/BTC). */
function roundSig(n: number): number {
  if (n === 0) return 0;
  const digits = 7 - Math.ceil(Math.log10(Math.abs(n)));
  return round(n, Math.max(0, digits));
}
