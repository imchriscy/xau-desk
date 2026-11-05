import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import {

  ColorType,

  CrosshairMode,

  createChart,

  type IChartApi,

  type IPriceLine,

  type ISeriesApi,

  type Time,

} from "lightweight-charts";

import type {
  Candle,
  ChartTradeOverlay,
  CrosshairInfo,
  LevelField,
  PendingDragPreview,
  Timeframe,
} from "../types";

import {
  floatingUsd,
  formatPositionPnlUsd,
  overlayLineTitles,
  overlayPnlTitleKey,
} from "../chartOverlayTitles";
import ChartBarCountdown from "./ChartBarCountdown";
import ChartDrawingsLayer from "./ChartDrawingsLayer";
import { hitTestDrawing, hitTestDrawingEdit } from "../chartDrawingsHit";
import { TF_SECONDS } from "../mockData";
import type {
  ChartDrawing,
  DrawToolKind,
  IndicatorRenderPlan,
} from "../types";



const CHART_THEME = {

  layout: {

    background: { type: ColorType.Solid, color: "#131722" },

    textColor: "#d1d4dc",

  },

  grid: {

    vertLines: { color: "#1e222d" },

    horzLines: { color: "#1e222d" },

  },

  crosshair: {

    mode: CrosshairMode.Normal,

    vertLine: {

      color: "#758696",

      width: 1 as const,

      style: 2,

      labelBackgroundColor: "#363a45",

    },

    horzLine: {

      color: "#758696",

      width: 1 as const,

      style: 2,

      labelBackgroundColor: "#363a45",

    },

  },

  timeScale: {

    borderColor: "#363a45",

    timeVisible: true,

    secondsVisible: false,

    shiftVisibleRangeOnNewBar: false,

  },

  rightPriceScale: {

    borderColor: "#363a45",

  },

};



function dedupe(candles: Candle[]): Candle[] {

  const m = new Map<number, Candle>();

  for (const c of candles) m.set(c.time, c);

  return [...m.values()].sort((a, b) => a.time - b.time);

}



const POS_LINE_BUY = "#2962ff";
const POS_LINE_SELL = "#ef5350";

/** 最新 K 线与右缘之间预留的空 K 线格数（视觉舒适） */
const RIGHT_BAR_GAP = 10;

function visibleBars(tf: Timeframe): number {

  if (tf === "1m" || tf === "3m") return 200;

  if (tf === "5m" || tf === "15m" || tf === "30m") return 160;

  if (tf === "1h") return 130;

  return 90;

}

function latestVisibleLogicalRange(barCount: number, tf: Timeframe): { from: number; to: number } {
  const n = Math.max(0, barCount);
  return {
    from: Math.max(0, n - visibleBars(tf)),
    to: n + RIGHT_BAR_GAP,
  };
}

/** 限制末根 K 线异常影线，防止 tick 脏数据把 autoscale 越撑越大 */
function clampLastBarWicks(c: Candle, maxWick = 120): Candle {
  const capHigh = Math.max(c.open, c.close) + maxWick;
  const capLow = Math.min(c.open, c.close) - maxWick;
  const high = Math.min(c.high, capHigh);
  const low = Math.max(c.low, capLow);
  if (high === c.high && low === c.low) return c;
  return { ...c, high, low };
}



export interface TradingChartHandle {
  resetVisibleRange: () => void;
  scrollToLatest: () => void;
  clientYToPrice: (clientY: number) => number | null;
  priceToClientY: (price: number) => number | null;
  getWrapElement: () => HTMLDivElement | null;
}



interface Props {

  candles: Candle[];

  timeframe: Timeframe;

  overlays: ChartTradeOverlay[];

  /** 当前市价，用于成本线浮盈与 SL/TP 金额标签 */
  markPrice?: number;

  onCrosshair: (info: CrosshairInfo) => void;

  onLastPrice: (price: number) => void;

  onLevelChange: (id: string, field: LevelField, price: number) => void;

  onLevelCommit?: (id: string, field: LevelField, price: number) => void;

  limitPickMode?: boolean;

  onPickEntry?: (price: number) => void;

  pendingDragPreview?: PendingDragPreview | null;

  onEntryDoubleClick?: (overlayId: string) => void;

  activeDrawTool?: DrawToolKind;

  drawings?: ChartDrawing[];

  onDrawingsChange?: (next: ChartDrawing[]) => void;

  indicatorPlans?: IndicatorRenderPlan[];

  volumeVisible?: boolean;

  selectedDrawingId?: string | null;

  onSelectDrawing?: (id: string | null) => void;

  onDeleteDrawing?: (id: string) => void;

  onExitDrawTool?: () => void;

}



type DragState = { id: string; field: LevelField } | null;



const HIT_PX = 10;



const TradingChart = forwardRef<TradingChartHandle, Props>(function TradingChart(

  {
    candles,
    timeframe,
    overlays,
    markPrice,
    onCrosshair,
    onLastPrice,
    onLevelChange,
    onLevelCommit,
    limitPickMode,
    onPickEntry,
    pendingDragPreview,
    onEntryDoubleClick,
    activeDrawTool = null,
    drawings = [],
    onDrawingsChange,
    indicatorPlans = [],
    volumeVisible = false,
    selectedDrawingId = null,
    onSelectDrawing,
    onDeleteDrawing,
    onExitDrawTool,
  },

  ref,

) {

  const wrapRef = useRef<HTMLDivElement>(null);

  const hostRef = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);

  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const candleMapRef = useRef<Map<number, Candle>>(new Map());

  const candlesRef = useRef(candles);

  const timeframeRef = useRef(timeframe);

  const overlaysRef = useRef(overlays);

  /** id+field → 价格线句柄，用 applyOptions 更新，避免 remove 失败导致堆积 */
  const priceLineByKeyRef = useRef<Map<string, IPriceLine>>(new Map());
  const onCrosshairRef = useRef(onCrosshair);
  onCrosshairRef.current = onCrosshair;

  const dragRef = useRef<DragState>(null);
  const lastDragPriceRef = useRef<number | null>(null);
  const prevTfRef = useRef(timeframe);
  const prevLenRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);

  const [dragHint, setDragHint] = useState<string | null>(null);
  const posLabelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const posEntriesRef = useRef<Array<{ id: string; entry: number }>>([]);
  const markCountdownWrapRef = useRef<HTMLDivElement | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line">[]>>(new Map());
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volumeVisibleRef = useRef(volumeVisible);
  volumeVisibleRef.current = volumeVisible;
  const activeDrawToolRef = useRef(activeDrawTool);
  activeDrawToolRef.current = activeDrawTool;
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  onDrawingsChangeRef.current = onDrawingsChange;
  const onSelectDrawingRef = useRef(onSelectDrawing);
  onSelectDrawingRef.current = onSelectDrawing;
  const onExitDrawToolRef = useRef(onExitDrawTool);
  onExitDrawToolRef.current = onExitDrawTool;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const indicatorPlansRef = useRef(indicatorPlans);
  indicatorPlansRef.current = indicatorPlans;
  const drawSessionRef = useRef<{
    tool: DrawToolKind;
    t1: number;
    p1: number;
  } | null>(null);
  const drawEditRef = useRef<{
    id: string;
    mode: "p1" | "p2" | "move";
    orig: { t1: number; p1: number; t2: number; p2: number };
    start: { time: number; price: number };
  } | null>(null);
  const [drawPreview, setDrawPreview] = useState<ChartDrawing | null>(null);
  const [overlaySize, setOverlaySize] = useState({ w: 0, h: 0 });
  const [coordTick, setCoordTick] = useState(0);



  candlesRef.current = candles;

  timeframeRef.current = timeframe;

  overlaysRef.current = overlays;

  const markPriceRef = useRef(markPrice);
  markPriceRef.current = markPrice;

  const pendingDragPreviewRef = useRef(pendingDragPreview);
  pendingDragPreviewRef.current = pendingDragPreview;

  const lastEntryTapRef = useRef<{ id: string; t: number } | null>(null);

  const applyDefaultRange = () => {

    const chart = chartRef.current;

    const clean = dedupe(candlesRef.current);

    const tf = timeframeRef.current;

    if (!chart || clean.length === 0) return;

    chart.timeScale().setVisibleLogicalRange(latestVisibleLogicalRange(clean.length, tf));

  };



  const clientYToPrice = (clientY: number): number | null => {
    const series = seriesRef.current;
    const el = hostRef.current;
    if (!series || !el) return null;
    const y = clientY - el.getBoundingClientRect().top;
    const price = series.coordinateToPrice(y);
    if (price == null || Number.isNaN(price)) return null;
    return +price.toFixed(2);
  };

  const priceToClientY = (price: number): number | null => {
    const series = seriesRef.current;
    const el = hostRef.current;
    if (!series || !el) return null;
    const y = series.priceToCoordinate(price);
    if (y == null) return null;
    return el.getBoundingClientRect().top + y;
  };

  const clientToTimePrice = (clientX: number, clientY: number): { time: number; price: number } | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const el = hostRef.current;
    if (!chart || !series || !el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null || Number.isNaN(price)) return null;
    return { time: time as number, price: +price.toFixed(2) };
  };

  const chartCoordApi = () => ({
    timeToX: (time: number) => {
      const chart = chartRef.current;
      if (!chart) return null;
      const x = chart.timeScale().timeToCoordinate(time as Time);
      return x ?? null;
    },
    priceToY: (price: number) => {
      const series = seriesRef.current;
      if (!series) return null;
      const y = series.priceToCoordinate(price);
      return y ?? null;
    },
  });

  const scrollToLatest = () => {
    const chart = chartRef.current;
    const clean = dedupe(candlesRef.current);
    if (!chart || clean.length === 0) return;
    chart.timeScale().setVisibleLogicalRange(
      latestVisibleLogicalRange(clean.length, timeframeRef.current),
    );
  };

  useImperativeHandle(ref, () => ({
    resetVisibleRange: applyDefaultRange,
    scrollToLatest,
    clientYToPrice,
    priceToClientY,
    getWrapElement: () => wrapRef.current,
  }));



  type PriceLineOpts = Parameters<ISeriesApi<"Candlestick">["createPriceLine"]>[0];

  const anchorPrice = (): number => {
    const clean = dedupe(candlesRef.current);
    const last = clean[clean.length - 1];
    return last?.close ?? 0;
  };

  /** 过滤 0/NaN/离市价过远的价位，避免 Y 轴被单条脏线无限撑开 */
  const isDrawablePrice = (price: number, anchor: number): boolean => {
    if (!Number.isFinite(price) || price <= 0) return false;
    if (!Number.isFinite(anchor) || anchor <= 0) return true;
    return Math.abs(price - anchor) <= 800;
  };

  const removePriceLineByKey = (key: string) => {
    const series = seriesRef.current;
    const ln = priceLineByKeyRef.current.get(key);
    if (!series || !ln) {
      priceLineByKeyRef.current.delete(key);
      return;
    }
    try {
      series.removePriceLine(ln);
    } catch {
      /* series 已销毁 */
    }
    priceLineByKeyRef.current.delete(key);
  };

  const disposeAllPriceLines = () => {
    for (const key of [...priceLineByKeyRef.current.keys()]) {
      removePriceLineByKey(key);
    }
  };

  const upsertPriceLine = (key: string, options: PriceLineOpts) => {
    const series = seriesRef.current;
    if (!series) return;
    const existing = priceLineByKeyRef.current.get(key);
    if (existing) {
      existing.applyOptions(options);
      return;
    }
    const ln = series.createPriceLine(options);
    priceLineByKeyRef.current.set(key, ln);
  };

  const syncPriceLines = (opts?: { titlesOnly?: boolean }) => {
    const series = seriesRef.current;
    if (!series) return;

    const anchor = anchorPrice();
    const mark = markPriceRef.current ?? anchor;
    const needed = new Set<string>();

    const touch = (key: string, line: PriceLineOpts) => {
      needed.add(key);
      upsertPriceLine(key, line);
    };

    if (!opts?.titlesOnly) {
      for (const o of overlaysRef.current) {
        const sel = o.selected;
        const titles = overlayLineTitles(o, mark);

        if (isDrawablePrice(o.entry, anchor)) {
          const entryColor =
            o.kind === "position"
              ? o.side === "buy"
                ? POS_LINE_BUY
                : POS_LINE_SELL
              : o.side === "buy"
                ? "#26a69a"
                : "#ef5350";
          touch(`${o.id}:entry`, {
            price: o.entry,
            color: entryColor,
            lineWidth: sel ? 2 : 1,
            lineStyle: o.kind === "pending" ? 2 : 0,
            axisLabelVisible: false,
            title: titles.entry,
          });
        }

        if (o.sl != null && isDrawablePrice(o.sl, anchor)) {
          touch(`${o.id}:sl`, {
            price: o.sl,
            color: sel ? "#f97316" : "#9a3412",
            lineWidth: sel ? 2 : 1,
            lineStyle: 2,
            axisLabelVisible: false,
            title: titles.sl,
          });
        }

        if (o.tp != null && isDrawablePrice(o.tp, anchor)) {
          touch(`${o.id}:tp`, {
            price: o.tp,
            color: sel ? "#22c55e" : "#166534",
            lineWidth: sel ? 2 : 1,
            lineStyle: 2,
            axisLabelVisible: false,
            title: titles.tp,
          });
        }
      }

      const preview = pendingDragPreviewRef.current;
      if (preview && isDrawablePrice(preview.price, anchor)) {
        const color = preview.side === "buy" ? "#2962ff" : "#ef5350";
        const title =
          preview.mode === "stop_limit" && preview.stopLimitPhase === 1
            ? `${preview.price.toFixed(2)} · 松手设 STOP`
            : preview.mode === "stop_limit" && preview.stopLimitPhase === 2
              ? `${preview.price.toFixed(2)} · 松手设触发价`
              : `${preview.price.toFixed(2)} · 松手挂单`;
        touch("preview", {
          price: preview.price,
          color,
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: false,
          title,
        });
      }
    } else {
      for (const o of overlaysRef.current) {
        if (o.kind === "draft") continue;
        const titles = overlayLineTitles(o, mark);
        const fields: Array<["entry" | "sl" | "tp", string]> = [
          ["entry", titles.entry],
          ["sl", titles.sl],
          ["tp", titles.tp],
        ];
        for (const [field, title] of fields) {
          const key = `${o.id}:${field}`;
          const ln = priceLineByKeyRef.current.get(key);
          if (!ln) continue;
          ln.applyOptions({ title });
          needed.add(key);
        }
      }
    }

    if (!opts?.titlesOnly) {
      for (const key of priceLineByKeyRef.current.keys()) {
        if (!needed.has(key)) removePriceLineByKey(key);
      }
    }
  };

  function overlayGeometryKey(
    list: ChartTradeOverlay[],
    preview: PendingDragPreview | null | undefined,
  ): string {
    const parts = list.map(
      (o) =>
        `${o.id}:${o.kind}:${o.entry.toFixed(2)}:${o.sl?.toFixed(2) ?? "-"}:${o.tp?.toFixed(2) ?? "-"}:${o.selected ? 1 : 0}`,
    );
    if (preview) {
      parts.push(
        `preview:${preview.price.toFixed(2)}:${preview.stopLimitPhase ?? 0}:${preview.stopLimitStopPrice?.toFixed(2) ?? "-"}`,
      );
    }
    return parts.join("|");
  }



  const priceAtY = (clientY: number): number | null => {

    const series = seriesRef.current;

    const el = hostRef.current;

    if (!series || !el) return null;

    const rect = el.getBoundingClientRect();

    const y = clientY - rect.top;

    const price = series.coordinateToPrice(y);

    if (price == null || Number.isNaN(price)) return null;

    return +price.toFixed(2);

  };



  const hitTest = (clientY: number): DragState => {

    const series = seriesRef.current;

    const el = hostRef.current;

    if (!series || !el) return null;

    const rect = el.getBoundingClientRect();

    const y = clientY - rect.top;



    let best: { id: string; field: LevelField; dist: number } | null = null;



    for (const o of overlaysRef.current) {
      const candidates: { field: LevelField; price: number | null }[] = [];
      if (o.kind === "pending") {
        candidates.push({ field: "entry", price: o.entry });
      }
      if (o.selected) {
        if (o.sl != null) candidates.push({ field: "sl", price: o.sl });
        if (o.tp != null) candidates.push({ field: "tp", price: o.tp });
      }
      for (const c of candidates) {
        if (c.price == null) continue;
        const cy = series.priceToCoordinate(c.price);
        if (cy == null) continue;
        const dist = Math.abs(cy - y);
        if (dist <= HIT_PX && (!best || dist < best.dist)) {
          best = { id: o.id, field: c.field, dist };
        }
      }
    }

    return best ? { id: best.id, field: best.field } : null;

  };

  const hitEntryOverlay = (clientY: number): string | null => {
    const series = seriesRef.current;
    const el = hostRef.current;
    if (!series || !el) return null;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top;
    let best: { id: string; dist: number } | null = null;
    for (const o of overlaysRef.current) {
      const cy = series.priceToCoordinate(o.entry);
      if (cy == null) continue;
      const dist = Math.abs(cy - y);
      if (dist <= HIT_PX && (!best || dist < best.dist)) {
        best = { id: o.id, dist };
      }
    }
    return best?.id ?? null;
  };



  useEffect(() => {

    const el = hostRef.current;

    if (!el) return;



    const chart = createChart(el, {

      ...CHART_THEME,

      width: el.clientWidth,

      height: el.clientHeight,

      localization: { locale: "zh-CN" },

    });

    const series = chart.addCandlestickSeries({

      upColor: "#26a69a",

      downColor: "#ef5350",

      borderVisible: false,

      wickUpColor: "#26a69a",

      wickDownColor: "#ef5350",

      lastValueVisible: true,

      priceLineVisible: true,

      priceLineColor: "#758696",

      priceLineWidth: 1,

    });

    series.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.22 },
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;



    chartRef.current = chart;

    seriesRef.current = series;



    const bumpCoords = () => setCoordTick((n) => n + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bumpCoords);

    chart.subscribeCrosshairMove((param) => {
      if (dragRef.current) return;
      if (!param.time) {
        onCrosshairRef.current({ time: null, price: null, ohlc: null });
        return;
      }
      const t = param.time as number;
      const ohlc = candleMapRef.current.get(t) ?? null;
      const price = param.seriesData.get(series);
      const p =
        price && typeof price === "object" && "close" in price ? (price.close as number) : null;
      onCrosshairRef.current({ time: t, price: p, ohlc });
    });



    const ro = new ResizeObserver(() => {

      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });

    });

    ro.observe(el);



    return () => {

      ro.disconnect();

      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bumpCoords);

      disposeAllPriceLines();

      for (const lines of indicatorSeriesRef.current.values()) {
        for (const s of lines) {
          try {
            chart.removeSeries(s);
          } catch {
            /* ignore */
          }
        }
      }
      indicatorSeriesRef.current.clear();

      chart.remove();

      chartRef.current = null;

      seriesRef.current = null;
      volumeSeriesRef.current = null;

    };

  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const vol = volumeSeriesRef.current;
    if (!series || !vol) return;
    const bottom = volumeVisible ? 0.22 : 0.05;
    series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom } });
    if (!volumeVisible) {
      vol.setData([]);
      return;
    }
    const clean = dedupe(candles);
    vol.setData(
      clean.map((c) => ({
        time: c.time as Time,
        value: c.volume ?? 0,
        color: c.close >= c.open ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
      })),
    );
  }, [candles, volumeVisible]);

  const lastOverlayKeyRef = useRef("");
  const lastProfitKeyRef = useRef("");

  useEffect(() => {
    const geomKey = overlayGeometryKey(overlays, pendingDragPreview);
    const mark = markPrice ?? anchorPrice();
    const profitKey = overlays
      .filter((o) => o.kind !== "draft")
      .map((o) => overlayPnlTitleKey(o, mark))
      .join("|");
    const geomSame = geomKey === lastOverlayKeyRef.current;
    const profitSame = profitKey === lastProfitKeyRef.current;
    if (geomSame && profitSame) return;
    if (!geomSame) {
      lastOverlayKeyRef.current = geomKey;
      lastProfitKeyRef.current = profitKey;
      syncPriceLines();
      return;
    }
    lastProfitKeyRef.current = profitKey;
    syncPriceLines({ titlesOnly: true });
  }, [overlays, pendingDragPreview, markPrice]);



  useEffect(() => {

    const series = seriesRef.current;

    const chart = chartRef.current;

    if (!series || !chart || candles.length === 0) return;



    const clean = dedupe(candles);
    candleMapRef.current = new Map(clean.map((c) => [c.time, c]));

    const toBar = (c: Candle) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });

    const tfChanged = prevTfRef.current !== timeframe;
    const sameAnchor =
      !tfChanged &&
      prevFirstTimeRef.current != null &&
      clean.length > 0 &&
      clean[0].time === prevFirstTimeRef.current &&
      prevLenRef.current > 0;

    const barsForChart = clean.map((c, i) =>
      i === clean.length - 1 ? clampLastBarWicks(c) : c,
    );

    if (sameAnchor && clean.length >= prevLenRef.current - 1) {
      const start = Math.max(0, prevLenRef.current - 1);
      for (let i = start; i < barsForChart.length; i++) {
        series.update(toBar(barsForChart[i]));
      }
    } else {
      const ts = chart.timeScale();
      const prevRange = ts.getVisibleLogicalRange();
      series.setData(barsForChart.map(toBar));
      const sec = TF_SECONDS[timeframe];
      ts.applyOptions({
        barSpacing: timeframe === "1m" ? 5 : 7,
        secondsVisible: sec < 3600,
      });
      if (tfChanged || !prevRange) {
        ts.setVisibleLogicalRange(latestVisibleLogicalRange(clean.length, timeframe));
      } else {
        const added =
          prevLenRef.current > 0 && clean.length > prevLenRef.current && prevFirstTimeRef.current === clean[0].time
            ? clean.length - prevLenRef.current
            : 0;
        if (added > 0) {
          ts.setVisibleLogicalRange({ from: prevRange.from + added, to: prevRange.to + added });
        } else {
          ts.setVisibleLogicalRange(prevRange);
        }
      }
    }

    prevTfRef.current = timeframe;
    prevLenRef.current = clean.length;
    prevFirstTimeRef.current = clean.length ? clean[0].time : null;

    const last = clean[clean.length - 1];
    onLastPrice(last.close);
  }, [candles, timeframe, onLastPrice]);

  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return;
    const clean = dedupe(candles);
    const toLine = (pts: { time: number; value: number }[]) =>
      pts.map((p) => ({ time: p.time as Time, value: p.value }));

    const plans = indicatorPlansRef.current;
    const activeIds = new Set(plans.map((p) => p.id));
    for (const [id, lines] of indicatorSeriesRef.current) {
      if (!activeIds.has(id)) {
        for (const s of lines) chart.removeSeries(s);
        indicatorSeriesRef.current.delete(id);
      }
    }

    for (const plan of plans) {
      let seriesList = indicatorSeriesRef.current.get(plan.id);
      const need = plan.lines.length;
      if (!seriesList || seriesList.length !== need) {
        if (seriesList) for (const s of seriesList) chart.removeSeries(s);
        seriesList = plan.lines.map((ln) =>
          chart.addLineSeries({
            color: ln.color,
            lineWidth: ln.key === "ma" ? 2 : 1,
            priceLineVisible: false,
            lastValueVisible: false,
          }),
        );
        indicatorSeriesRef.current.set(plan.id, seriesList);
      }
      if (!plan.visible || clean.length === 0) {
        for (const s of seriesList) s.setData([]);
        continue;
      }
      plan.lines.forEach((ln, i) => {
        seriesList![i].applyOptions({ color: ln.color });
        seriesList![i].setData(toLine(ln.points));
      });
    }
  }, [candles, indicatorPlans]);

  const newDrawId = () => `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const replaceDrawing = (id: string, patch: Partial<{ t1: number; p1: number; t2: number; p2: number }>) => {
    onDrawingsChangeRef.current?.(
      drawingsRef.current.map((d) => {
        if (d.id !== id) return d;
        if (d.kind === "hline" || d.kind === "rr") return d;
        return { ...d, ...patch };
      }),
    );
  };

  const pushDrawing = (d: ChartDrawing) => {
    onDrawingsChangeRef.current?.([...drawingsRef.current, d]);
    onSelectDrawingRef.current?.(d.id);
    onExitDrawToolRef.current?.();
  };

  const coordFrameRef = useRef(0);

  const syncOverlayTops = () => {
    const series = seriesRef.current;
    if (!series) return;
    coordFrameRef.current += 1;
    if (coordFrameRef.current % 2 === 0) {
      setCoordTick((n) => n + 1);
    }
    for (const item of posEntriesRef.current) {
      const el = posLabelRefs.current.get(item.id);
      if (!el) continue;
      const y = series.priceToCoordinate(item.entry);
      if (y != null && Number.isFinite(y)) {
        el.style.top = `${y}px`;
      }
    }
    const mark = markPriceRef.current;
    const cdWrap = markCountdownWrapRef.current;
    if (mark != null && cdWrap) {
      const y = series.priceToCoordinate(mark);
      if (y != null && Number.isFinite(y)) {
        cdWrap.style.top = `${y}px`;
      }
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setOverlaySize({ w: host.clientWidth, h: host.clientHeight });
    });
    ro.observe(host);
    setOverlaySize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      syncOverlayTops();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {

    const wrap = wrapRef.current;

    if (!wrap) return;



    const onDown = (e: PointerEvent) => {

      if (e.button !== 0) return;

      const drawTool = activeDrawToolRef.current;
      if (drawTool && onDrawingsChangeRef.current) {
        const tp = clientToTimePrice(e.clientX, e.clientY);
        if (!tp) return;
        drawSessionRef.current = { tool: drawTool, t1: tp.time, p1: tp.price };
        dragRef.current = { id: "__draw__", field: "entry" };
        wrap.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (!drawTool && selectedDrawingId && onDrawingsChangeRef.current) {
        const host = hostRef.current;
        if (host) {
          const rect = host.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const coord = chartCoordApi();
          const editHit = hitTestDrawingEdit(
            drawingsRef.current,
            selectedDrawingId,
            px,
            py,
            coord.timeToX,
            coord.priceToY,
          );
          if (editHit) {
            const d = drawingsRef.current.find((x) => x.id === editHit.id);
            if (d && (d.kind === "trend" || d.kind === "rect" || d.kind === "fib")) {
              const tp = clientToTimePrice(e.clientX, e.clientY);
              if (!tp) return;
              drawEditRef.current = {
                id: d.id,
                mode: editHit.kind === "handle" ? editHit.which : "move",
                orig: { t1: d.t1, p1: d.p1, t2: d.t2, p2: d.p2 },
                start: { time: tp.time, price: tp.price },
              };
              dragRef.current = { id: "__draw_edit__", field: "entry" };
              wrap.setPointerCapture(e.pointerId);
              e.preventDefault();
              return;
            }
          }
        }
      }

      const entryId = hitEntryOverlay(e.clientY);
      if (entryId && onEntryDoubleClick) {
        const now = Date.now();
        const prev = lastEntryTapRef.current;
        if (prev?.id === entryId && now - prev.t < 400) {
          onEntryDoubleClick(entryId);
          lastEntryTapRef.current = null;
          e.preventDefault();
          return;
        }
        lastEntryTapRef.current = { id: entryId, t: now };
      }

      const hit = hitTest(e.clientY);

      if (hit?.field === "entry") {
        const ov = overlaysRef.current.find((x) => x.id === hit.id);
        if (ov?.kind !== "pending") return;
      }

      if (!hit) {
        const host = hostRef.current;
        if (host) {
          const rect = host.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const coord = chartCoordApi();
          const drawHit = hitTestDrawing(
            drawingsRef.current,
            px,
            py,
            coord.timeToX,
            coord.priceToY,
          );
          if (drawHit) {
            onSelectDrawingRef.current?.(drawHit);
            e.preventDefault();
            return;
          }
        }
        onSelectDrawingRef.current?.(null);
        if (limitPickMode && onPickEntry) {
          const price = priceAtY(e.clientY);
          if (price != null) onPickEntry(price);
        }
        return;
      }

      dragRef.current = hit;

      setDragHint(`${hit.field.toUpperCase()} 拖动中…`);

      wrap.setPointerCapture(e.pointerId);

      e.preventDefault();

    };



    const onMove = (e: PointerEvent) => {

      const drag = dragRef.current;

      if (!drag) return;

      if (drag.id === "__draw__") {
        const sess = drawSessionRef.current;
        const tp = clientToTimePrice(e.clientX, e.clientY);
        if (!sess || !tp || !sess.tool) return;
        const id = "preview";
        const kind = sess.tool;
        setDrawPreview({ id, kind, t1: sess.t1, p1: sess.p1, t2: tp.time, p2: tp.price });
        e.preventDefault();
        return;
      }

      if (drag.id === "__draw_edit__") {
        const edit = drawEditRef.current;
        const tp = clientToTimePrice(e.clientX, e.clientY);
        if (!edit || !tp) return;
        const dt = tp.time - edit.start.time;
        const dp = tp.price - edit.start.price;
        const { orig, mode } = edit;
        if (mode === "p1") {
          replaceDrawing(edit.id, { t1: tp.time, p1: tp.price });
        } else if (mode === "p2") {
          replaceDrawing(edit.id, { t2: tp.time, p2: tp.price });
        } else {
          replaceDrawing(edit.id, {
            t1: orig.t1 + dt,
            p1: +(orig.p1 + dp).toFixed(2),
            t2: orig.t2 + dt,
            p2: +(orig.p2 + dp).toFixed(2),
          });
        }
        e.preventDefault();
        return;
      }

      const price = priceAtY(e.clientY);

      if (price == null) return;

      lastDragPriceRef.current = price;
      onLevelChange(drag.id, drag.field, price);

      e.preventDefault();

    };



    const onUp = (e: PointerEvent) => {

      const drag = dragRef.current;
      if (!drag) return;

      if (drag.id === "__draw__") {
        const sess = drawSessionRef.current;
        const tp = clientToTimePrice(e.clientX, e.clientY);
        if (sess && tp && sess.tool) {
          const kind = sess.tool;
          const minPx = 4;
          const x1 = chartCoordApi().timeToX(sess.t1);
          const y1 = chartCoordApi().priceToY(sess.p1);
          const x2 = chartCoordApi().timeToX(tp.time);
          const y2 = chartCoordApi().priceToY(tp.price);
          const bigEnough =
            x1 != null &&
            y1 != null &&
            x2 != null &&
            y2 != null &&
            (Math.hypot(x2 - x1, y2 - y1) >= minPx || sess.t1 !== tp.time);
          if (bigEnough) {
            pushDrawing({ id: newDrawId(), kind, t1: sess.t1, p1: sess.p1, t2: tp.time, p2: tp.price });
          } else {
            onExitDrawToolRef.current?.();
          }
        }
        drawSessionRef.current = null;
        setDrawPreview(null);
        dragRef.current = null;
        try {
          wrap.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
        return;
      }

      if (drag.id === "__draw_edit__") {
        drawEditRef.current = null;
        dragRef.current = null;
        try {
          wrap.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
        return;
      }

      if (lastDragPriceRef.current != null && onLevelCommit) {
        onLevelCommit(drag.id, drag.field, lastDragPriceRef.current);
      }

      dragRef.current = null;
      lastDragPriceRef.current = null;

      setDragHint(null);

      try {

        wrap.releasePointerCapture(e.pointerId);

      } catch {

        /* ignore */

      }

    };



    wrap.addEventListener("pointerdown", onDown);

    wrap.addEventListener("pointermove", onMove);

    wrap.addEventListener("pointerup", onUp);

    wrap.addEventListener("pointercancel", onUp);

    const onContext = (e: MouseEvent) => {
      if (activeDrawToolRef.current) {
        e.preventDefault();
        onExitDrawToolRef.current?.();
      }
    };
    wrap.addEventListener("contextmenu", onContext);

    return () => {

      wrap.removeEventListener("pointerdown", onDown);

      wrap.removeEventListener("pointermove", onMove);

      wrap.removeEventListener("pointerup", onUp);

      wrap.removeEventListener("pointercancel", onUp);

      wrap.removeEventListener("contextmenu", onContext);

    };

  }, [onLevelChange, limitPickMode, onPickEntry, onLevelCommit, onEntryDoubleClick, selectedDrawingId]);

  const cleanCandles = dedupe(candles);
  const mark =
    markPrice ??
    (cleanCandles.length ? cleanCandles[cleanCandles.length - 1]?.close : null);
  const lastBar = cleanCandles.length ? cleanCandles[cleanCandles.length - 1] : null;
  void coordTick;

  posEntriesRef.current = overlays
    .filter((o) => o.kind === "position" && (o.lots ?? 0) > 0)
    .map((o) => ({ id: o.id, entry: o.entry }));

  const positionLabels = overlays
    .filter((o) => o.kind === "position" && (o.lots ?? 0) > 0)
    .map((o) => {
      const pnl = floatingUsd(o, mark ?? o.entry);
      if (pnl == null) return null;
      const side = o.side === "buy" ? "BUY" : "SELL";
      const lots = (o.lots ?? 0).toFixed(2);
      return {
        id: o.id,
        sideClass: o.side === "buy" ? "pos-side-buy" : "pos-side-sell",
        side,
        lots,
        pnlText: formatPositionPnlUsd(pnl),
        pnlClass: pnl >= 0 ? "pos-pnl-pos" : "pos-pnl-neg",
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    sideClass: string;
    side: string;
    lots: string;
    pnlText: string;
    pnlClass: string;
  }>;

  let drawCloseBtn: { left: number; top: number } | null = null;
  if (selectedDrawingId && onDeleteDrawing) {
    const d = drawings.find((x) => x.id === selectedDrawingId);
    if (d && (d.kind === "trend" || d.kind === "rect" || d.kind === "fib")) {
      const coord = chartCoordApi();
      const x1 = coord.timeToX(d.t1);
      const x2 = coord.timeToX(d.t2);
      const y1 = coord.priceToY(d.p1);
      const y2 = coord.priceToY(d.p2);
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        drawCloseBtn = {
          left: Math.max(x1, x2) + 6,
          top: Math.max(4, Math.min(y1, y2) - 12),
        };
      }
    }
  }

  return (

    <div ref={wrapRef} className={`chart-wrap${activeDrawTool ? " chart-wrap-draw" : ""}`}>

      <div ref={hostRef} className="chart-host" />

      <div className="chart-overlay-layer" aria-hidden>
        {drawCloseBtn ? (
          <button
            type="button"
            className="draw-close-btn"
            style={{ left: drawCloseBtn.left, top: drawCloseBtn.top }}
            title="删除图形"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteDrawing?.(selectedDrawingId!);
            }}
          >
            ×
          </button>
        ) : null}
        {overlaySize.w > 0 ? (
          <ChartDrawingsLayer
            drawings={drawings}
            preview={drawPreview}
            selectedId={selectedDrawingId}
            coord={chartCoordApi()}
            timeframe={timeframe}
            width={overlaySize.w}
            height={overlaySize.h}
          />
        ) : null}

        {positionLabels.map((lb) => (
          <div
            key={lb.id}
            ref={(el) => {
              if (el) posLabelRefs.current.set(lb.id, el);
              else posLabelRefs.current.delete(lb.id);
            }}
            className="chart-pos-line-label"
          >
            <span className={lb.sideClass}>
              {lb.side} {lb.lots}
            </span>
            <span className="chart-pos-sep">, </span>
            <span className={lb.pnlClass}>{lb.pnlText}</span>
          </div>
        ))}

        <div ref={markCountdownWrapRef} className="chart-bar-countdown-wrap">
          <ChartBarCountdown
            timeframe={timeframe}
            lastBarOpenSec={lastBar?.time ?? null}
          />
        </div>
      </div>

      {dragHint ? <div className="chart-drag-banner">{dragHint}</div> : null}

    </div>

  );

});



export default TradingChart;


