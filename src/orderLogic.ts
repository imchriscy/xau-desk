import type { OrderSide, PendingOrder, Position } from "./types";

let ticketSeq = 880001;
let idSeq = 1;

export function nextTicket(): number {
  ticketSeq += 1;
  return ticketSeq;
}

export function nextId(prefix: string): string {
  const id = `${prefix}-${idSeq}`;
  idSeq += 1;
  return id;
}

export function slTpFromOffsets(
  side: OrderSide,
  entry: number,
  slOffset: number,
  tpOffset: number,
): { sl: number | null; tp: number | null } {
  const slOff = Math.max(0, slOffset);
  const tpOff = Math.max(0, tpOffset);
  if (side === "buy") {
    return {
      sl: slOff > 0 ? +(entry - slOff).toFixed(2) : null,
      tp: tpOff > 0 ? +(entry + tpOff).toFixed(2) : null,
    };
  }
  return {
    sl: slOff > 0 ? +(entry + slOff).toFixed(2) : null,
    tp: tpOff > 0 ? +(entry - tpOff).toFixed(2) : null,
  };
}

export function createMarketPosition(
  side: OrderSide,
  lots: number,
  price: number,
  slOffset: number,
  tpOffset: number,
): Position {
  const { sl, tp } = slTpFromOffsets(side, price, slOffset, tpOffset);
  return {
    id: nextId("pos"),
    ticket: nextTicket(),
    side,
    lots,
    openPrice: +price.toFixed(2),
    sl,
    tp,
    openTime: Math.floor(Date.now() / 1000),
  };
}

export function createPendingOrder(
  side: OrderSide,
  lots: number,
  entryPrice: number,
  slOffset: number,
  tpOffset: number,
): PendingOrder {
  const { sl, tp } = slTpFromOffsets(side, entryPrice, slOffset, tpOffset);
  return {
    id: nextId("pend"),
    side,
    lots,
    entryPrice: +entryPrice.toFixed(2),
    sl,
    tp,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/** XAU 演示：1 lot ≈ 100 oz，PnL ≈ (mark - open) * 100 * lots（买） */
export function unrealizedPnl(side: OrderSide, lots: number, openPrice: number, mark: number): number {
  const dir = side === "buy" ? 1 : -1;
  return +((mark - openPrice) * dir * 100 * lots).toFixed(2);
}

export function clampSlTp(side: OrderSide, field: "sl" | "tp", entry: number, price: number): number {
  const p = +price.toFixed(2);
  if (field === "sl") {
    if (side === "buy") return Math.min(p, entry - 0.01);
    return Math.max(p, entry + 0.01);
  }
  if (side === "buy") return Math.max(p, entry + 0.01);
  return Math.min(p, entry - 0.01);
}
