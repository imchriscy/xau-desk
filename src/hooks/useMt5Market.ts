import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBars,
  fetchMt5Status,
  fetchQuote,
  fetchSymbolMap,
  pingMt5,
  setActiveInstrument,
} from "../api/mt5";
import {
  instrumentById,
  lastClosePlausibleForInstrument,
  symbolMatchesInstrument,
  symbolsLooselyEqual,
  type TradeInstrumentId,
} from "../instruments";
import { ALL_TIMEFRAMES, generateMockCandles } from "../mockData";
import { barsPollMs, mergeTickIntoLastBar, quotePollMs } from "../tickMerge";
import type { Candle, Timeframe } from "../types";

const PING_MS = 2000;

type BarsCacheEntry = { candles: Candle[]; symbol: string; updatedAt: number };

function cacheKey(inst: TradeInstrumentId, tf: Timeframe): string {
  return `${inst}:${tf}`;
}

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

type LoadBarsOpts = { force?: boolean; showLoading?: boolean };

export function useMt5Market(timeframe: Timeframe, refreshKey: number, instrumentId: TradeInstrumentId = "xau") {
  const barsCacheRef = useRef<Map<string, BarsCacheEntry>>(new Map());

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
  const quoteEpochRef = useRef(0);
  /** state.candles 对应的品种/周期（与 UI 不一致时走缓存或置空） */
  const barsTfRef = useRef<Timeframe>(timeframe);
  const barsInstRef = useRef<TradeInstrumentId | null>(null);
  tfRef.current = timeframe;

  const readCache = useCallback((inst: TradeInstrumentId, tf: Timeframe) => {
    return barsCacheRef.current.get(cacheKey(inst, tf));
  }, []);

  const cacheEntryUsable = useCallback((inst: TradeInstrumentId, entry: BarsCacheEntry | undefined) => {
    if (!entry?.candles.length) return false;
    if (!symbolMatchesInstrument(entry.symbol, inst)) return false;
    const last = entry.candles[entry.candles.length - 1]!.close;
    return lastClosePlausibleForInstrument(inst, last);
  }, []);

  const readUsableCache = useCallback(
    (inst: TradeInstrumentId, tf: Timeframe) => {
      const entry = readCache(inst, tf);
      if (cacheEntryUsable(inst, entry)) return entry;
      if (entry) barsCacheRef.current.delete(cacheKey(inst, tf));
      return undefined;
    },
    [cacheEntryUsable, readCache],
  );

  const writeCache = useCallback(
    (inst: TradeInstrumentId, tf: Timeframe, candles: Candle[], symbol: string) => {
      barsCacheRef.current.set(cacheKey(inst, tf), {
        candles,
        symbol,
        updatedAt: Date.now(),
      });
    },
    [],
  );

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

  const loadBars = useCallback(
    async (tf: Timeframe, opts: LoadBarsOpts = {}) => {
      const force = opts.force ?? false;
      const showLoading = opts.showLoading ?? force;
      const loadInst = instrumentRef.current;

      barsAbortRef.current?.abort();
      const ac = new AbortController();
      barsAbortRef.current = ac;
      if (showLoading) {
        setState((s) => ({ ...s, loadingTf: true, error: null }));
      }
      try {
        const hint = await resolveBarHint(force);
        let res = await fetchBars(tf, ac.signal, hint);
        if (ac.signal.aborted || tfRef.current !== tf || instrumentRef.current !== loadInst) return;
        for (let attempt = 0; attempt < 5; attempt++) {
          const lastTry = res.candles[res.candles.length - 1];
          if (
            !lastTry ||
            res.candles.length === 0 ||
            lastClosePlausibleForInstrument(loadInst, lastTry.close)
          ) {
            break;
          }
          if (!force || ac.signal.aborted) return;
          await new Promise((r) => window.setTimeout(r, 180 + attempt * 80));
          if (tfRef.current !== tf || instrumentRef.current !== loadInst) return;
          res = await fetchBars(tf, ac.signal, hint);
        }
        const last = res.candles[res.candles.length - 1];
        if (last && res.candles.length > 0 && !lastClosePlausibleForInstrument(loadInst, last.close)) {
          if (force) setState((s) => ({ ...s, loadingTf: false, error: "K 线品种未同步，请重选一次品种" }));
          return;
        }
        setState((s) => {
          let candles = res.candles;
          if (
            !force &&
            s.candles.length > 0 &&
            res.candles.length > 0 &&
            instrumentRef.current === loadInst &&
            tfRef.current === tf
          ) {
            const byTime = new Map<number, (typeof res.candles)[0]>();
            for (const c of s.candles) byTime.set(c.time, c);
            for (const c of res.candles) byTime.set(c.time, c);
            const minTime = Math.min(s.candles[0]!.time, res.candles[0]!.time);
            candles = [...byTime.entries()]
              .sort((a, b) => a[0] - b[0])
              .filter(([t]) => t >= minTime)
              .map(([, c]) => c);
            const cap = Math.max(res.candles.length + 80, 600);
            if (candles.length > cap) {
              candles = candles.slice(candles.length - cap);
            }
          }
          if (
            cacheEntryUsable(loadInst, { candles, symbol: res.symbol, updatedAt: Date.now() })
          ) {
            writeCache(loadInst, tf, candles, res.symbol);
          }
          if (tfRef.current === tf && instrumentRef.current === loadInst) {
            barsTfRef.current = tf;
            barsInstRef.current = loadInst;
          }
          return {
            ...s,
            candles,
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
          };
        });
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
    },
    [cacheEntryUsable, resolveBarHint, writeCache],
  );

  const prefetchBars = useCallback(
    async (inst: TradeInstrumentId) => {
      const hint = await resolveBarHint(false);
      for (const tf of ALL_TIMEFRAMES) {
        if (instrumentRef.current !== inst) return;
        if (readUsableCache(inst, tf)?.candles.length) continue;
        try {
          const res = await fetchBars(tf, undefined, hint);
          if (instrumentRef.current !== inst) return;
          const entry = { candles: res.candles, symbol: res.symbol, updatedAt: Date.now() };
          if (cacheEntryUsable(inst, entry)) writeCache(inst, tf, res.candles, res.symbol);
        } catch {
          /* 后台预热失败不影响当前周期 */
        }
        await new Promise((r) => window.setTimeout(r, 40));
      }
    },
    [cacheEntryUsable, readUsableCache, resolveBarHint, writeCache],
  );

  const applyCachedBars = useCallback((inst: TradeInstrumentId, tf: Timeframe) => {
    const cached = readUsableCache(inst, tf);
    if (!cached?.candles.length) return false;
    barsTfRef.current = tf;
    barsInstRef.current = inst;
    const last = cached.candles[cached.candles.length - 1];
    setState((s) => ({
      ...s,
      candles: cached.candles,
      symbol: cached.symbol,
      lastPrice: last?.close ?? s.lastPrice,
      loadingTf: false,
    }));
    return true;
  }, [readUsableCache]);

  useEffect(() => {
    const inst = instrumentRef.current;
    applyCachedBars(inst, timeframe);
    const cached = readUsableCache(inst, timeframe);
    const hasCache = !!(cached && cached.candles.length > 0);
    if (!hasCache) {
      setState((s) => (s.loadingTf ? s : { ...s, loadingTf: true }));
    }

    void (async () => {
      try {
        if (instrumentSwitchingRef.current) return;
        const st = await fetchMt5Status();
        if (st.connected) {
          await loadBars(timeframe, { force: !hasCache, showLoading: !hasCache });
          if (instrumentSwitchingRef.current) return;
          void prefetchBars(inst);
        } else {
          setState((s) => ({
            ...s,
            loadingTf: false,
            connected: s.source === "mt5" ? s.connected : false,
            error:
              s.source === "mt5" && s.connected ? null : st.error ?? "MT5 未连接",
            candles: hasCache ? s.candles : generateMockCandles(timeframe),
          }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          loadingTf: false,
          error: msg,
          candles: hasCache ? s.candles : generateMockCandles(timeframe),
        }));
      }
    })();
  }, [timeframe, refreshKey, loadBars, applyCachedBars, readUsableCache, prefetchBars]);

  const instrumentSwitchingRef = useRef(false);

  useEffect(() => {
    const inst = instrumentById(instrumentId);
    instrumentRef.current = instrumentId;
    quoteEpochRef.current += 1;
    barsInstRef.current = null;
    barsTfRef.current = tfRef.current;
    instrumentSwitchingRef.current = true;
    for (const key of [...barsCacheRef.current.keys()]) {
      if (key.startsWith(`${instrumentId}:`)) barsCacheRef.current.delete(key);
    }
    setState((s) => ({
      ...s,
      loadingTf: true,
      candles: [],
      symbol: inst.candidates[0] || inst.short,
      bid: null,
      ask: null,
      error: null,
    }));
    void (async () => {
      const switchedTo = instrumentId;
      try {
        await setActiveInstrument(instrumentId);
        await resolveBarHint(true);
        await new Promise((r) => window.setTimeout(r, 200));
        if (instrumentRef.current !== switchedTo) return;
        await loadBars(tfRef.current, { force: true, showLoading: true });
        if (instrumentRef.current !== switchedTo) return;
        void prefetchBars(instrumentId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loadingTf: false, error: msg }));
      } finally {
        if (instrumentRef.current === switchedTo) {
          instrumentSwitchingRef.current = false;
        }
      }
    })();
  }, [instrumentId, loadBars, prefetchBars, resolveBarHint]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadBars(tfRef.current, { force: false, showLoading: false });
    }, barsPollMs(timeframe));
    return () => clearInterval(id);
  }, [timeframe, loadBars]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const epoch = quoteEpochRef.current;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const q = await fetchQuote();
        if (cancelled || quoteEpochRef.current !== epoch) return;
        const inst = instrumentRef.current;
        if (q.symbol && !symbolMatchesInstrument(q.symbol, inst)) return;
        const tf = tfRef.current;
        setState((s) => {
          if (quoteEpochRef.current !== epoch) return s;
          if (barsInstRef.current !== inst || barsTfRef.current !== tf) return s;
          if (q.symbol && s.symbol && !symbolsLooselyEqual(q.symbol, s.symbol)) return s;
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
  }, [timeframe, instrumentId]);

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

  const reload = useCallback(() => loadBars(tfRef.current, { force: true, showLoading: true }), [loadBars]);

  const candles = useMemo(() => {
    if (
      barsInstRef.current === instrumentId &&
      barsTfRef.current === timeframe &&
      state.candles.length > 0
    ) {
      const last = state.candles[state.candles.length - 1]!.close;
      if (lastClosePlausibleForInstrument(instrumentId, last)) return state.candles;
    }
    const cached = readUsableCache(instrumentId, timeframe);
    if (cached?.candles.length) return cached.candles;
    if (barsInstRef.current !== instrumentId || barsTfRef.current !== timeframe) return [];
    return state.candles;
  }, [instrumentId, readUsableCache, state.candles, timeframe]);

  return { ...state, candles, reload };
}