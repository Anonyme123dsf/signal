import nodemailer from "nodemailer";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { Store } from "../store/types.ts";

export interface OutgoingMail {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: string;
  send(mail: OutgoingMail): Promise<{ providerMessageId: string | null }>;
}

/** Gibt Mails nur im Log aus. Für Entwicklung. */
export class ConsoleMailer implements Mailer {
  readonly kind = "console";
  async send(mail: OutgoingMail) {
    log.info(`[MAIL] an ${mail.to} | ${mail.subject}\n${mail.text}`);
    return { providerMessageId: `console-${Date.now()}` };
  }
}

/** Versand über die Resend-HTTP-API. Braucht eine verifizierte eigene Domain. */
export class ResendMailer implements Mailer {
  readonly kind = "resend";
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("RESEND_API_KEY fehlt");
  }
  async send(mail: OutgoingMail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend antwortete ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id?: string };
    return { providerMessageId: data.id ?? null };
  }
}

/** Versand über ein eigenes Postfach per SMTP. */
export class SmtpMailer implements Mailer {
  readonly kind = "smtp";
  private readonly transport;
  constructor(smtp: Config["smtp"]) {
    if (!smtp.host) throw new Error("SMTP_HOST fehlt");
    this.transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }
  async send(mail: OutgoingMail) {
    const info = await this.transport.sendMail(mail);
    return { providerMessageId: info.messageId ?? null };
  }
}

export function createMailer(cfg: Config): Mailer {
  switch (cfg.mailer) {
    case "resend": return new ResendMailer(cfg.resendApiKey);
    case "smtp": return new SmtpMailer(cfg.smtp);
    default: return new ConsoleMailer();
  }
}

/** Verschickt alle im Dashboard freigegebenen Entwürfe. */
export async function processApprovedMessages(store: Store, mailer: Mailer): Promise<void> {
  const approved = await store.listMessages("approved");
  for (const m of approved) {
    try {
      const { providerMessageId } = await mailer.send({ to: m.to_email, from: m.from_email, subject: m.subject, text: m.body });
      await store.updateMessage(m.id, { status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), error: null });
      log.info(`Nachricht ${m.thread_tag} an ${m.to_email} versendet (${mailer.kind})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await store.updateMessage(m.id, { status: "failed", error: msg });
      log.warn(`Versand ${m.thread_tag} fehlgeschlagen: ${msg}`);
    }
  }
}
