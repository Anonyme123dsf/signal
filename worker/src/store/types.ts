import type {
  BalanceDelta, ContactRow, DealRow, DealStatus, ListingRow, MarketRow, MessageRow, MessageStatus,
  OpportunityRow, OpportunityStatus, PaperBalanceRow, PriceRow, SpreadSampleRow, WorkerHeartbeatRow,
} from "../../../shared/types.ts";
import type { Candidate } from "../engine/spread.ts";

export interface OpportunityUpsertResult {
  row: OpportunityRow;
  created: boolean;
}

export type NewDeal = Pick<DealRow, "opportunity_id" | "mode" | "status">;
export type NewMessage = Omit<MessageRow, "id" | "created_at">;

/**
 * Persistenzschicht des Workers. Zwei Implementierungen: Supabase (Betrieb)
 * und In-Memory (Tests, Demo ohne Datenbank).
 */
export interface Store {
  init(): Promise<void>;
  /** Legt fehlende Märkte an und liefert die wirksamen Werte (DB überschreibt Defaults). */
  syncMarkets(defaults: MarketRow[]): Promise<Map<string, MarketRow>>;
  savePrices(prices: PriceRow[], recordTicks: boolean): Promise<void>;
  getLatestPrices(): Promise<PriceRow[]>;
  listActiveListings(): Promise<ListingRow[]>;
  getContact(id: string): Promise<ContactRow | null>;
  getListing(id: string): Promise<ListingRow | null>;
  upsertOpportunity(c: Candidate, now: Date): Promise<OpportunityUpsertResult>;
  getOpportunity(id: string): Promise<OpportunityRow | null>;
  setOpportunityStatus(id: string, status: OpportunityStatus): Promise<void>;
  /** Setzt offene Gelegenheiten auf "expired", die vor `before` zuletzt gesehen wurden. */
  expireOpportunities(before: Date): Promise<number>;
  createDeal(d: NewDeal): Promise<DealRow>;
  listDeals(status: DealStatus): Promise<DealRow[]>;
  updateDeal(id: string, patch: Partial<DealRow>): Promise<void>;
  createMessage(m: NewMessage): Promise<MessageRow>;
  listMessages(status: MessageStatus): Promise<MessageRow[]>;
  updateMessage(id: string, patch: Partial<MessageRow>): Promise<void>;
  /** Gibt es schon eine nicht verworfene ausgehende Nachricht zu diesem Inserat? */
  hasOutboundMessageForListing(listingId: string): Promise<boolean>;
  findOutboundByThreadTag(tag: string): Promise<MessageRow | null>;
  heartbeat(row: WorkerHeartbeatRow): Promise<void>;
  /** Legt Startbestände an. Ohne reset bleiben vorhandene Zeilen unverändert, neue werden ergänzt. */
  seedPaperBalances(rows: { market_id: string; asset: string; amount: number }[], reset: boolean): Promise<void>;
  listPaperBalances(): Promise<PaperBalanceRow[]>;
  applyBalanceDeltas(deltas: BalanceDelta[]): Promise<void>;
  saveSpreadSamples(rows: SpreadSampleRow[]): Promise<void>;
  /** Löscht Messpunkte, die älter als `before` sind. Liefert die Anzahl. */
  deleteSpreadSamplesBefore(before: Date): Promise<number>;
}
