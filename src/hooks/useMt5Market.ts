import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchBars,
  fetchMt5Status,
  fetchQuote,
  fetchSymbolMap,
  pingMt5,
  setActiveInstrument,
} from "../api/mt5";
import { instrumentById, type TradeInstrumentId } from "../instruments";
import { generateMockCandles } from "../mockData";
import { barsPollMs, mergeTickIntoLastBar, quotePollMs } from "../tickMerge";
import type { Candle, Timeframe } from "../types";

const PING_MS = 2000;

function medianRtt(samples: number[], next: number): number {
  samples.push(next);
  if (samples.length > 12) samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? next;
}

export interface LatencyState {
  mt5_ms: number | null;
  rtt_ms: number | null;
  server_ms: number | null;
}

export interface MarketState {
  candles: Candle[];
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  symbol: string;
  source: "mt5" | "mock";
  connected: boolean;
  loadingTf: boolean;
  latency: LatencyState;
  error: string | null;
}

export function useMt5Market(timeframe: Timeframe, refreshKey: number, instrumentId: TradeInstrumentId = "xau") {
  const [state, setState] = useState<MarketState>(() => ({
    candles: generateMockCandles(timeframe),
    lastPrice: 2650,
    bid: null,
    ask: null,
    symbol: "XAUUSD",
    source: "mock",
    connected: false,
    loadingTf: true,
    latency: { mt5_ms: null, rtt_ms: null, server_ms: null },
    error: null,
  }));

  const tfRef = useRef(timeframe);
  const instrumentRef = useRef(instrumentId);
  instrumentRef.current = instrumentId;
  const barsAbortRef = useRef<AbortController | null>(null);
  const rttSamplesRef = useRef<number[]>([]);
  tfRef.current = timeframe;

  const resolveBarHint = useCallback(async (waitForEa = false): Promise<string> => {
    const inst = instrumentById(instrumentRef.current);
    const tries = waitForEa ? 20 : 1;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await new Promise((r) => window.setTimeout(r, 150));
      try {
        const { map } = await fetchSymbolMap();
        const resolved = map?.[instrumentRef.current];
        if (resolved) return resolved;
      } catch {
        /* */
      }
    }
    return inst.candidates[0];
  }, []);

  const loadBars = useCallback(async (tf: Timeframe, force = false) => {
    barsAbortRef.current?.abort();
    const ac = new AbortController();
    barsAbortRef.current = ac;
    if (force) {
      setState((s) => ({ ...s, loadingTf: true, error: null }));
    }
    try {
      const hint = await resolveBarHint(force);
      const res = await fetchBars(tf, ac.signal, hint);
      if (ac.signal.aborted || tfRef.current !== tf) return;
      const last = res.candles[res.candles.length - 1];
      setState((s) => ({
        ...s,
        candles: res.candles,
        lastPrice: last?.close ?? s.lastPrice,
        symbol: res.symbol,
        source: "mt5",
        connected: true,
        loadingTf: false,
        error: null,
        latency: {
          ...s.latency,
          mt5_ms: res.mt5_ms,
          rtt_ms: res.rtt_ms,
        },
      }));
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({
        ...s,
        loadingTf: false,
        connected: s.source === "mt5" ? s.connected : false,
        source: s.source === "mt5" ? "mt5" : "mock",
        candles: s.source === "mt5" ? s.candles : generateMockCandles(tf),
        error: msg,
      }));
    }
  }, [resolveBarHint]);

  useEffect(() => {
    setState((s) => (s.loadingTf ? s : { ...s, loadingTf: true }));
    void (async () => {
      try {
        const st = await fetchMt5Status();
        if (st.connected) {
          await loadBars(timeframe, true);
        } else {
          setState((s) => ({
            ...s,
            loadingTf: false,
            connected: false,
            error: st.error ?? "MT5 未连接",
            candles: generateMockCandles(timeframe),
          }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          loadingTf: false,
          error: msg,
          candles: generateMockCandles(timeframe),
        }));
      }
    })();
  }, [timeframe, refreshKey, loadBars]);

  useEffect(() => {
    const inst = instrumentById(instrumentId);
    instrumentRef.current = instrumentId;
    setState((s) => ({
      ...s,
      loadingTf: true,
      candles: [],
      symbol: inst.candidates[0] || inst.short,
      error: null,
    }));
    void (async () => {
      try {
        await setActiveInstrument(instrumentId);
        await loadBars(tfRef.current, true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loadingTf: false, error: msg }));
      }
    })();
  }, [instrumentId, loadBars]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadBars(tfRef.current, false);
    }, barsPollMs(timeframe));
    return () => clearInterval(id);
  }, [timeframe, loadBars]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const q = await fetchQuote();
        if (cancelled) return;
        const tf = tfRef.current;
        setState((s) => {
          const px = Number.isFinite(q.bid) ? q.bid : q.last;
          const quoteSec = Number(q.time);
          const candles =
            s.source === "mt5"
              ? mergeTickIntoLastBar(
                  s.candles,
                  px,
                  tf,
                  Number.isFinite(quoteSec) && quoteSec > 0 ? quoteSec : undefined,
                )
              : s.candles;
          return {
            ...s,
            candles,
            bid: q.bid,
            ask: q.ask,
            lastPrice: px ?? s.lastPrice,
            symbol: q.symbol,
            source: "mt5",
            connected: true,
            latency: {
              ...s.latency,
              mt5_ms: q.mt5_ms,
              rtt_ms: medianRtt(rttSamplesRef.current, q.rtt_ms),
            },
          };
        });
      } catch {
        /* quote errors handled on bars path */
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const ms = quotePollMs(timeframe);
    const id = window.setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [timeframe]);

  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const p = await pingMt5();
        setState((s) => ({
          ...s,
          latency: {
            mt5_ms: p.mt5_ms,
            rtt_ms: medianRtt(rttSamplesRef.current, p.rtt_ms),
            server_ms: p.server_ms,
          },
        }));
      } catch {
        /* ignore */
      }
    }, PING_MS);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(() => loadBars(tfRef.current, true), [loadBars]);

  return { ...state, reload };
}
