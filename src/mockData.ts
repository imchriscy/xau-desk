import type { Candle, Timeframe } from "./types";

const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

/** 确定性伪随机 · 便于 UI 联调复现 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMockCandles(tf: Timeframe, bars = 800, seed = 202512): Candle[] {
  const step = TF_SECONDS[tf];
  const now = Math.floor(Date.now() / 1000);
  const aligned = now - (now % step);
  const rand = mulberry32(seed + step);
  let px = 2650 + (seed % 100) * 0.1;
  const out: Candle[] = [];

  for (let i = bars - 1; i >= 0; i--) {
    const t = aligned - i * step;
    const drift = (rand() - 0.48) * (tf === "1m" ? 0.35 : tf === "5m" ? 0.9 : 2.2);
    const open = px;
    const close = open + drift;
    const wick = 0.15 + rand() * (tf === "1d" ? 8 : 2.5);
    const high = Math.max(open, close) + rand() * wick;
    const low = Math.min(open, close) - rand() * wick;
    out.push({
      time: t,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.round(80 + rand() * 420),
    });
    px = close;
  }
  return out;
}

export function tfLabel(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    "1m": "1分",
    "3m": "3分",
    "5m": "5分",
    "15m": "15分",
    "30m": "30分",
    "1h": "1小时",
    "4h": "4小时",
    "1d": "日线",
  };
  return map[tf];
}

export { TF_SECONDS };
