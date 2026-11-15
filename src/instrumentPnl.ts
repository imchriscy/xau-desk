import { instrumentById, type TradeInstrumentId } from "./instruments";
import type { OrderSide, Position } from "./types";

/** 无 MT5 profit 时的粗算（各品种 contract 与券商有关，优先用 position.profitUsd） */
export function estimatePnlUsd(
  side: OrderSide,
  lots: number,
  openPrice: number,
  mark: number,
  instrumentId: TradeInstrumentId,
): number {
  const c = instrumentById(instrumentId).pnlContractSize ?? 100;
  const dir = side === "buy" ? 1 : -1;
  const digits = instrumentById(instrumentId).digits;
  return +((mark - openPrice) * dir * c * lots).toFixed(digits > 2 ? 2 : digits);
}

export function positionMarkPnl(p: Position, mark: number, instrumentId: TradeInstrumentId): number {
  if (p.profitUsd != null && Number.isFinite(p.profitUsd)) return p.profitUsd;
  const inst =
    p.symbol?.toUpperCase().includes("BTC")
      ? "btc"
      : p.symbol?.toUpperCase().includes("NAS") || p.symbol?.toUpperCase().includes("US100")
        ? "nas100"
        : instrumentId;
  return estimatePnlUsd(p.side, p.lots, p.openPrice, mark, inst as TradeInstrumentId);
}