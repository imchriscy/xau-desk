import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBars, fetchMt5Status, fetchQuote, pingMt5 } from "../api/mt5";
import { generateMockCandles } from "../mockData";
import { barsPollMs, mergeTickIntoLastBar, quotePollMs } from "../tickMerge";
import type { Candle, Timeframe } from "../types";

const PING_MS = 2000;

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

export function useMt5Market(timeframe: Timeframe, refreshKey: number) {
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
  const barsAbortRef = useRef<AbortController | null>(null);
  tfRef.current = timeframe;

  const loadBars = useCallback(async (tf: Timeframe, force = false) => {
    barsAbortRef.current?.abort();
    const ac = new AbortController();
    barsAbortRef.current = ac;
    if (force) {
      setState((s) => ({ ...s, loadingTf: true, error: null }));
    }
    try {
      const res = await fetchBars(tf, ac.signal);
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
  }, []);

  useEffect(() => {
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
          const candles =
            s.source === "mt5" ? mergeTickIntoLastBar(s.candles, q.last, tf) : s.candles;
          return {
            ...s,
            candles,
            bid: q.bid,
            ask: q.ask,
            lastPrice: q.last,
            symbol: q.symbol,
            source: "mt5",
            connected: true,
            latency: {
              ...s.latency,
              mt5_ms: q.mt5_ms,
              rtt_ms: q.rtt_ms,
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
            rtt_ms: p.rtt_ms,
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
