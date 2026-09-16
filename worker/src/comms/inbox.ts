import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ImapConfig } from "../config.ts";
import { log } from "../log.ts";
import type { NewMessage, Store } from "../store/types.ts";
import { THREAD_TAG_RE } from "./drafts.ts";

/**
 * Holt ungelesene Mails per IMAP, ordnet sie über die Kennung im Betreff
 * (z. B. [SIG-4F2A9C]) der ursprünglichen Nachricht zu und speichert sie als
 * eingehende Nachricht. Nur zugeordnete Mails werden als gelesen markiert.
 */
export async function pollInbox(store: Store, imap: ImapConfig): Promise<number> {
  const client = new ImapFlow({
    host: imap.host, port: imap.port, secure: imap.port === 993,
    auth: { user: imap.user, pass: imap.pass }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let stored = 0;
  try {
    const uids = await client.search({ seen: false });
    if (!uids || uids.length === 0) return 0;
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true })) {
      const subject = msg.envelope?.subject ?? "";
      const tag = THREAD_TAG_RE.exec(subject)?.[0]?.toUpperCase();
      if (!tag) continue;
      const parent = await store.findOutboundByThreadTag(tag);
      if (!parent) continue;
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const fromAddr = parsed.from?.value[0]?.address ?? msg.envelope?.from?.[0]?.address ?? "";
      const inbound: NewMessage = {
        deal_id: parent.deal_id, opportunity_id: parent.opportunity_id, contact_id: parent.contact_id,
        listing_id: parent.listing_id, direction: "inbound", status: "received", subject, body: (parsed.text ?? "").trim(),
        to_email: parent.from_email, from_email: fromAddr,
        provider_message_id: parsed.messageId ?? null, thread_tag: tag, error: null,
        sent_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
      };
      await store.createMessage(inbound);
      await client.messageFlagsAdd({ uid: String(msg.uid) }, ["\\Seen"], { uid: true });
      stored++;
      log.info(`Antwort auf ${tag} von ${fromAddr} gespeichert`);
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return stored;
}
