import "dotenv/config";

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}
function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Umgebungsvariable ${name} ist keine Zahl: "${v}"`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "ja"].includes(v.toLowerCase());
}
function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = str(name, fallback) as T;
  if (!allowed.includes(v)) {
    throw new Error(`Umgebungsvariable ${name} muss eines von ${allowed.join(", ")} sein, ist aber "${v}"`);
  }
  return v;
}

export type StoreKind = "supabase" | "memory";
export type TransferModel = "prefunded" | "withdraw";
export type MailerKind = "console" | "smtp" | "resend";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface Config {
  workerId: string;
  store: StoreKind;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Welche Adapter laufen: "ccxt" (echte Börsen), "mock" (synthetische Preise), "listings" (Inserate aus der DB). */
  adapters: string[];
  /** CCXT-Börsen-IDs, z. B. kraken, bitstamp, coinbase, bitvavo, binance. */
  exchanges: string[];
  symbols: string[];
  pollIntervalMs: number;
  /** Handelsgröße pro Deal in Quote-Währung (z. B. 500 EUR). */
  tradeSizeQuote: number;
  /** Ab diesem Netto-Spread (bps) wird eine Gelegenheit gespeichert. */
  minNetSpreadBps: number;
  /** Ab diesem Netto-Spread (bps) wird automatisch ein Paper-Deal angelegt. 0 = nie. */
  autoPaperBps: number;
  /** Gelegenheit gilt als abgelaufen, wenn sie so lange nicht mehr gesehen wurde. */
  opportunityTtlMs: number;
  /** Sicherheitsaufschlag pro Seite (bps), modelliert Slippage und Latenz. */
  slippageBps: number;
  /** prefunded: Bestand liegt auf beiden Börsen, kein Transfer. withdraw: Abhebegebühr wird eingerechnet. */
  transferModel: TransferModel;
  recordTicks: boolean;
  /** Dreiecks-Arbitrage innerhalb einer Börse bewerten. */
  triangular: boolean;
  /** Startwährung der Dreiecke, z. B. EUR. Leer = Quote-Währung des ersten Symbols. */
  triangleStart: string;
  /** Alle so viele ms wird jede bewertete Route in spread_samples geschrieben. 0 = aus. */
  spreadSampleIntervalMs: number;
  /** Messpunkte, die älter sind, werden gelöscht. */
  spreadHistoryDays: number;
  /** Paper-Deals werden nicht gegen Kurse gefüllt, die älter als so viele ms sind. */
  maxQuoteAgeMs: number;
  /** Nur "paper" ist implementiert. */
  executionMode: "paper";
  mailer: MailerKind;
  mailFrom: string;
  resendApiKey: string;
  smtp: { host: string; port: number; user: string; pass: string; secure: boolean };
  imap: ImapConfig | null;
  inboxPollMs: number;
  mockMarkets: number;
  mockSeed: number;
  /** Startbestände für Paper-Trading, z. B. [{market_id:"kraken",asset:"EUR",amount:1000}]. Leer = keine Bestandsführung. */
  paperBalances: { market_id: string; asset: string; amount: number }[];
  /** true: Bestände beim Start auf die konfigurierten Werte zurücksetzen. */
  paperBalancesReset: boolean;
  /** Empfänger für Benachrichtigungen über neue Gelegenheiten. Leer = aus. */
  alertEmail: string;
  /** Ab diesem Netto-Spread (bps) wird benachrichtigt. */
  alertBps: number;
  /** Pro Route höchstens eine Benachrichtigung in diesem Abstand. */
  alertCooldownMs: number;
  /** Link zum Dashboard in Benachrichtigungen, z. B. https://signal.example.com/arbitrage */
  dashboardUrl: string;
}

/** "kraken:EUR=1000,kraken:BTC=0.02,bitvavo:EUR=1000" → Liste von Beständen. */
export function parsePaperBalances(raw: string): { market_id: string; asset: string; amount: number }[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((entry) => {
    const m = /^\s*([^:\s]+):([^=\s]+)=([0-9.]+)\s*$/.exec(entry);
    if (!m) throw new Error(`PAPER_BALANCES: Eintrag "${entry.trim()}" hat nicht die Form markt:ASSET=betrag`);
    return { market_id: m[1], asset: m[2].toUpperCase(), amount: Number(m[3]) };
  });
}

export function loadConfig(): Config {
  const imapHost = str("IMAP_HOST", "");
  return {
    workerId: str("WORKER_ID", `worker-${process.pid}`),
    store: oneOf("STORE", ["supabase", "memory"] as const, "supabase"),
    supabaseUrl: str("SUPABASE_URL", str("NEXT_PUBLIC_SUPABASE_URL", "")),
    supabaseServiceRoleKey: str("SUPABASE_SERVICE_ROLE_KEY", ""),
    adapters: list("ADAPTERS", ["ccxt", "listings"]),
    exchanges: list("EXCHANGES", ["kraken", "bitstamp", "coinbase", "bitvavo"]),
    symbols: list("SYMBOLS", ["BTC/EUR", "ETH/EUR"]),
    pollIntervalMs: num("POLL_INTERVAL_MS", 2000),
    tradeSizeQuote: num("TRADE_SIZE_QUOTE", 500),
    minNetSpreadBps: num("MIN_NET_SPREAD_BPS", 10),
    autoPaperBps: num("AUTO_PAPER_BPS", 30),
    opportunityTtlMs: num("OPPORTUNITY_TTL_MS", 15000),
    slippageBps: num("SLIPPAGE_BPS", 5),
    transferModel: oneOf("TRANSFER_MODEL", ["prefunded", "withdraw"] as const, "prefunded"),
    recordTicks: bool("RECORD_TICKS", false),
    triangular: bool("TRIANGULAR", true),
    triangleStart: str("TRIANGLE_START", "").toUpperCase(),
    spreadSampleIntervalMs: num("SPREAD_SAMPLE_INTERVAL_MS", 60000),
    spreadHistoryDays: num("SPREAD_HISTORY_DAYS", 14),
    maxQuoteAgeMs: num("MAX_QUOTE_AGE_MS", 30000),
    executionMode: oneOf("EXECUTION_MODE", ["paper"] as const, "paper"),
    mailer: oneOf("MAILER", ["console", "smtp", "resend"] as const, "console"),
    mailFrom: str("MAIL_FROM", "Signal Arbitrage <bot@example.com>"),
    resendApiKey: str("RESEND_API_KEY", ""),
    smtp: {
      host: str("SMTP_HOST", ""),
      port: num("SMTP_PORT", 587),
      user: str("SMTP_USER", ""),
      pass: str("SMTP_PASS", ""),
      secure: bool("SMTP_SECURE", false),
    },
    imap: imapHost
      ? { host: imapHost, port: num("IMAP_PORT", 993), user: str("IMAP_USER", ""), pass: str("IMAP_PASS", "") }
      : null,
    inboxPollMs: num("INBOX_POLL_MS", 60000),
    mockMarkets: num("MOCK_MARKETS", 3),
    mockSeed: num("MOCK_SEED", 42),
    paperBalances: parsePaperBalances(str("PAPER_BALANCES", "")),
    paperBalancesReset: bool("PAPER_BALANCES_RESET", false),
    alertEmail: str("ALERT_EMAIL", ""),
    alertBps: num("ALERT_BPS", 30),
    alertCooldownMs: num("ALERT_COOLDOWN_MS", 900000),
    dashboardUrl: str("DASHBOARD_URL", ""),
  };
}
