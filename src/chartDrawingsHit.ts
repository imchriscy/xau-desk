import type { ChartDrawing } from "./types";

const HIT = 8;
const HANDLE_R = 7;

type TwoPoint = Extract<ChartDrawing, { kind: "trend" | "rect" | "measure" | "fib" }>;

function isTwoPoint(d: ChartDrawing): d is TwoPoint {
  return d.kind === "trend" || d.kind === "rect" || d.kind === "measure" || d.kind === "fib";
}

export type DrawEditHit =
  | { kind: "handle"; id: string; which: "p1" | "p2" }
  | { kind: "body"; id: string }
  | null;

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestDrawing(
  drawings: ChartDrawing[],
  px: number,
  py: number,
  timeToX: (t: number) => number | null,
  priceToY: (p: number) => number | null,
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const d of drawings) {
    if (d.kind === "hline") {
      const y = priceToY(d.price);
      if (y == null) continue;
      const dist = Math.abs(py - y);
      if (dist <= HIT && (!best || dist < best.d)) best = { id: d.id, d: dist };
      continue;
    }
    if (d.kind === "rr") continue;
    const x1 = timeToX(d.t1);
    const x2 = timeToX(d.t2);
    const y1 = priceToY(d.p1);
    const y2 = priceToY(d.p2);
    if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
    if (d.kind === "rect") {
      const minX = Math.min(x1, x2) - HIT;
      const maxX = Math.max(x1, x2) + HIT;
      const minY = Math.min(y1, y2) - HIT;
      const maxY = Math.max(y1, y2) + HIT;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        const d0 = 0;
        if (!best || d0 < best.d) best = { id: d.id, d: d0 };
      }
      continue;
    }
    const dist = distToSegment(px, py, x1, y1, x2, y2);
    if (dist <= HIT && (!best || dist < best.d)) best = { id: d.id, d: dist };
  }
  return best?.id ?? null;
}

export function hitTestDrawingEdit(
  drawings: ChartDrawing[],
  selectedId: string | null,
  px: number,
  py: number,
  timeToX: (t: number) => number | null,
  priceToY: (p: number) => number | null,
): DrawEditHit {
  if (!selectedId) return null;
  const d = drawings.find((x) => x.id === selectedId);
  if (!d || !isTwoPoint(d)) return null;
  const x1 = timeToX(d.t1);
  const x2 = timeToX(d.t2);
  const y1 = priceToY(d.p1);
  const y2 = priceToY(d.p2);
  if (x1 == null || x2 == null || y1 == null || y2 == null) return null;
  if (Math.hypot(px - x1, py - y1) <= HANDLE_R) return { kind: "handle", id: d.id, which: "p1" };
  if (Math.hypot(px - x2, py - y2) <= HANDLE_R) return { kind: "handle", id: d.id, which: "p2" };
  if (d.kind === "rect") {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) return { kind: "body", id: d.id };
  } else {
    const dist = distToSegment(px, py, x1, y1, x2, y2);
    if (dist <= HIT + 4) return { kind: "body", id: d.id };
  }
  return null;
}
