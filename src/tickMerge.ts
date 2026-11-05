import type { Candle, Timeframe } from "./types";
import { TF_SECONDS } from "./mockData";

/** 用最新 tick 更新未收盘 K 线（与 MT5 图表更接近，减少纯轮询阶梯感） */
export function mergeTickIntoLastBar(candles: Candle[], price: number, timeframe: Timeframe): Candle[] {
  if (candles.length === 0 || !Number.isFinite(price)) return candles;
  const step = TF_SECONDS[timeframe];
  const now = Math.floor(Date.now() / 1000);
  const barStart = now - (now % step);
  const last = candles[candles.length - 1];

  const px = +price.toFixed(2);
  if (last.time < barStart) {
    const open = last.close;
    return [
      ...candles,
      {
        time: barStart,
        open,
        high: Math.max(open, px),
        low: Math.min(open, px),
        close: px,
      },
    ];
  }

  const next: Candle = {
    ...last,
    close: px,
    high: Math.max(last.high, px),
    low: Math.min(last.low, px),
  };
  if (next.close === last.close && next.high === last.high && next.low === last.low) {
    return candles;
  }
  return [...candles.slice(0, -1), next];
}

export function quotePollMs(timeframe: Timeframe): number {
  if (timeframe === "1m") return 100;
  if (timeframe === "3m") return 150;
  if (timeframe === "5m") return 200;
  return 300;
}

export function barsPollMs(timeframe: Timeframe): number {
  if (timeframe === "1m") return 450;
  if (timeframe === "3m") return 800;
  if (timeframe === "5m") return 1200;
  if (timeframe === "15m") return 1800;
  if (timeframe === "30m") return 2500;
  if (timeframe === "1h") return 3500;
  return 5000;
}
