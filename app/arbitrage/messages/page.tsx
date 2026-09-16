import { fmtTime } from "@/lib/arbitrage/format";
import { getMessages, type MessageWithContact } from "@/lib/arbitrage/queries";
import { approveMessage, discardMessage } from "../actions";
import { NotConfigured } from "../components/NotConfigured";

export const dynamic = "force-dynamic";

function MessageCard({ m, actions }: { m: MessageWithContact; actions?: boolean }) {
  const inbound = m.direction === "inbound";
  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="badge">{m.thread_tag}</span>
        <span className="text-sm font-medium">{m.subject}</span>
        <span className="text-xs text-[#7c7c9a] ml-auto">{fmtTime(m.sent_at ?? m.created_at)}</span>
      </div>
      <div className="text-xs text-[#9c9cba] mb-2">
        {inbound ? `von ${m.from_email}` : `an ${m.contact?.name ? `${m.contact.name} <${m.to_email}>` : m.to_email}`}
        {m.error && <span className="text-[#f87171] ml-2">Fehler: {m.error}</span>}
      </div>
      <pre>{m.body}</pre>
      {actions && (
        <div className="mt-3 flex gap-2">
          <form action={approveMessage}><input type="hidden" name="message_id" value={m.id} /><button className="btn btn-primary">Freigeben und senden</button></form>
          <form action={discardMessage}><input type="hidden" name="message_id" value={m.id} /><button className="btn btn-danger">Verwerfen</button></form>
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, items, actions }: { title: string; hint: string; items: MessageWithContact[]; actions?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title} <span className="text-[#7c7c9a]">({items.length})</span></h2>
      {items.length === 0 ? <p className="text-sm text-[#7c7c9a]">{hint}</p> : items.map((m) => <MessageCard key={m.id} m={m} actions={actions} />)}
    </section>
  );
}

export default async function MessagesPage() {
  const messages = await getMessages();
  if (!messages) return <NotConfigured />;
  const by = (s: MessageWithContact["status"]) => messages.filter((m) => m.status === s);

  return (
    <>
      <p className="text-sm text-[#9c9cba]">
        Der Worker legt für Gelegenheiten mit Inserat-Beteiligung Entwürfe an. Nichts wird ohne Freigabe verschickt.
        Antworten werden über die Kennung im Betreff (z. B. [SIG-4F2A9C]) per IMAP zugeordnet.
      </p>
      <Section title="Entwürfe" hint="Keine Entwürfe. Sie entstehen, wenn ein Inserat mit Kontakt Teil einer Gelegenheit ist." items={by("draft")} actions />
      <Section title="Fehlgeschlagen" hint="Keine Fehler." items={by("failed")} actions />
      <Section title="Freigegeben, wartet auf Versand" hint="Nichts in der Warteschlange." items={by("approved")} />
      <Section title="Antworten" hint="Noch keine Antworten (IMAP_HOST im Worker gesetzt?)." items={by("received")} />
      <Section title="Gesendet" hint="Noch nichts gesendet." items={by("sent")} />
    </>
  );
}
