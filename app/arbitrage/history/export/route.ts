import { HISTORY_RANGES, type HistoryRange } from "@/lib/arbitrage/queries";
import { getServiceClient } from "@/lib/arbitrage/supabase";
import type { SpreadSampleRow } from "@/shared/types";

export const dynamic = "force-dynamic";

const COLUMNS = ["ts", "kind", "symbol", "buy_market_id", "sell_market_id", "gross_bps", "fees_bps", "net_bps", "est_profit_quote", "trade_size"] as const;
const PAGE = 5000;
const MAX_ROWS = 300_000;

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV-Export der Spread-Historie für die Auswertung in Excel, R oder Python.
 * Keyset-Pagination über die id, damit auch 7 Tage mit vielen Routen durchgehen.
 */
export async function GET(request: Request): Promise<Response> {
  const db = getServiceClient();
  if (!db) return new Response("Supabase ist nicht konfiguriert", { status: 503 });
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get("range") ?? "24h";
  const range: HistoryRange = rangeParam in HISTORY_RANGES ? (rangeParam as HistoryRange) : "24h";
  const kind = url.searchParams.get("kind");
  const since = new Date(Date.now() - HISTORY_RANGES[range].ms).toISOString();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${COLUMNS.join(",")}\n`));
      let lastId = 0;
      let total = 0;
      try {
        while (total < MAX_ROWS) {
          let q = db.from("spread_samples").select(["id", ...COLUMNS].join(",")).gte("ts", since).gt("id", lastId).order("id").limit(PAGE);
          if (kind === "cross" || kind === "triangle") q = q.eq("kind", kind);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as unknown as (SpreadSampleRow & { id: number })[];
          if (!rows.length) break;
          const chunk = rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(",")).join("\n");
          controller.enqueue(encoder.encode(`${chunk}\n`));
          lastId = rows[rows.length - 1].id;
          total += rows.length;
          if (rows.length < PAGE) break;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="spread_samples_${range}${kind ? `_${kind}` : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
