import type { Candle } from "./types";

/** 将 API / 合并后的 time 统一为 lightweight-charts 可用的 UTC 秒。 */
export function coerceCandleTime(t: unknown): number {
  if (typeof t === "number" && Number.isFinite(t)) return Math.floor(t);
  if (typeof t === "string") {
    const n = Number(t);
    if (Number.isFinite(n)) return Math.floor(n);
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (typeof o.year === "number" && typeof o.month === "number" && typeof o.day === "number") {
      return Math.floor(Date.UTC(o.year, o.month - 1, o.day) / 1000);
    }
  }
  return NaN;
}

export function normalizeCandles(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const time = coerceCandleTime(c.time);
    if (!Number.isFinite(time) || time <= 0) continue;
    out.push({ ...c, time });
  }
  return out;
}