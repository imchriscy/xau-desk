import { unrealizedPnl } from "./orderLogic";
import type { ChartTradeOverlay } from "./types";

export function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

export function floatingUsd(o: ChartTradeOverlay, mark: number): number | null {
  if (o.kind === "draft") return null;
  const lots = o.lots ?? 0;
  if (lots <= 0 || !Number.isFinite(mark)) return null;
  if (o.kind === "position" || o.kind === "pending") {
    return unrealizedPnl(o.side, lots, o.entry, mark);
  }
  if (o.profitUsd != null) return o.profitUsd;
  return unrealizedPnl(o.side, lots, o.entry, mark);
}

export function formatPositionPnlUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} USD`;
}

export function overlayLineTitles(
  o: ChartTradeOverlay,
  mark: number,
): { entry: string; sl: string; tp: string } {
  const float = floatingUsd(o, mark);
  const floatSuffix = float != null ? ` · ${fmtUsd(float)}` : "";
  const lots = o.lots ?? 0;

  let entry: string;
  if (o.kind === "position") {
    entry = "";
  } else if (o.label) {
    entry = o.kind !== "draft" && float != null ? `${o.label}${floatSuffix}` : o.label;
  } else if (o.kind === "pending") {
    entry = `入场 ${o.entry.toFixed(2)}${floatSuffix}`;
  } else if (o.kind === "draft") {
    entry = `入场 ${o.entry.toFixed(2)}`;
  } else {
    entry = `@ ${o.entry.toFixed(2)}${floatSuffix}`;
  }

  let sl = "SL";
  if (o.sl != null && lots > 0) {
    sl = `SL · ${fmtUsd(unrealizedPnl(o.side, lots, o.entry, o.sl))}`;
  }

  let tp = "TP";
  if (o.tp != null && lots > 0) {
    tp = `TP · ${fmtUsd(unrealizedPnl(o.side, lots, o.entry, o.tp))}`;
  }

  return { entry, sl, tp };
}

/** 仅标题变化（市价浮动）时用于节流，避免整线重建 */
export function overlayPnlTitleKey(o: ChartTradeOverlay, mark: number): string {
  if (o.kind === "draft") return "";
  const lots = o.lots ?? 0;
  const float = floatingUsd(o, mark);
  const f = float != null ? Math.round(float * 100) : 0;
  if (lots <= 0) return `${o.id}:${f}:-:-`;
  const sl = o.sl != null ? Math.round(unrealizedPnl(o.side, lots, o.entry, o.sl) * 100) : "-";
  const tp = o.tp != null ? Math.round(unrealizedPnl(o.side, lots, o.entry, o.tp) * 100) : "-";
  return `${o.id}:${f}:${sl}:${tp}`;
}
