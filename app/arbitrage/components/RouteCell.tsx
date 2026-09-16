import type { Leg, MarketRow, OpportunityRow } from "@/shared/types";
import { fmtAmount, fmtPrice } from "@/lib/arbitrage/format";

const SIDE: Record<Leg["side"], string> = { buy: "kaufen", sell: "verkaufen" };

/** Route einer Gelegenheit: bei cross zwei Märkte mit Preisen, bei triangle Börse und die drei Schritte. */
export function RouteCell({ o, markets }: { o: OpportunityRow; markets: Map<string, MarketRow> }) {
  const name = (id: string) => markets.get(id)?.name ?? id;
  if (o.kind === "triangle") {
    return (
      <div>
        <div>Dreieck auf <span className="font-medium">{name(o.buy_market_id)}</span></div>
        <ol className="text-xs text-[#9c9cba] mt-1 space-y-0.5">
          {o.legs.map((l, i) => (
            <li key={i}>
              {i + 1}. {l.symbol} {SIDE[l.side]} <span className="num">{fmtPrice(l.price)}</span>
              <span className="text-[#5c5c7a]"> · {fmtAmount(l.amount_in, l.from_asset)} → {fmtAmount(l.amount_out, l.to_asset)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div>
      <div>
        <span className="text-[#7c7c9a]">kaufen</span> {name(o.buy_market_id)}
        {o.buy_listing_id && <span className="badge ml-1">Inserat</span>} <span className="num text-[#9c9cba]">{fmtPrice(o.buy_price)}</span>
      </div>
      <div>
        <span className="text-[#7c7c9a]">verkaufen</span> {name(o.sell_market_id)}
        {o.sell_listing_id && <span className="badge ml-1">Inserat</span>} <span className="num text-[#9c9cba]">{fmtPrice(o.sell_price)}</span>
      </div>
    </div>
  );
}
