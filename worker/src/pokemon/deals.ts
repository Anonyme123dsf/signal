import type { CardRef, DealParams, DealResult, Offer } from "./types.ts";

/** Referenzwert einer Karte: bevorzugt der Trendpreis, sonst 30-Tage-Schnitt, sonst Durchschnittsverkauf. */
export function referenceValue(card: CardRef): number | null {
  const p = card.prices;
  return p.trend ?? p.avg30 ?? p.averageSell ?? null;
}

/**
 * Prüft, ob der Markt für eine Karte stabil genug ist, dass sich ein Weiterverkauf lohnt.
 * Bedingungen: Wert über der Bagatellgrenze, ein 30-Tage-Schnitt existiert (die Karte wird
 * überhaupt gehandelt), und Trend und Schnitt liegen nah beieinander (kein Absturz im Gange).
 */
export function isLiquid(card: CardRef, ref: number, p: DealParams): boolean {
  if (ref < p.minValueEur) return false;
  const avg30 = card.prices.avg30;
  if (avg30 == null || avg30 <= 0) return false;
  const trend = card.prices.trend ?? avg30;
  const gap = Math.abs(trend - avg30) / avg30 * 100;
  return gap <= p.maxTrendGapPct;
}

/**
 * Bewertet ein Angebot gegen den bekannten Marktwert. Ein Deal ist es nur, wenn der Preis
 * klar unter dem Wert liegt, nach Gebühren ein Gewinn bleibt und die Karte nachweislich
 * gehandelt wird. So werden günstige, aber unverkäufliche Karten aussortiert.
 */
export function evaluateOffer(offer: Offer, card: CardRef | null, p: DealParams): DealResult {
  const base: Omit<DealResult, "verdict" | "reason"> = {
    offer, card, referenceEur: null, discountPct: null, estProfitEur: null, liquidityOk: false,
  };
  if (!card) return { ...base, verdict: "no_match", reason: "Keine passende Karte in der Referenz gefunden" };

  const ref = referenceValue(card);
  if (ref == null || ref <= 0) {
    return { ...base, card, verdict: "no_price", reason: "Für diese Karte gibt es keinen Cardmarket-Preis" };
  }

  const cost = offer.price + (offer.shipping ?? 0);
  const discountPct = round((ref - cost) / ref * 100, 1);
  const estProfitEur = round(ref * (1 - p.sellFeePct / 100) - cost, 2);
  const liquidityOk = isLiquid(card, ref, p);
  const result = { ...base, card, referenceEur: round(ref, 2), discountPct, estProfitEur, liquidityOk };

  if (discountPct < p.minDiscountPct) {
    return { ...result, verdict: "skip", reason: `Nur ${discountPct}% unter Wert (nötig ${p.minDiscountPct}%)` };
  }
  if (estProfitEur <= 0) {
    return { ...result, verdict: "skip", reason: `Nach Gebühren kein Gewinn (${estProfitEur} EUR)` };
  }
  if (!liquidityOk) {
    return { ...result, verdict: "watch", reason: `Günstig, aber Nachfrage oder Preis unsicher (Wert ${round(ref, 2)} EUR)` };
  }
  return { ...result, verdict: "deal", reason: `${discountPct}% unter Wert, ca. ${estProfitEur} EUR Gewinn nach Gebühren` };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
