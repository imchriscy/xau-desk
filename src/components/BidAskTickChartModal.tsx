import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchQuote } from "../api/mt5";

const TICK_POLL_MS = 350;
const MAX_POINTS = 450;

const TICK_CHART_THEME = {
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
    secondsVisible: true,
  },
  rightPriceScale: {
    borderColor: "#363a45",
  },
};

interface Props {
  open: boolean;
  symbol: string;
  onClose: () => void;
}

function nextChartTime(last: number, mt5Sec: number): UTCTimestamp {
  const base = mt5Sec > 0 ? mt5Sec : Math.floor(Date.now() / 1000);
  const t = last > 0 ? Math.max(base, last + 1) : base;
  return t as UTCTimestamp;
}

export default function BidAskTickChartModal({ open, symbol, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const askRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastTimeRef = useRef(0);
  const bufferRef = useRef<{ time: UTCTimestamp; bid: number; ask: number }[]>([]);

  const [spread, setSpread] = useState<number | null>(null);
  const [lastBid, setLastBid] = useState<number | null>(null);
  const [lastAsk, setLastAsk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = hostRef.current;
    if (!el) return;

    lastTimeRef.current = 0;
    bufferRef.current = [];
    setSpread(null);
    setLastBid(null);
    setLastAsk(null);
    setError(null);

    const chart = createChart(el, {
      ...TICK_CHART_THEME,
      width: el.clientWidth,
      height: el.clientHeight,
      localization: { locale: "zh-CN" },
    });

    const askSeries = chart.addLineSeries({
      color: "#ef5350",
      lineWidth: 2,
      title: "Ask",
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const bidSeries = chart.addLineSeries({
      color: "#2962ff",
      lineWidth: 2,
      title: "Bid",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    askRef.current = askSeries;
    bidRef.current = bidSeries;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      askRef.current = null;
      bidRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let inFlight = false;

    const pushSample = (bid: number, ask: number, mt5Sec: number) => {
      const time = nextChartTime(lastTimeRef.current, mt5Sec);
      lastTimeRef.current = time;
      const buf = bufferRef.current;
      buf.push({ time, bid, ask });
      if (buf.length > MAX_POINTS) {
        bufferRef.current = buf.slice(-MAX_POINTS);
      }
      askRef.current?.update({ time, value: ask } as LineData<Time>);
      bidRef.current?.update({ time, value: bid } as LineData<Time>);
      const chart = chartRef.current;
      if (chart && bufferRef.current.length > 8) {
        chart.timeScale().scrollToRealTime();
      }
    };

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const q = await fetchQuote();
        if (cancelled) return;
        pushSample(q.bid, q.ask, q.time);
        setLastBid(q.bid);
        setLastAsk(q.ask);
        setSpread(Math.max(0, q.ask - q.bid));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), TICK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop tick-spread-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tick-spread-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel modal-panel-tick-spread">
        <div className="modal-head">
          <h2 id="tick-spread-title">
            Tick 买卖价差 · <span className="tick-spread-symbol">{symbol}</span>
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="tick-spread-meta">
          <span className="tick-legend ask">Ask {lastAsk != null ? lastAsk.toFixed(2) : "—"}</span>
          <span className="tick-legend bid">Bid {lastBid != null ? lastBid.toFixed(2) : "—"}</span>
          <span className="tick-legend spread">
            价差 {spread != null ? spread.toFixed(2) : "—"}
          </span>
          <span className="tick-legend muted">轮询 {TICK_POLL_MS}ms · 缓冲 {MAX_POINTS} 点</span>
        </div>
        {error ? <p className="tick-spread-error">{error}</p> : null}
        <div ref={hostRef} className="tick-spread-chart-host" />
      </div>
    </div>
  );
}
