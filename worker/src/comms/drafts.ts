import { randomBytes } from "node:crypto";
import type { ContactRow, ListingRow, OpportunityRow } from "../../../shared/types.ts";
import type { Candidate } from "../engine/spread.ts";
import { log } from "../log.ts";
import type { NewMessage, Store } from "../store/types.ts";

export function makeThreadTag(): string {
  return `SIG-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export const THREAD_TAG_RE = /SIG-[0-9A-F]{6}/i;

function fmt(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n);
}

function quoteCurrency(symbol: string): string {
  return symbol.split("/")[1] ?? "";
}

/** Anfrage an jemanden, der etwas anbietet (wir kaufen). */
export function draftSellerInquiry(opp: OpportunityRow, listing: ListingRow, contact: ContactRow, tag: string) {
  const cur = quoteCurrency(opp.symbol);
  const qty = Math.min(Number(opp.trade_size), Number(listing.quantity));
  const subject = `Anfrage zu Ihrem Angebot ${opp.symbol} [${tag}]`;
  const body = [
    `Hallo ${contact.name},`,
    ``,
    `ich habe Ihr Angebot über ${fmt(Number(listing.quantity))} ${opp.symbol} zu ${fmt(Number(listing.price))} ${cur} gesehen` +
      (listing.external_url ? ` (${listing.external_url})` : "") + `.`,
    `Ich würde ${fmt(qty)} davon zum angebotenen Preis übernehmen und kann kurzfristig abwickeln.`,
    ``,
    `Ist das Angebot noch verfügbar? Wenn ja, wie möchten Sie Zahlung und Übergabe abwickeln?`,
    ``,
    `Bitte lassen Sie die Kennung ${tag} im Betreff, damit ich Ihre Antwort zuordnen kann.`,
    ``,
    `Viele Grüße`,
    ``,
    `Hinweis: Diese Nachricht wurde von einem System vorbereitet und vor dem Versand von einer Person geprüft und freigegeben.`,
  ].join("\n");
  return { subject, body };
}

/** Angebot an jemanden, der etwas sucht (wir verkaufen). */
export function draftBuyerOffer(opp: OpportunityRow, listing: ListingRow, contact: ContactRow, tag: string) {
  const cur = quoteCurrency(opp.symbol);
  const qty = Math.min(Number(opp.trade_size), Number(listing.quantity));
  const subject = `Angebot zu Ihrem Gesuch ${opp.symbol} [${tag}]`;
  const body = [
    `Hallo ${contact.name},`,
    ``,
    `Sie suchen ${fmt(Number(listing.quantity))} ${opp.symbol} zu ${fmt(Number(listing.price))} ${cur}` +
      (listing.external_url ? ` (${listing.external_url})` : "") + `.`,
    `Ich kann Ihnen ${fmt(qty)} zu diesem Preis anbieten und kurzfristig liefern.`,
    ``,
    `Besteht noch Interesse? Dann stimmen wir gern Zahlung und Übergabe ab.`,
    ``,
    `Bitte lassen Sie die Kennung ${tag} im Betreff, damit ich Ihre Antwort zuordnen kann.`,
    ``,
    `Viele Grüße`,
    ``,
    `Hinweis: Diese Nachricht wurde von einem System vorbereitet und vor dem Versand von einer Person geprüft und freigegeben.`,
  ].join("\n");
  return { subject, body };
}

/**
 * Legt für eine neue Gelegenheit mit Inserat-Beteiligung Nachrichtenentwürfe an.
 * Entwürfe werden nie automatisch versendet: Erst nach Freigabe im Dashboard
 * (Status "approved") verschickt der Worker sie.
 */
export async function createDraftsForOpportunity(
  store: Store,
  opp: OpportunityRow,
  cand: Candidate,
  fromEmail: string,
): Promise<number> {
  const sides: Array<{ listingId: string | null; contactId: string | null; kind: "seller" | "buyer" }> = [
    { listingId: cand.buy_listing_id, contactId: cand.buy_contact_id, kind: "seller" },
    { listingId: cand.sell_listing_id, contactId: cand.sell_contact_id, kind: "buyer" },
  ];
  let created = 0;
  for (const side of sides) {
    if (!side.listingId || !side.contactId) continue;
    if (await store.hasOutboundMessageForListing(side.listingId)) continue;
    const [listing, contact] = await Promise.all([store.getListing(side.listingId), store.getContact(side.contactId)]);
    if (!listing || !contact) continue;
    const tag = makeThreadTag();
    const draft = side.kind === "seller"
      ? draftSellerInquiry(opp, listing, contact, tag)
      : draftBuyerOffer(opp, listing, contact, tag);
    const msg: NewMessage = {
      deal_id: null, opportunity_id: opp.id, contact_id: contact.id, listing_id: listing.id, direction: "outbound", status: "draft",
      subject: draft.subject, body: draft.body, to_email: contact.email, from_email: fromEmail,
      provider_message_id: null, thread_tag: tag, error: null, sent_at: null,
    };
    await store.createMessage(msg);
    created++;
    log.info(`Entwurf ${tag} an ${contact.email} (${side.kind}) für ${opp.symbol} angelegt, wartet auf Freigabe`);
  }
  return created;
}
