import type { DealParams, DealResult, Offer } from "./types.ts";
import { evaluateOffer } from "./deals.ts";
import type { PriceReference } from "./reference.ts";

const VERDICT_ORDER = { deal: 0, watch: 1, no_price: 2, no_match: 3, skip: 4 } as const;

/**
 * Prüft eine Liste von Angeboten gegen die Referenz. Nachschläge laufen mit begrenzter
 * Nebenläufigkeit, um die kostenlose API nicht zu überlasten. Sortiert: echte Deals zuerst,
 * darin nach höchstem Gewinn.
 */
export async function scanOffers(offers: Offer[], reference: PriceReference, params: DealParams, concurrency = 4): Promise<DealResult[]> {
  const results: DealResult[] = new Array(offers.length);
  let next = 0;
  async function worker() {
    while (next < offers.length) {
      const i = next++;
      const offer = offers[i];
      try {
        const card = await reference.lookup(offer);
        results[i] = evaluateOffer(offer, card, params);
      } catch (err) {
        results[i] = {
          offer, card: null, referenceEur: null, discountPct: null, estProfitEur: null, liquidityOk: false,
          verdict: "no_match", reason: `Nachschlag fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, offers.length) }, worker));
  return results.sort((a, b) => {
    const v = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    return v !== 0 ? v : (b.estProfitEur ?? -Infinity) - (a.estProfitEur ?? -Infinity);
  });
}
