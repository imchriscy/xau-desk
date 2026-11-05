import { TF_SECONDS } from "./mockData";
import type { Candle, ChartIndicatorInst, IndicatorRenderPlan, Timeframe } from "./types";

export interface LinePoint {
  time: number;
  value: number;
}

export function computeSMA(candles: Candle[], length: number): LinePoint[] {
  if (length < 1 || candles.length < length) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= length) sum -= candles[i - length].close;
    if (i >= length - 1) {
      out.push({ time: candles[i].time, value: +(sum / length).toFixed(4) });
    }
  }
  return out;
}

export function computeBollinger(
  candles: Candle[],
  length: number,
  mult: number,
): { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[] } {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (length < 2 || candles.length < length) {
    return { upper, middle, lower };
  }
  for (let i = length - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / length;
    let varSum = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / length);
    const t = candles[i].time;
    middle.push({ time: t, value: +mean.toFixed(4) });
    upper.push({ time: t, value: +(mean + mult * std).toFixed(4) });
    lower.push({ time: t, value: +(mean - mult * std).toFixed(4) });
  }
  return { upper, middle, lower };
}

export function sourceBarOpenForTime(t: number, sourceStep: number): number {
  return t - (t % sourceStep);
}

/** 将高周期指标点映射到当前图表每根 K 的时间轴（阶梯线） */
export function mapLineToDisplayCandles(
  line: LinePoint[],
  displayCandles: Candle[],
  sourceStep: number,
): LinePoint[] {
  if (line.length === 0 || displayCandles.length === 0) return [];
  const sorted = [...line].sort((a, b) => a.time - b.time);
  let j = 0;
  let lastVal: number | null = null;
  const out: LinePoint[] = [];
  for (const c of displayCandles) {
    const srcOpen = sourceBarOpenForTime(c.time, sourceStep);
    while (j < sorted.length && sorted[j].time <= srcOpen) {
      lastVal = sorted[j].value;
      j++;
    }
    if (lastVal != null) out.push({ time: c.time, value: lastVal });
  }
  return out;
}

export function buildIndicatorRenderPlans(
  indicators: ChartIndicatorInst[],
  displayTf: Timeframe,
  displayCandles: Candle[],
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): IndicatorRenderPlan[] {
  const plans: IndicatorRenderPlan[] = [];
  for (const ind of indicators) {
    if (ind.type === "vol") continue;
    const srcTf = ind.sourceTimeframe;
    const srcCandles =
      srcTf === displayTf ? displayCandles : candlesByTf[srcTf] ?? [];
    if (srcCandles.length === 0) {
      plans.push({ id: ind.id, visible: ind.visible, lines: [] });
      continue;
    }
    const srcStep = TF_SECONDS[srcTf];
    if (ind.type === "ma") {
      const raw = computeSMA(srcCandles, ind.length);
      const points =
        srcTf === displayTf
          ? raw
          : mapLineToDisplayCandles(raw, displayCandles, srcStep);
      plans.push({
        id: ind.id,
        visible: ind.visible,
        lines: [{ key: "ma", color: "#f59e0b", points }],
      });
    } else {
      const bb = computeBollinger(srcCandles, ind.length, ind.bbMult ?? 2);
      const map = (line: LinePoint[]) =>
        srcTf === displayTf ? line : mapLineToDisplayCandles(line, displayCandles, srcStep);
      plans.push({
        id: ind.id,
        visible: ind.visible,
        lines: [
          { key: "bb-u", color: "#8b5cf6", points: map(bb.upper) },
          { key: "bb-m", color: "#a78bfa", points: map(bb.middle) },
          { key: "bb-l", color: "#8b5cf6", points: map(bb.lower) },
        ],
      });
    }
  }
  return plans;
}
