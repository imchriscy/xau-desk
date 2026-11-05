import type { OrderSide, PendingOrderMode } from "./types";

export const DRAFT_OVERLAY_ID = "chart-order-draft";

/** XAU：1 lot ≈ 100 oz */
export function legUsd(entry: number, exit: number, lots: number): number {
  return Math.abs(exit - entry) * 100 * lots;
}

export function inferSide(mode: PendingOrderMode, price: number, mid: number): OrderSide {
  if (mode === "limit") {
    return price <= mid ? "buy" : "sell";
  }
  return price >= mid ? "buy" : "sell";
}

export function modeLabel(mode: PendingOrderMode): string {
  if (mode === "limit") return "Limit";
  if (mode === "stop") return "Stop";
  return "StopLimit";
}

export function defaultSlTp(
  side: OrderSide,
  entry: number,
  slOffset: number,
  tpOffset: number,
): { sl: number | null; tp: number | null } {
  if (slOffset <= 0 && tpOffset <= 0) return { sl: null, tp: null };
  if (side === "buy") {
    return {
      sl: slOffset > 0 ? +(entry - slOffset).toFixed(2) : null,
      tp: tpOffset > 0 ? +(entry + tpOffset).toFixed(2) : null,
    };
  }
  return {
    sl: slOffset > 0 ? +(entry + slOffset).toFixed(2) : null,
    tp: tpOffset > 0 ? +(entry - tpOffset).toFixed(2) : null,
  };
}
