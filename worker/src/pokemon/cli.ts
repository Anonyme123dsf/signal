import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import "dotenv/config";
import { createReference } from "./reference.ts";
import { scanOffers } from "./scan.ts";
import type { DealParams, DealResult, Offer } from "./types.ts";

/**
 * Kommandozeilen-Werkzeug: prüft Pokémon-Angebote gegen den bekannten Cardmarket-Wert.
 *
 *   npm run pokemon -- --demo
 *   npm run pokemon -- --card "Charizard" --number 4 --price 150 --shipping 5
 *   npm run pokemon -- --file angebote.json
 *   npm run pokemon -- --file angebote.json --min-discount 25 --json
 *
 * Datei-Format (JSON): eine Liste von { query, price, set?, number?, shipping?, url?, title? }.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      demo: { type: "boolean", default: false },
      card: { type: "string" },
      set: { type: "string" },
      number: { type: "string" },
      price: { type: "string" },
      shipping: { type: "string" },
      url: { type: "string" },
      file: { type: "string" },
      "min-discount": { type: "string" },
      "min-value": { type: "string" },
      "sell-fee": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    printUsage();
    return;
  }

  const params: DealParams = {
    minDiscountPct: numOpt(values["min-discount"], 20),
    minValueEur: numOpt(values["min-value"], 5),
    sellFeePct: numOpt(values["sell-fee"], 5),
    maxTrendGapPct: 30,
  };

  let offers: Offer[];
  if (values.file) {
    const raw = JSON.parse(await readFile(values.file, "utf8"));
    if (!Array.isArray(raw)) throw new Error("Die Datei muss eine JSON-Liste von Angeboten enthalten");
    offers = raw.map(normalizeOffer);
  } else if (values.demo) {
    offers = DEMO_OFFERS;
  } else if (values.card && values.price) {
    offers = [normalizeOffer(values)];
  } else {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const reference = createReference(Boolean(values.demo));
  const results = await scanOffers(offers, reference, params);

  if (values.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    printTable(results, params);
  }
}

const DEMO_OFFERS: Offer[] = [
  { query: "Charizard", number: "4", price: 150, shipping: 5, title: "Charizard Base Set, gespielt", url: "https://example.org/1" },
  { query: "Blastoise", number: "2", price: 115, shipping: 5, title: "Blastoise Base Set", url: "https://example.org/2" },
  { query: "Pikachu", number: "25", price: 2, shipping: 2, title: "Pikachu Vivid Voltage", url: "https://example.org/3" },
  { query: "Gyarados", number: "54", price: 6, shipping: 3, title: "Gyarados Evolutions", url: "https://example.org/4" },
  { query: "Mewtwo", price: 40, shipping: 5, title: "Karte nicht in der Referenz", url: "https://example.org/5" },
];

interface RawOfferInput {
  query?: string; card?: string; set?: string; number?: string | number;
  price?: string | number; shipping?: string | number; url?: string; title?: string;
}

function normalizeOffer(o: RawOfferInput): Offer {
  const query = (o.query ?? o.card ?? "").toString().trim();
  const price = Number(o.price);
  if (!query) throw new Error("Ein Angebot braucht ein Feld 'query' oder 'card'");
  if (!Number.isFinite(price)) throw new Error(`Ungültiger Preis bei "${query}"`);
  return {
    query, set: o.set?.toString(), number: o.number != null ? String(o.number) : undefined,
    price, shipping: o.shipping != null ? Number(o.shipping) : undefined,
    url: o.url, title: o.title,
  };
}

const LABEL: Record<DealResult["verdict"], string> = {
  deal: "DEAL ", watch: "beob.", skip: "  -  ", no_match: "  ?  ", no_price: "  ?  ",
};

function printTable(results: DealResult[], params: DealParams) {
  const money = (n: number | null) => (n == null ? "-" : `${n.toFixed(2)} EUR`);
  const pct = (n: number | null) => (n == null ? "-" : `${n.toFixed(1)}%`);
  console.log(`\nPokémon-Deal-Prüfer  (Mindestrabatt ${params.minDiscountPct}%, Gebühr ${params.sellFeePct}%, Bagatellgrenze ${params.minValueEur} EUR)\n`);
  const deals = results.filter((r) => r.verdict === "deal");
  for (const r of results) {
    const name = r.card ? `${r.card.name} (${r.card.setName} ${r.card.number})` : r.offer.title || r.offer.query;
    const cost = r.offer.price + (r.offer.shipping ?? 0);
    console.log(`[${LABEL[r.verdict]}] ${name}`);
    console.log(`         Angebot ${money(cost)}  |  Wert ${money(r.referenceEur)}  |  Rabatt ${pct(r.discountPct)}  |  Gewinn ${money(r.estProfitEur)}`);
    console.log(`         ${r.reason}${r.offer.url ? `  →  ${r.offer.url}` : ""}`);
  }
  const profit = deals.reduce((s, r) => s + (r.estProfitEur ?? 0), 0);
  console.log(`\n${deals.length} Deal(s) von ${results.length} Angeboten, möglicher Gewinn zusammen ca. ${profit.toFixed(2)} EUR.\n`);
}

function numOpt(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Ungültige Zahl: ${v}`);
  return n;
}

function printUsage() {
  console.log(`Pokémon-Deal-Prüfer

  npm run pokemon -- --demo
      Vorführung mit festen Beispielpreisen, ohne Internet.

  npm run pokemon -- --card "Charizard" --number 4 --price 150 --shipping 5
      Ein einzelnes Angebot gegen den echten Cardmarket-Wert prüfen.

  npm run pokemon -- --file angebote.json
      Viele Angebote aus einer JSON-Datei prüfen.

  Optionen:
    --min-discount <zahl>   Mindestrabatt in Prozent (Standard 20)
    --min-value <zahl>      Karten unter diesem Wert ignorieren (Standard 5)
    --sell-fee <zahl>       Verkaufsgebühr in Prozent (Standard 5)
    --json                  Ergebnis als JSON ausgeben
`);
}

main().catch((err) => {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
