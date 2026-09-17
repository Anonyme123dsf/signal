import type { MarketRow } from "../../shared/types.ts";

/**
 * Standard-Gebühren pro Börse. Das sind Näherungswerte für die niedrigste
 * Volumenstufe (Stand 2025/2026) und müssen gegen die Gebührenseite der Börse
 * geprüft werden. Werte in der Tabelle `markets` überschreiben diese Defaults.
 */
const DEFAULTS: Record<string, Omit<MarketRow, "id" | "kind" | "enabled">> = {
  kraken:   { name: "Kraken",           taker_fee_bps: 40, withdrawal_fees: { BTC: 0.0001, ETH: 0.0035 } },
  bitstamp: { name: "Bitstamp",         taker_fee_bps: 40, withdrawal_fees: { BTC: 0.0005, ETH: 0.0035 } },
  coinbase: { name: "Coinbase Advanced", taker_fee_bps: 60, withdrawal_fees: { BTC: 0.0001, ETH: 0.002 } },
  bitvavo:  { name: "Bitvavo",          taker_fee_bps: 25, withdrawal_fees: { BTC: 0.0001, ETH: 0.002 } },
  binance:  { name: "Binance",          taker_fee_bps: 10, withdrawal_fees: { BTC: 0.0002, ETH: 0.002 } },
  okx:      { name: "OKX",              taker_fee_bps: 10, withdrawal_fees: { BTC: 0.0002, ETH: 0.002 } },
  bybit:    { name: "Bybit",            taker_fee_bps: 10, withdrawal_fees: { BTC: 0.0002, ETH: 0.002 } },
  kucoin:   { name: "KuCoin",           taker_fee_bps: 10, withdrawal_fees: { BTC: 0.0002, ETH: 0.002 } },
};

export function defaultExchangeMarket(exchangeId: string): MarketRow {
  const d = DEFAULTS[exchangeId] ?? { name: exchangeId, taker_fee_bps: 25, withdrawal_fees: {} };
  return { id: exchangeId, kind: "crypto_exchange", enabled: true, ...d };
}

export const LISTINGS_MARKET: MarketRow = {
  id: "listings",
  kind: "listings",
  name: "Inserate (manuell erfasst)",
  taker_fee_bps: 0,
  withdrawal_fees: {},
  enabled: true,
};
