/** Preise einer Karte in Euro, wie sie Cardmarket über die Pokémon-TCG-API liefert. */
export interface CardPrices {
  low: number | null;
  trend: number | null;
  avg7: number | null;
  avg30: number | null;
  averageSell: number | null;
}

/** Eine Karte aus der Referenzquelle, mit ihrem bekannten Marktwert. */
export interface CardRef {
  id: string;
  name: string;
  setName: string;
  number: string;
  prices: CardPrices;
  imageUrl: string | null;
  url: string | null;
}

/** Ein Angebot, das geprüft werden soll, z. B. ein eBay-Inserat oder eine manuelle Eingabe. */
export interface Offer {
  /** Suchtext für die Referenz, z. B. "Charizard". */
  query: string;
  /** Optionaler Set-Filter (Pokémon-TCG-Set-Id, z. B. "base1"). */
  set?: string;
  /** Optionale Sammlernummer, z. B. "4". */
  number?: string;
  /** Geforderter Preis in Euro. */
  price: number;
  /** Versandkosten in Euro, falls bekannt. */
  shipping?: number;
  /** Link zum Angebot. */
  url?: string;
  /** Ursprünglicher Titel des Angebots. */
  title?: string;
}

export interface DealParams {
  /** Mindestrabatt gegenüber dem Referenzwert in Prozent, ab dem es ein Deal ist. */
  minDiscountPct: number;
  /** Karten unter diesem Wert werden ignoriert, ein Flip lohnt sich nicht. */
  minValueEur: number;
  /** Verkaufsgebühr des Marktplatzes in Prozent, die beim Weiterverkauf abgeht. */
  sellFeePct: number;
  /** Stabilitätsgrenze: Weicht der Trend stärker als das vom 30-Tage-Schnitt ab, gilt der Markt als unruhig. */
  maxTrendGapPct: number;
}

export type Verdict = "deal" | "watch" | "skip" | "no_match" | "no_price";

export interface DealResult {
  offer: Offer;
  card: CardRef | null;
  /** Zugrunde gelegter Marktwert in Euro (Trend, sonst 30-Tage-Schnitt, sonst Durchschnittsverkauf). */
  referenceEur: number | null;
  /** Rabatt des Angebots gegenüber dem Referenzwert in Prozent. */
  discountPct: number | null;
  /** Geschätzter Gewinn beim Weiterverkauf nach Gebühren, in Euro. */
  estProfitEur: number | null;
  /** Gibt es genug Nachfrage und einen stabilen Preis, dass sich ein Flip lohnt? */
  liquidityOk: boolean;
  verdict: Verdict;
  reason: string;
}
