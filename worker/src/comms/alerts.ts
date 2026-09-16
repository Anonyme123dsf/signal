import { randomBytes } from "node:crypto";
import type { MarketRow, OpportunityRow } from "../../../shared/types.ts";
import type { Config } from "../config.ts";
import { candidateKey } from "../engine/spread.ts";
import { log } from "../log.ts";
import type { Store } from "../store/types.ts";
import type { Mailer } from "./mailer.ts";

const fmt = (n: number, digits = 2) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(n);

/** Betreff und Text einer Benachrichtigung über eine neue Gelegenheit. */
export function buildAlert(opp: OpportunityRow, markets: Map<string, MarketRow>, dashboardUrl: string): { subject: string; body: string } {
  const name = (id: string) => markets.get(id)?.name ?? id;
  const route = opp.kind === "triangle"
    ? `${opp.symbol} auf ${name(opp.buy_market_id)}`
    : `${opp.symbol}: ${name(opp.buy_market_id)} ${fmt(Number(opp.buy_price), 4)} → ${name(opp.sell_market_id)} ${fmt(Number(opp.sell_price), 4)}`;
  const subject = `Gelegenheit ${opp.symbol}: netto ${fmt(Number(opp.net_spread_bps))} bps, ca. ${fmt(Number(opp.est_profit_quote))}`;
  const lines = [
    `Neue Gelegenheit (${opp.kind === "triangle" ? "Dreieck" : "Cross"}):`,
    route,
    ``,
    `Brutto ${fmt(Number(opp.gross_spread_bps))} bps, Kosten ${fmt(Number(opp.fees_bps))} bps, netto ${fmt(Number(opp.net_spread_bps))} bps`,
    `Einsatz ${fmt(Number(opp.trade_size), 6)}, erwarteter Gewinn ca. ${fmt(Number(opp.est_profit_quote))}`,
    `Erstmals gesehen: ${new Date(opp.first_seen).toLocaleString("de-DE")}`,
  ];
  if (opp.legs?.length) {
    lines.push(``, `Schritte:`);
    opp.legs.forEach((l, i) => lines.push(`${i + 1}. ${l.symbol} ${l.side === "buy" ? "kaufen" : "verkaufen"} zu ${fmt(Number(l.price), 6)}`));
  }
  if (dashboardUrl) lines.push(``, `Dashboard: ${dashboardUrl}`);
  lines.push(``, `Diese Nachricht wurde automatisch vom Worker erzeugt. Es wurde nichts ausgeführt.`);
  return { subject, body: lines.join("\n") };
}

/**
 * Verschickt Benachrichtigungen über neue Gelegenheiten ab ALERT_BPS, pro Route höchstens
 * einmal je Cooldown. Jede Benachrichtigung wird als gesendete Nachricht mit Kennung ALR-… gespeichert,
 * damit sie im Dashboard nachvollziehbar bleibt.
 */
export async function maybeAlert(
  cfg: Config,
  store: Store,
  mailer: Mailer,
  markets: Map<string, MarketRow>,
  opp: OpportunityRow,
  lastAlertAt: Map<string, number>,
  now: number,
): Promise<boolean> {
  if (!cfg.alertEmail || Number(opp.net_spread_bps) < cfg.alertBps) return false;
  const key = candidateKey(opp);
  const last = lastAlertAt.get(key) ?? 0;
  if (now - last < cfg.alertCooldownMs) return false;
  lastAlertAt.set(key, now);

  const { subject, body } = buildAlert(opp, markets, cfg.dashboardUrl);
  const tag = `ALR-${randomBytes(3).toString("hex").toUpperCase()}`;
  try {
    const { providerMessageId } = await mailer.send({ to: cfg.alertEmail, from: cfg.mailFrom, subject: `${subject} [${tag}]`, text: body });
    await store.createMessage({
      deal_id: null, opportunity_id: opp.id, contact_id: null, listing_id: null, direction: "outbound", status: "sent",
      subject: `${subject} [${tag}]`, body, to_email: cfg.alertEmail, from_email: cfg.mailFrom,
      provider_message_id: providerMessageId, thread_tag: tag, error: null, sent_at: new Date(now).toISOString(),
    });
    log.info(`Benachrichtigung ${tag} an ${cfg.alertEmail}: ${subject}`);
    return true;
  } catch (err) {
    log.warn(`Benachrichtigung konnte nicht gesendet werden`, err instanceof Error ? err.message : String(err));
    return false;
  }
}
