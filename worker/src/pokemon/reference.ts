import type { CardPrices, CardRef, Offer } from "./types.ts";
import { log } from "../log.ts";

/** Quelle für den bekannten Marktwert einer Karte. */
export interface PriceReference {
  readonly name: string;
  lookup(offer: Offer): Promise<CardRef | null>;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Echte Referenz über die kostenlose Pokémon-TCG-API (pokemontcg.io).
 * Liefert Cardmarket-Preise in Euro, ideal für den europäischen Markt.
 * Ein API-Schlüssel ist optional und erhöht nur das Anfragelimit (POKEMONTCG_API_KEY).
 */
export class PokemonTcgReference implements PriceReference {
  readonly name = "pokemontcg.io";
  constructor(private readonly apiKey = process.env.POKEMONTCG_API_KEY ?? "", private readonly baseUrl = "https://api.pokemontcg.io/v2") {}

  private buildQuery(offer: Offer): string {
    const parts = [`name:"${offer.query.replace(/"/g, "")}"`];
    if (offer.set) parts.push(`set.id:${offer.set}`);
    if (offer.number) parts.push(`number:${offer.number}`);
    return parts.join(" ");
  }

  async lookup(offer: Offer): Promise<CardRef | null> {
    const url = `${this.baseUrl}/cards?q=${encodeURIComponent(this.buildQuery(offer))}&pageSize=1&orderBy=-set.releaseDate`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["X-Api-Key"] = this.apiKey;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Pokémon-TCG-API antwortete ${res.status}`);
    const body = (await res.json()) as { data?: RawCard[] };
    const raw = body.data?.[0];
    if (!raw) return null;
    return toCardRef(raw);
  }
}

interface RawCard {
  id: string;
  name: string;
  number?: string;
  set?: { name?: string };
  images?: { small?: string; large?: string };
  cardmarket?: { url?: string; prices?: Record<string, number> };
}

function toCardRef(raw: RawCard): CardRef {
  const cm = raw.cardmarket?.prices ?? {};
  const prices: CardPrices = {
    low: num(cm.lowPrice), trend: num(cm.trendPrice), avg7: num(cm.avg7), avg30: num(cm.avg30),
    averageSell: num(cm.averageSellPrice),
  };
  return {
    id: raw.id, name: raw.name, setName: raw.set?.name ?? "", number: raw.number ?? "",
    prices, imageUrl: raw.images?.small ?? null, url: raw.cardmarket?.url ?? null,
  };
}

/**
 * Feste Beispielkarten für Tests und die Vorführung ohne Internet.
 * Die Preise sind erfundene, aber realistische Cardmarket-Werte.
 */
export class DemoReference implements PriceReference {
  readonly name = "demo";
  private readonly cards: CardRef[] = [
    card("base1-4", "Charizard", "Base Set", "4", { low: 180, trend: 240, avg7: 235, avg30: 245, averageSell: 250 }),
    card("swsh4-25", "Pikachu", "Vivid Voltage", "25", { low: 3, trend: 5, avg7: 5, avg30: 5, averageSell: 6 }),
    card("base1-2", "Blastoise", "Base Set", "2", { low: 90, trend: 120, avg7: 118, avg30: 122, averageSell: 125 }),
    // Instabiler Markt: Trend weit unter dem 30-Tage-Schnitt (Preis fällt gerade).
    card("xy12-54", "Gyarados", "Evolutions", "54", { low: 1, trend: 8, avg7: 12, avg30: 20, averageSell: 15 }),
  ];

  async lookup(offer: Offer): Promise<CardRef | null> {
    const q = offer.query.toLowerCase();
    return this.cards.find((c) => c.name.toLowerCase().includes(q) && (!offer.number || c.number === offer.number)) ?? null;
  }
}

function card(id: string, name: string, setName: string, number: string, prices: CardPrices): CardRef {
  return { id, name, setName, number, prices, imageUrl: null, url: `https://www.cardmarket.com/de/Pokemon/${id}` };
}

export function createReference(demo: boolean): PriceReference {
  if (demo) {
    log.info("Pokémon: Demo-Referenz (feste Beispielpreise, kein Internet nötig)");
    return new DemoReference();
  }
  return new PokemonTcgReference();
}
