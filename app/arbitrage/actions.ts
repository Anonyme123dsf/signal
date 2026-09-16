"use server";

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/arbitrage/supabase";

function db() {
  const client = getServiceClient();
  if (!client) throw new Error("Supabase ist nicht konfiguriert (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  return client;
}

function requireString(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`Feld "${key}" fehlt`);
  return v.trim();
}

/** Legt für eine offene Gelegenheit einen freigegebenen Paper-Deal an. Der Worker führt ihn im nächsten Zyklus aus. */
export async function createPaperDeal(form: FormData) {
  const opportunityId = requireString(form, "opportunity_id");
  const { error } = await db().from("deals").insert({ opportunity_id: opportunityId, mode: "paper", status: "approved" });
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage");
  revalidatePath("/arbitrage/deals");
}

export async function dismissOpportunity(form: FormData) {
  const id = requireString(form, "opportunity_id");
  const { error } = await db().from("opportunities").update({ status: "dismissed" }).eq("id", id).eq("status", "open");
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage");
}

/** Freigabe eines Entwurfs. Erst danach verschickt der Worker die Nachricht. */
export async function approveMessage(form: FormData) {
  const id = requireString(form, "message_id");
  const { error } = await db().from("messages").update({ status: "approved", error: null }).eq("id", id).in("status", ["draft", "failed"]);
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage/messages");
}

export async function discardMessage(form: FormData) {
  const id = requireString(form, "message_id");
  const { error } = await db().from("messages").update({ status: "discarded" }).eq("id", id).in("status", ["draft", "failed"]);
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage/messages");
}

/** Erfasst ein Inserat samt Kontakt. Bestehende Kontakte werden über die E-Mail-Adresse wiederverwendet. */
export async function addListing(form: FormData) {
  const client = db();
  const symbol = requireString(form, "symbol").toUpperCase();
  const side = requireString(form, "side");
  if (side !== "sell" && side !== "buy") throw new Error("Seite muss sell oder buy sein");
  const price = Number(requireString(form, "price").replace(",", "."));
  const quantity = Number(requireString(form, "quantity").replace(",", "."));
  if (!(price > 0) || !(quantity > 0)) throw new Error("Preis und Menge müssen größer als 0 sein");
  const name = String(form.get("contact_name") ?? "").trim();
  const email = String(form.get("contact_email") ?? "").trim().toLowerCase();
  const externalUrl = String(form.get("external_url") ?? "").trim() || null;

  let contactId: string | null = null;
  if (email) {
    const existing = await client.from("contacts").select("id").eq("email", email).limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      contactId = existing.data.id as string;
    } else {
      const created = await client.from("contacts").insert({ name: name || email, email, market_id: "listings" }).select("id").single();
      if (created.error) throw new Error(created.error.message);
      contactId = created.data.id as string;
    }
  }

  // Der Markt "listings" wird sonst vom Worker angelegt; hier sicherstellen, falls das Dashboard zuerst benutzt wird.
  const market = await client.from("markets").upsert(
    { id: "listings", kind: "listings", name: "Inserate (manuell erfasst)", taker_fee_bps: 0, withdrawal_fees: {}, enabled: true },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (market.error) throw new Error(market.error.message);

  const { error } = await client.from("listings").insert({
    market_id: "listings", symbol, side, price, quantity, contact_id: contactId, external_url: externalUrl, status: "active",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage/listings");
  revalidatePath("/arbitrage");
}

export async function closeListing(form: FormData) {
  const id = requireString(form, "listing_id");
  const { error } = await db().from("listings").update({ status: "closed" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/arbitrage/listings");
}
