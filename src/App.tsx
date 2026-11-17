import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TradingChart, { type TradingChartHandle } from "./components/TradingChart";

import OrderTicket from "./components/OrderTicket";
import PaletteDragLayer from "./components/PaletteDragLayer";

import PositionsPanel from "./components/PositionsPanel";
import SettingsModal from "./components/SettingsModal";
import RiskHud from "./components/RiskHud";
import RiskPanel from "./components/RiskPanel";
import DailyHardRiskPanel from "./components/DailyHardRiskPanel";
import StreakOrdinanceModal from "./components/StreakOrdinanceModal";
import { useStreakOrdinanceAlert } from "./hooks/useStreakOrdinanceAlert";
import ChartToolbars from "./components/ChartToolbars";
import BidAskTickChartModal from "./components/BidAskTickChartModal";
import ChartIndicatorLegend from "./components/ChartIndicatorLegend";
import Mt5ConnectBanner from "./components/Mt5ConnectBanner";
import { buildIndicatorRenderPlans } from "./chartIndicators";
import { loadStoredChartUi, saveStoredChartUi } from "./chartIndicatorStorage";
import { fetchBars } from "./api/mt5";
import { generateMockCandles } from "./mockData";
import InstrumentPicker from "./components/InstrumentPicker";
import {
  STORAGE_INSTRUMENT_KEY,
  TRADE_INSTRUMENTS,
  formatPrice,
  instrumentById,
  type TradeInstrumentId,
} from "./instruments";
import { symbolsMatch } from "./lib/goldSymbol";
import { positionMarkPnl } from "./instrumentPnl";
import { useMt5Market } from "./hooks/useMt5Market";
import { useMt5Account } from "./hooks/useMt5Account";
import { useMt5PositionsSync } from "./hooks/useMt5PositionsSync";
import { useMt5OrdersSync } from "./hooks/useMt5OrdersSync";
import {
  cancelMt5Order,
  closeMt5Position,
  modifyMt5Order,
  modifyMt5Position,
  sendMarketOrder,
  fetchGatewayVersion,
  gatewayVersionHint,
  sendPendingOrder,
  shouldExecuteOnMt5,
} from "./api/mt5";
import { useRiskStatus } from "./hooks/useRiskStatus";
import { loadSettings, type AppSettings } from "./settingsStorage";

import { clampSlTp, slTpFromOffsets } from "./orderLogic";

import SlTpEditorPanel, { type SlTpEditorModel } from "./components/SlTpEditorPanel";
import { DRAFT_OVERLAY_ID, defaultSlTp, inferSide, modeLabel } from "./orderDraftLogic";

import type {
  ArmState,
  Candle,
  ChartDrawing,
  ChartIndicatorInst,
  ChartTradeOverlay,
  CrosshairInfo,
  DrawToolKind,
  LevelField,
  OrderFormState,
  OrderSide,
  PendingOrderMode,
  PendingPaletteDrag,
  Position,
  StopLimitDraft,
  Timeframe,
} from "./types";

function migrateChartIndicators(raw: ChartIndicatorInst[]): ChartIndicatorInst[] {
  const list = raw.map((i) => ({
    ...i,
    sourceTimeframe: i.sourceTimeframe ?? "1m",
  }));
  if (!list.some((i) => i.type === "vol")) {
    list.unshift({
      id: "vol-default",
      type: "vol",
      sourceTimeframe: "1m",
      visible: true,
      length: 1,
    });
  }
  return list;
}

import "./styles/global.css";
import "./styles/chart-analysis.css";



const TIMEFRAMES: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

function hitChartWrap(clientX: number, clientY: number, wrap: HTMLElement | null): boolean {
  if (!wrap) return false;
  const r = wrap.getBoundingClientRect();
  return (
    clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
  );
}

const DEFAULT_FORM: OrderFormState = {

  kind: "market",

  lots: 0.01,

  slOffset: 4,

  tpOffset: 4,

};



function fmtTime(ts: number | null): string {

  if (ts == null) return "—";

  return new Date(ts * 1000).toLocaleString("zh-CN", {

    month: "2-digit",

    day: "2-digit",

    hour: "2-digit",

    minute: "2-digit",

  });

}



export default function App() {

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");

  const [armState, setArmState] = useState<ArmState>("disarmed");


  const [crosshair, setCrosshair] = useState<CrosshairInfo>({

    time: null,

    price: null,

    ohlc: null,

  });

  const [flash, setFlash] = useState("");

  const [dataEpoch, setDataEpoch] = useState(0);
  const [tradeInstrument, setTradeInstrument] = useState<TradeInstrumentId>(() => {
    try {
      const s = localStorage.getItem(STORAGE_INSTRUMENT_KEY) as TradeInstrumentId | null;
      if (s && TRADE_INSTRUMENTS.some((i) => i.id === s)) return s;
    } catch {
      /* */
    }
    return "xau";
  });

  const [form, setForm] = useState<OrderFormState>(DEFAULT_FORM);

  const [paperPositions, setPaperPositions] = useState<Position[]>([]);

  const [orderSyncTick, setOrderSyncTick] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [dailyHardRiskOpen, setDailyHardRiskOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawToolKind>(null);
  const storedChartUi = useMemo(() => loadStoredChartUi(), []);
  const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>(() => storedChartUi.drawings);
  const [chartIndicators, setChartIndicators] = useState<ChartIndicatorInst[]>(() =>
    migrateChartIndicators(storedChartUi.indicators),
  );
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [auxCandlesByTf, setAuxCandlesByTf] = useState<Partial<Record<Timeframe, Candle[]>>>({});
  const [levelOverrides, setLevelOverrides] = useState<
    Record<string, { entry?: number; sl?: number | null; tp?: number | null }>
  >({});

  const [slTpEditor, setSlTpEditor] = useState<SlTpEditorModel | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PendingPaletteDrag | null>(null);
  const [stopLimitDraft, setStopLimitDraft] = useState<StopLimitDraft | null>(null);
  const stopLimitDraftRef = useRef(stopLimitDraft);
  stopLimitDraftRef.current = stopLimitDraft;

  const [accountEpoch, setAccountEpoch] = useState(0);

  const [posSyncTick, setPosSyncTick] = useState(0);
  const accountFinRef = useRef<string | null>(null);

  const chartRef = useRef<TradingChartHandle>(null);
  const pendingTfScrollRef = useRef<Timeframe | null>(null);
  const [tickSpreadOpen, setTickSpreadOpen] = useState(false);

  const onTimeframe = useCallback((tf: Timeframe) => {
    if (tf === timeframe) return;
    pendingTfScrollRef.current = tf;
    setTimeframe(tf);
  }, [timeframe]);

  const formRef = useRef(form);

  const armRef = useRef(armState);

  const settingsRef = useRef(settings);

  formRef.current = form;

  armRef.current = armState;

  settingsRef.current = settings;



  const market = useMt5Market(timeframe, dataEpoch, tradeInstrument);

  const onTradeInstrument = useCallback((id: TradeInstrumentId) => {
    setTradeInstrument(id);
    const inst = instrumentById(id);
    setForm((f) => ({ ...f, slOffset: inst.defaultSlOffset, tpOffset: inst.defaultTpOffset }));
    setOptimisticPos([]);
    setHiddenTickets([]);
    try {
      localStorage.setItem(STORAGE_INSTRUMENT_KEY, id);
    } catch {
      /* */
    }
    setDataEpoch((n) => n + 1);
    setPosSyncTick((n) => n + 1);
    setOrderSyncTick((n) => n + 1);
    setFlash(`已切换 ${inst.label}，等待 MT5 行情…`);
  }, []);

  const onMt5SessionChange = useCallback((session: string, prev: string | null) => {
    setFlash(`MT5 已切换 ${prev ?? "?"} → ${session}`);
    setAccountEpoch((n) => n + 1);
    setDataEpoch((n) => n + 1);
    setPosSyncTick((n) => n + 1);
    setOrderSyncTick((n) => n + 1);
  }, []);

  const { account, error: accountError, reload: reloadAccount, statusMeta } = useMt5Account(
    dataEpoch + accountEpoch,
    onMt5SessionChange,
  );
  const { status: riskStatus } = useRiskStatus(market.connected, account?.login);
  const streakOrdinanceAlert = useStreakOrdinanceAlert(riskStatus);

  const dailyPnlUsd = useMemo(() => {
    if (!account) return null;
    const baseline = riskStatus?.config.baseline_equity;
    if (baseline != null && riskStatus?.account_login === account.login) {
      return account.equity - baseline;
    }
    return account.equity - account.balance;
  }, [account, riskStatus]);
  const riskStatusRef = useRef(riskStatus);
  riskStatusRef.current = riskStatus;

  useEffect(() => {
    if (riskStatus?.halted) {
      setArmState("disarmed");
      setPosSyncTick((n) => n + 1);
      setOrderSyncTick((n) => n + 1);
    }
  }, [riskStatus?.halted]);

  const executeOnMt5 = shouldExecuteOnMt5(account);

  const mt5Positions = useMt5PositionsSync(
    executeOnMt5,
    "",
    posSyncTick,
    account?.margin,
  );
  const mt5Pending = useMt5OrdersSync(executeOnMt5, market.symbol, orderSyncTick);
  const pending = executeOnMt5 ? mt5Pending : [];

  const [optimisticPos, setOptimisticPos] = useState<Position[]>([]);
  const [hiddenTickets, setHiddenTickets] = useState<number[]>([]);

  const flatByMargin =
    executeOnMt5 && account != null && account.margin <= 1.5;
  const positions = executeOnMt5
    ? flatByMargin
      ? []
      : [
          ...mt5Positions.filter((p) => !hiddenTickets.includes(p.ticket)),
          ...optimisticPos.filter(
            (p) =>
              !hiddenTickets.includes(p.ticket) &&
              !mt5Positions.some((m) => m.ticket === p.ticket),
          ),
        ]
    : paperPositions;

  const positionsForInstrument = useMemo(() => {
    const sym = market.symbol;
    let list = sym
      ? positions.filter((p) => !p.symbol || symbolsMatch(p.symbol, sym))
      : positions;
    if (executeOnMt5 && account && account.margin <= 1.5 && list.length > 0) {
      list = [];
    }
    return list;
  }, [positions, market.symbol, executeOnMt5, account?.margin]);

  useEffect(() => {
    const live = new Set(mt5Positions.map((p) => p.ticket));
    const margin = account?.margin;
    setOptimisticPos((list) => {
      if (list.length === 0) return list;
      if (live.size === 0 && margin != null && margin <= 1.5) return [];
      return list.filter((p) => !live.has(p.ticket));
    });
    setHiddenTickets((list) => list.filter((t) => live.has(t)));
  }, [mt5Positions, account?.margin]);

  useEffect(() => {
    if (positionsForInstrument.length > 0) return;
    const sel = selectedIdRef.current;
    if (sel && (sel.startsWith("mt5-") || sel.startsWith("mt5-order-"))) {
      setSelectedId(null);
    }
  }, [positionsForInstrument.length]);

  const positionsRef = useRef(positionsForInstrument);
  const pendingRef = useRef(pending);
  const slTpEditorRef = useRef(slTpEditor);

  const executeOnMt5Ref = useRef(executeOnMt5);

  positionsRef.current = positionsForInstrument;
  pendingRef.current = pending;
  slTpEditorRef.current = slTpEditor;

  executeOnMt5Ref.current = executeOnMt5;
  const { reload: reloadBars } = market;

  const candles = market.candles;
  const lastPrice = market.lastPrice;

  useEffect(() => {
    saveStoredChartUi({ indicators: chartIndicators, drawings: chartDrawings });
  }, [chartIndicators, chartDrawings]);

  useEffect(() => {
    const needed = [
      ...new Set(
        chartIndicators
          .map((i) => i.sourceTimeframe ?? "1m")
          .filter((tf) => tf !== timeframe),
      ),
    ] as Timeframe[];
    if (needed.length === 0) {
      setAuxCandlesByTf({});
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      const next: Partial<Record<Timeframe, Candle[]>> = {};
      for (const tf of needed) {
        try {
          const res = await fetchBars(tf, ac.signal);
          if (cancelled) return;
          next[tf] = res.candles;
        } catch {
          if (cancelled) return;
          next[tf] = generateMockCandles(tf);
        }
      }
      if (!cancelled) setAuxCandlesByTf(next);
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [chartIndicators, timeframe, dataEpoch]);

  const indicatorPlans = useMemo(() => {
    const byTf: Partial<Record<Timeframe, Candle[]>> = {
      ...auxCandlesByTf,
      [timeframe]: candles,
    };
    return buildIndicatorRenderPlans(chartIndicators, timeframe, candles, byTf);
  }, [chartIndicators, timeframe, candles, auxCandlesByTf]);

  const volumeVisible = useMemo(
    () => chartIndicators.some((i) => i.type === "vol" && i.visible),
    [chartIndicators],
  );

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    setChartDrawings((list) => list.filter((d) => d.id !== selectedDrawingId));
    setSelectedDrawingId(null);
  }, [selectedDrawingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (!selectedDrawingId) return;
      e.preventDefault();
      deleteSelectedDrawing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDrawingId, deleteSelectedDrawing]);
  const midPrice =
    market.bid != null && market.ask != null ? (market.bid + market.ask) / 2 : lastPrice;
  const midPriceRef = useRef(midPrice);
  midPriceRef.current = midPrice;

  const refreshMock = useCallback(() => {
    setDataEpoch((n) => n + 1);
    reloadBars();
    setFlash("已从 MT5 拉取 K 线");
    queueMicrotask(() => chartRef.current?.resetVisibleRange());
  }, [reloadBars]);

  const lastCandleTime = candles.length > 0 ? candles[candles.length - 1].time : 0;

  useEffect(() => {
    if (pendingTfScrollRef.current !== timeframe) return;
    if (market.loadingTf || candles.length === 0) return;
    pendingTfScrollRef.current = null;
    const scroll = () => chartRef.current?.scrollToLatest();
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(scroll);
    });
    const t = window.setTimeout(scroll, 80);
    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(t);
    };
  }, [timeframe, market.loadingTf, candles.length, lastCandleTime]);

  const prevClose = candles.length > 2 ? candles[candles.length - 2].close : lastPrice;

  const chg = lastPrice - prevClose;

  const chgPct = prevClose ? (chg / prevClose) * 100 : 0;



  useEffect(() => {
    void fetchGatewayVersion().then((v) => {
      const hint = gatewayVersionHint(v);
      if (hint) setFlash(hint);
    });
  }, []);

  useEffect(() => {
    if (!account || !executeOnMt5) return;
    const fin = `${account.equity.toFixed(2)}|${account.profit.toFixed(2)}|${account.margin.toFixed(2)}`;
    const prev = accountFinRef.current;
    if (prev && prev !== fin) {
      setPosSyncTick((n) => n + 1);
      setOptimisticPos([]);
      if (account.margin <= 1.5) setHiddenTickets([]);
    }
    accountFinRef.current = fin;
  }, [account, executeOnMt5]);

  // 仅在市场事件（成交/改单/平仓）时默认选中最新单；轮询刷新持仓列表不得抢用户当前选中
  useEffect(() => {
    if (orderSyncTick === 0) return;
    const list = pendingRef.current;
    if (list.length === 0) return;
    const sel = selectedIdRef.current;
    if (sel && list.some((p) => p.id === sel)) return;
    const latest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) setSelectedId(latest.id);
  }, [orderSyncTick]);

  useEffect(() => {
    if (!executeOnMt5 || posSyncTick === 0) return;
    const list = positionsRef.current;
    if (list.length === 0) return;
    const sel = selectedIdRef.current;
    if (sel && list.some((p) => p.id === sel)) return;
    const latest = [...list].sort((a, b) => b.openTime - a.openTime)[0];
    if (latest) setSelectedId(latest.id);
  }, [posSyncTick, executeOnMt5]);

  const submitPendingAtPrice = useCallback(
    async (mode: PendingOrderMode, price: number) => {
      if (armRef.current !== "armed") {
        setFlash("请先 ARM 后再拖挂单卡片");
        return;
      }
      if (riskStatus?.halted) {
        setFlash(riskStatus.halt_reason ?? "日风控暂停");
        return;
      }
      const f = formRef.current;
      const mid = midPriceRef.current;
      const side = inferSide(mode, price, mid);
      if (!account) {
        setFlash("未读取 MT5 账户：请打开 MT5 并运行 restart-backend.cmd");
        return;
      }
      try {
        const res = await sendPendingOrder({
          mode,
          side,
          lots: f.lots,
          symbol: market.symbol,
          price,
          stoplimit: null,
          sl: null,
          tp: null,
          allow_demo_mt5: true,
        });
        if (!res.ok) {
          setFlash("MT5 挂单拒单");
          return;
        }
        setOrderSyncTick((n) => n + 1);
        setFlash(`${modeLabel(mode)} ${side.toUpperCase()} @ ${price.toFixed(2)} · 已挂单，可在图上再拖止损/止盈`);
        window.setTimeout(() => setOrderSyncTick((n) => n + 1), 400);
      } catch (e) {
        setFlash(e instanceof Error ? e.message : String(e));
      }
    },
    [account, riskStatus],
  );

  const submitStopLimitAtPrices = useCallback(
    async (stopPrice: number, triggerPrice: number, side: OrderSide) => {
      if (armRef.current !== "armed") {
        setFlash("请先 ARM 后再拖挂单卡片");
        return;
      }
      if (riskStatus?.halted) {
        setFlash(riskStatus.halt_reason ?? "日风控暂停");
        return;
      }
      if (!account) {
        setFlash("未读取 MT5 账户：请打开 MT5 并运行 restart-backend.cmd");
        return;
      }
      const f = formRef.current;
      const stop = +stopPrice.toFixed(2);
      const trigger = +triggerPrice.toFixed(2);
      try {
        const res = await sendPendingOrder({
          mode: "stop_limit",
          side,
          lots: f.lots,
          symbol: market.symbol,
          price: stop,
          stoplimit: trigger,
          sl: null,
          tp: null,
          allow_demo_mt5: true,
        });
        if (!res.ok) {
          setFlash("MT5 StopLimit 拒单");
          return;
        }
        setStopLimitDraft(null);
        setOrderSyncTick((n) => n + 1);
        setFlash(
          `StopLimit ${side.toUpperCase()} STOP ${stop.toFixed(2)} · 触发 ${trigger.toFixed(2)} · 已送 MT5`,
        );
        window.setTimeout(() => setOrderSyncTick((n) => n + 1), 400);
      } catch (e) {
        setFlash(e instanceof Error ? e.message : String(e));
      }
    },
    [account, riskStatus],
  );

  const cancelStopLimitDraft = useCallback(() => {
    if (!stopLimitDraftRef.current) return;
    setStopLimitDraft(null);
    setFlash("已取消 StopLimit（双击卡片）");
  }, []);

  const onPaletteDragMove = useCallback((mode: PendingOrderMode, clientX: number, clientY: number) => {
    const wrap = chartRef.current?.getWrapElement() ?? null;
    const inChart = hitChartWrap(clientX, clientY, wrap);
    const price = inChart ? chartRef.current?.clientYToPrice(clientY) ?? null : null;
    setPaletteDrag({
      mode,
      clientX,
      clientY,
      inChart,
      price,
      lots: formRef.current.lots,
    });
  }, []);

  const onPaletteDragEnd = useCallback(
    (mode: PendingOrderMode, clientX: number, clientY: number) => {
      const wrap = chartRef.current?.getWrapElement() ?? null;
      const inChart = hitChartWrap(clientX, clientY, wrap);
      const price = inChart ? chartRef.current?.clientYToPrice(clientY) ?? null : null;
      setPaletteDrag(null);
      if (!inChart || price == null) return;

      if (mode === "stop_limit") {
        const draft = stopLimitDraftRef.current;
        if (!draft) {
          if (armRef.current !== "armed") {
            setFlash("请先 ARM 后再拖 StopLimit 卡片");
            return;
          }
          setStopLimitDraft({
            stopPrice: price,
            side: inferSide("stop_limit", price, midPriceRef.current),
            lots: formRef.current.lots,
          });
          setFlash(
            `第 1 层触发价 ${price.toFixed(2)}。在图上再点一下，放下第 2 层限价`,
          );
          return;
        }
        void submitStopLimitAtPrices(draft.stopPrice, price, draft.side);
        return;
      }

      void submitPendingAtPrice(mode, price);
    },
    [submitPendingAtPrice, submitStopLimitAtPrices],
  );

  const openSlTpEditor = useCallback(
    (overlayId: string) => {
      const pos = positionsRef.current.find((p) => p.id === overlayId);
      const pend = pendingRef.current.find((p) => p.id === overlayId);
      if (pos) {
        setSlTpEditor({
          overlayId,
          kind: "position",
          entry: pos.openPrice,
          side: pos.side,
          lots: pos.lots,
          sl: pos.sl,
          tp: pos.tp,
          slEnabled: pos.sl != null,
          tpEnabled: pos.tp != null,
        });
        setSelectedId(overlayId);
        return;
      }
      if (pend) {
        setSlTpEditor({
          overlayId,
          kind: "pending",
          entry: pend.entryPrice,
          side: pend.side,
          lots: pend.lots,
          sl: pend.sl,
          tp: pend.tp,
          slEnabled: pend.sl != null,
          tpEnabled: pend.tp != null,
        });
        setSelectedId(overlayId);
      }
    },
    [],
  );

  const patchSlTpEditor = useCallback((patch: Partial<SlTpEditorModel>) => {
    setSlTpEditor((m) => {
      if (!m) return m;
      const f = formRef.current;
      const next = { ...m, ...patch };
      if (patch.slEnabled === true && next.sl == null) {
        next.sl = defaultSlTp(next.side, next.entry, f.slOffset, 0).sl;
      }
      if (patch.slEnabled === false) next.sl = null;
      if (patch.tpEnabled === true && next.tp == null) {
        next.tp = defaultSlTp(next.side, next.entry, 0, f.tpOffset).tp;
      }
      if (patch.tpEnabled === false) next.tp = null;
      return next;
    });
  }, []);

  const confirmSlTpEditor = useCallback(async () => {
    const ed = slTpEditor;
    if (!ed) return;
    if (!ed.slEnabled && !ed.tpEnabled) return;
    const sl = ed.slEnabled ? ed.sl : undefined;
    const tp = ed.tpEnabled ? ed.tp : undefined;
    const exec = executeOnMt5Ref.current;
    try {
      if (ed.kind === "position") {
        const pos = positionsRef.current.find((p) => p.id === ed.overlayId);
        if (!pos) return;
        if (exec) {
          await modifyMt5Position(
            pos.ticket,
            ed.slEnabled ? sl ?? null : undefined,
            ed.tpEnabled ? tp ?? null : undefined,
          );
          setPosSyncTick((n) => n + 1);
        } else {
          setPaperPositions((list) =>
            list.map((p) =>
              p.id !== ed.overlayId
                ? p
                : {
                    ...p,
                    sl: ed.slEnabled ? (sl ?? p.sl) : p.sl,
                    tp: ed.tpEnabled ? (tp ?? p.tp) : p.tp,
                  },
            ),
          );
        }
      } else {
        const pend = pendingRef.current.find((p) => p.id === ed.overlayId);
        if (!pend) return;
        if (exec && pend.ticket) {
          await modifyMt5Order(pend.ticket, {
            sl: ed.slEnabled ? sl ?? null : undefined,
            tp: ed.tpEnabled ? tp ?? null : undefined,
          });
          setOrderSyncTick((n) => n + 1);
        }
      }
      setLevelOverrides((o) => {
        const next = { ...o };
        delete next[ed.overlayId];
        return next;
      });
      setFlash("止盈止损已更新");
      setSlTpEditor(null);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, [slTpEditor]);

  const onCrosshair = useCallback((info: CrosshairInfo) => setCrosshair(info), []);

  const onLastPrice = useCallback((_p: number) => {}, []);



  const closingTicketsRef = useRef<Set<number>>(new Set());
  const buySeqRef = useRef(0);

  const submitOrder = useCallback(
    async (side: OrderSide) => {
      if (riskStatus?.halted) {
        setFlash(
          riskStatus.halt_reason ??
            (riskStatus.halt_kind === "streak"
              ? "连续止损冷却中，请等待倒计时结束"
              : "日风控暂停，下一交易日 06:00（北京）恢复"),
        );
        return;
      }
      const f = formRef.current;
      if (f.kind !== "market") {
        setFlash("图形挂单请拖卡片到 K 线松手");
        return;
      }
      if (!account) {
        setFlash("未读取 MT5 账户：请打开 MT5 并运行 restart-backend.cmd");
        return;
      }
      const inst = instrumentById(tradeInstrument);
      const { sl, tp } = slTpFromOffsets(
        side,
        lastPrice,
        f.slOffset,
        f.tpOffset,
        inst.digits,
      );
      const seq = ++buySeqRef.current;
      setFlash(`${side === "buy" ? "买入" : "卖出"} #${seq} 已排队`);
      try {
        const res = await sendMarketOrder({
          side,
          lots: f.lots,
          symbol: market.symbol,
          sl: f.slOffset > 0 ? sl : null,
          tp: f.tpOffset > 0 ? tp : null,
          allow_demo_mt5: true,
        });
        if (!res.ok) {
          setFlash(`${side === "buy" ? "买" : "卖"} #${seq} 被拒`);
          return;
        }
        if (res.ticket) {
          const px =
            res.price ??
            (side === "buy" ? market.ask : market.bid) ??
            lastPrice;
          const id = `mt5-${res.ticket}`;
          setOptimisticPos((list) => [
            ...list.filter((p) => p.ticket !== res.ticket),
            {
              id,
              ticket: res.ticket!,
              side,
              lots: f.lots,
              openPrice: px,
              sl: f.slOffset > 0 ? sl : null,
              tp: f.tpOffset > 0 ? tp : null,
              openTime: Date.now() / 1000,
              symbol: market.symbol,
            },
          ]);
          setSelectedId(id);
        }
        setPosSyncTick((n) => n + 1);
        void reloadAccount();
        setFlash(`${side === "buy" ? "买" : "卖"} #${seq} 已成交`);
      } catch (e) {
        setFlash(`#${seq} ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [account, lastPrice, market.ask, market.bid, reloadAccount, riskStatus, tradeInstrument],
  );

  const closePositionById = useCallback((id: string) => {
    const p = positionsRef.current.find((x) => x.id === id);
    if (!p) return;
    if (closingTicketsRef.current.has(p.ticket)) {
      setFlash(`#${p.ticket} 已在平仓队列`);
      return;
    }
    if (executeOnMt5Ref.current) {
      closingTicketsRef.current.add(p.ticket);
      setHiddenTickets((list) => (list.includes(p.ticket) ? list : [...list, p.ticket]));
      const rest = positionsRef.current.filter(
        (x) => x.id !== id && !closingTicketsRef.current.has(x.ticket),
      );
      if (selectedIdRef.current === id) setSelectedId(rest[0]?.id ?? null);
      setFlash(`平仓 #${p.ticket} 已排队`);
      void closeMt5Position(p.ticket)
        .then(() => {
          closingTicketsRef.current.delete(p.ticket);
          setHiddenTickets((list) => list.filter((t) => t !== p.ticket));
          setOptimisticPos((list) => list.filter((x) => x.ticket !== p.ticket));
          setPosSyncTick((n) => n + 1);
          setFlash(`已平仓 #${p.ticket} · ${p.side.toUpperCase()} ${p.lots}`);
        })
        .catch((e) => {
          closingTicketsRef.current.delete(p.ticket);
          setHiddenTickets((list) => list.filter((t) => t !== p.ticket));
          setFlash(e instanceof Error ? e.message : String(e));
        });
    } else {
      setPaperPositions((list) => list.filter((x) => x.id !== id));
      setFlash("已平仓");
      if (selectedIdRef.current === id) setSelectedId(null);
    }
  }, []);

  const onLevelCommit = useCallback((id: string, field: LevelField, price: number) => {
    if (slTpEditorRef.current?.overlayId === id) return;
    const pos = positionsRef.current.find((p) => p.id === id);
    const pend = pendingRef.current.find((p) => p.id === id);
    if (executeOnMt5Ref.current && pos && field !== "entry") {
      const sl = field === "sl" ? clampSlTp(pos.side, "sl", pos.openPrice, price) : pos.sl;
      const tp = field === "tp" ? clampSlTp(pos.side, "tp", pos.openPrice, price) : pos.tp;
      void modifyMt5Position(pos.ticket, sl, tp)
        .then(() => {
          setLevelOverrides((o) => {
            const next = { ...o };
            delete next[id];
            return next;
          });
          setPosSyncTick((n) => n + 1);
        })
        .catch((e) => setFlash(e instanceof Error ? e.message : String(e)));
      return;
    }
    if (executeOnMt5Ref.current && pend?.ticket) {
      const entry = pend.entryPrice;
      const px = +price.toFixed(2);
      const patch: { price?: number; sl?: number | null; tp?: number | null } = {};
      if (field === "entry") patch.price = px;
      if (field === "sl") patch.sl = clampSlTp(pend.side, "sl", entry, px);
      if (field === "tp") patch.tp = clampSlTp(pend.side, "tp", entry, px);
      void modifyMt5Order(pend.ticket, patch)
        .then(() => {
          setLevelOverrides((o) => {
            const next = { ...o };
            delete next[id];
            return next;
          });
          setOrderSyncTick((n) => n + 1);
        })
        .catch((e) => setFlash(e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const onLevelChange = useCallback((id: string, field: LevelField, price: number) => {
    const ed = slTpEditorRef.current;
    if (ed?.overlayId === id && (field === "sl" || field === "tp")) {
      const px = field === "sl"
        ? clampSlTp(ed.side, "sl", ed.entry, price)
        : clampSlTp(ed.side, "tp", ed.entry, price);
      setSlTpEditor((m) =>
        m && m.overlayId === id
          ? {
              ...m,
              [field]: px,
              slEnabled: field === "sl" ? true : m.slEnabled,
              tpEnabled: field === "tp" ? true : m.tpEnabled,
            }
          : m,
      );
    }

    const pos = positionsRef.current.find((p) => p.id === id);
    if (executeOnMt5Ref.current && pos) {
      if (field === "entry") return;
      const sl = field === "sl" ? clampSlTp(pos.side, "sl", pos.openPrice, price) : pos.sl;
      const tp = field === "tp" ? clampSlTp(pos.side, "tp", pos.openPrice, price) : pos.tp;
      setLevelOverrides((o) => ({
        ...o,
        [id]: {
          ...o[id],
          sl: field === "sl" ? sl : o[id]?.sl ?? pos.sl,
          tp: field === "tp" ? tp : o[id]?.tp ?? pos.tp,
        },
      }));
      return;
    }

    setPaperPositions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (field === "entry") return p;
        if (field === "sl") return { ...p, sl: clampSlTp(p.side, "sl", p.openPrice, price) };
        return { ...p, tp: clampSlTp(p.side, "tp", p.openPrice, price) };
      }),
    );

    if (field === "entry") {
      const entryPrice = +price.toFixed(2);
      setLevelOverrides((ov) => ({ ...ov, [id]: { ...ov[id], entry: entryPrice } }));
    }

    const pend = pendingRef.current.find((p) => p.id === id);
    if (pend && field === "entry") setSelectedId(id);
    if (pend && executeOnMt5Ref.current) {
      const entryPrice = field === "entry" ? +price.toFixed(2) : pend.entryPrice;
      setLevelOverrides((ov) => ({
        ...ov,
        [id]: {
          ...ov[id],
          entry: field === "entry" ? entryPrice : ov[id]?.entry,
          sl:
            field === "sl"
              ? clampSlTp(pend.side, "sl", entryPrice, price)
              : ov[id]?.sl,
          tp:
            field === "tp"
              ? clampSlTp(pend.side, "tp", entryPrice, price)
              : ov[id]?.tp,
        },
      }));
    }

  }, []);



  const overlays: ChartTradeOverlay[] = useMemo(() => {
    const out: ChartTradeOverlay[] = [];

    const slFor = (id: string, base: number | null) => {
      if (slTpEditor?.overlayId !== id) return base;
      if (!slTpEditor.slEnabled) return null;
      return levelOverrides[id]?.sl !== undefined ? levelOverrides[id].sl! : slTpEditor.sl;
    };
    const tpFor = (id: string, base: number | null) => {
      if (slTpEditor?.overlayId !== id) return base;
      if (!slTpEditor.tpEnabled) return null;
      return levelOverrides[id]?.tp !== undefined ? levelOverrides[id].tp! : slTpEditor.tp;
    };
    const selected = (id: string) => selectedId === id || slTpEditor?.overlayId === id;

    for (const p of positionsForInstrument) {
      const ov = levelOverrides[p.id];
      const mark =
        market.bid != null && market.ask != null
          ? p.side === "buy"
            ? market.bid
            : market.ask
          : lastPrice;
      const profitUsd = positionMarkPnl(p, mark, tradeInstrument);
      out.push({
        id: p.id,
        kind: "position",
        side: p.side,
        entry: p.openPrice,
        lots: p.lots,
        sl: slFor(p.id, ov?.sl !== undefined ? ov.sl : p.sl),
        tp: tpFor(p.id, ov?.tp !== undefined ? ov.tp : p.tp),
        selected: selected(p.id),
        profitUsd,
      });
    }

    for (const o of pending) {
      const ov = levelOverrides[o.id];
      out.push({
        id: o.id,
        kind: "pending",
        side: o.side,
        entry: ov?.entry ?? o.entryPrice,
        lots: o.lots,
        sl: slFor(o.id, ov?.sl !== undefined ? ov.sl : o.sl),
        tp: tpFor(o.id, ov?.tp !== undefined ? ov.tp : o.tp),
        selected: selected(o.id),
      });
    }

    if (stopLimitDraft) {
      out.push({
        id: DRAFT_OVERLAY_ID,
        kind: "draft",
        side: stopLimitDraft.side,
        entry: stopLimitDraft.stopPrice,
        sl: null,
        tp: null,
        selected: true,
        label: `STOP ${stopLimitDraft.stopPrice.toFixed(2)}`,
      });
    }

    return out;
  }, [
    positionsForInstrument,
    pending,
    selectedId,
    levelOverrides,
    slTpEditor,
    lastPrice,
    stopLimitDraft,
    tradeInstrument,
    market.bid,
    market.ask,
  ]);

  const pendingDragPreview = useMemo(() => {
    if (!paletteDrag?.inChart || paletteDrag.price == null) return null;
    if (paletteDrag.mode === "stop_limit") {
      if (stopLimitDraft) {
        return {
          mode: "stop_limit" as const,
          price: paletteDrag.price,
          side: stopLimitDraft.side,
          lots: paletteDrag.lots,
          stopLimitPhase: 2 as const,
          stopLimitStopPrice: stopLimitDraft.stopPrice,
        };
      }
      return {
        mode: "stop_limit" as const,
        price: paletteDrag.price,
        side: inferSide("stop_limit", paletteDrag.price, midPrice),
        lots: paletteDrag.lots,
        stopLimitPhase: 1 as const,
      };
    }
    return {
      mode: paletteDrag.mode,
      price: paletteDrag.price,
      side: inferSide(paletteDrag.mode, paletteDrag.price, midPrice),
      lots: paletteDrag.lots,
    };
  }, [paletteDrag, midPrice, stopLimitDraft]);

  const palettePriceLineY =
    paletteDrag?.inChart && paletteDrag.price != null
      ? chartRef.current?.priceToClientY(paletteDrag.price) ?? null
      : null;



  useEffect(() => {

    if (!flash) return;

    const t = window.setTimeout(() => setFlash(""), 4500);

    return () => clearTimeout(t);

  }, [flash]);



  useEffect(() => {

    const onKey = (e: KeyboardEvent) => {

      const tag = (e.target as HTMLElement | null)?.tagName;

      const inField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

      if (e.code === "F5") {

        e.preventDefault();

        refreshMock();

        return;

      }

      if (inField) return;



      if (e.code === "Space") {

        e.preventDefault();

        if (riskStatusRef.current?.halted) {
          setFlash(riskStatusRef.current.halt_reason ?? "日风控锁定，次日 06:00 北京后可 ARM");
          return;
        }

        setArmState((s) => {

          const next = s === "armed" ? "disarmed" : "armed";

          setFlash(next === "armed" ? "ARM：解锁下单与快捷键" : "DISARM：已锁定");

          return next;

        });

        return;

      }



      if (armRef.current !== "armed") return;



      if (e.key === "1") {

        e.preventDefault();

        setForm((f) => ({ ...f, lots: 0.01 }));

        setFlash("手数 0.01");

      } else if (e.key === "2") {

        e.preventDefault();

        setForm((f) => ({ ...f, lots: 0.02 }));

        setFlash("手数 0.02");

      } else if (e.key === "3") {

        e.preventDefault();

        setForm((f) => ({ ...f, lots: 0.05 }));

        setFlash("手数 0.05");

      } else if (e.key === "b" || e.key === "B") {

        e.preventDefault();
        if (e.repeat) return;

        submitOrder("buy");

      } else if (e.key === "s" || e.key === "S") {

        e.preventDefault();
        if (e.repeat) return;

        submitOrder("sell");

      } else if (e.key === "l" || e.key === "L") {

        e.preventDefault();

        setForm((f) => {
          const next = f.kind === "pending" ? "market" : "pending";
          setFlash(next === "pending" ? "已切换：图形挂单" : "已切换：市价");
          return { ...f, kind: next };
        });

      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (e.repeat) return;
        const sel = selectedIdRef.current;
        const hit = sel && positionsRef.current.some((p) => p.id === sel);
        if (!hit) {
          setFlash("请先点选要平的持仓，X 只平当前选中的那笔");
          return;
        }
        closePositionById(sel);
      } else if (e.key === "Escape") {
        if (slTpEditor) {
          setSlTpEditor(null);
          setFlash("已关闭止盈止损面板");
        } else {
          setSelectedId(null);
          setFlash("已取消选中");
        }

      }

    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [refreshMock, submitOrder, slTpEditor, closePositionById]);



  return (

    <div className="app-shell">

      <header className="top-bar">
        <div className="top-bar-main">
          <div className="top-bar-title-row">
            <InstrumentPicker
              value={tradeInstrument}
              list={TRADE_INSTRUMENTS}
              onChange={onTradeInstrument}
              disabled={!market.connected}
            />
            <h1 className="top-symbol" title={market.symbol || instrumentById(tradeInstrument).label}>
              {market.symbol || instrumentById(tradeInstrument).label}
            </h1>
            <span className="top-price last">{formatPrice(lastPrice, tradeInstrument)}</span>
            {market.bid != null && market.ask != null ? (
              <span className="meta bid-ask top-bid-ask">
                Bid {formatPrice(market.bid, tradeInstrument)} · Ask {formatPrice(market.ask, tradeInstrument)}
              </span>
            ) : null}
            <span className={`top-chg ${chg >= 0 ? "chg-up" : "chg-down"}`}>
              {chg >= 0 ? "+" : ""}
              {chg.toFixed(2)} ({chgPct >= 0 ? "+" : ""}
              {chgPct.toFixed(2)}%)
            </span>
            <span className="meta top-kline-tag">{market.source === "mt5" ? "MT5 K 线" : "离线 K 线"}</span>
          </div>
          <div className="top-bar-meta-row">
            {account ? (
              <span className="meta acct-mini">
                #{account.login} · {account.server} · 净值 {account.equity.toFixed(2)} {account.currency} · 余额{" "}
                {account.balance.toFixed(2)}
              </span>
            ) : null}
            {market.symbol && statusMeta?.symbol && !symbolsMatch(market.symbol, statusMeta.symbol) ? (
              <span className="meta chart-error" title="EA 正在切换品种，约 1 秒内应一致">
                同步中：{market.symbol} / 桥 {statusMeta.symbol}
              </span>
            ) : null}
            {account && dailyPnlUsd != null ? (
              <span
                className={`daily-pnl-chip ${dailyPnlUsd >= 0 ? "up" : "down"}`}
                title={
                  riskStatus?.config.baseline_equity != null
                    ? "相对日风控基准净值（北京 06:00 交易窗）"
                    : "未锁基准：当前为净值减余额（主要为持仓浮动）"
                }
              >
                当日盈亏：{dailyPnlUsd >= 0 ? "+" : ""}
                {dailyPnlUsd.toFixed(1)} {account.currency}
              </span>
            ) : null}
          </div>
        </div>

        <div className="top-actions">

          <span
            className={`chip latency ${market.connected ? "ok" : "bad"}`}
            title="MT5 ms 是状态文件里的报价耗时。RTT 是本机页面到网关的 HTTP 往返中位数，不是券商延迟，也不是按 B 下单耗时。偶尔到几百毫秒，是 K 线请求或 Wine 写文件堵住了这一下读取。"
          >
            <span className="lat-part">
              MT5{" "}
              <span className="lat-num">{market.latency.mt5_ms != null ? market.latency.mt5_ms.toFixed(1) : "—"}</span>{" "}
              ms
            </span>
            <span className="lat-sep">·</span>
            <span className="lat-part">
              RTT{" "}
              <span className="lat-num">{market.latency.rtt_ms != null ? market.latency.rtt_ms.toFixed(0) : "—"}</span>{" "}
              ms
            </span>
          </span>

          <span
            className={`chip ${armState === "armed" ? "armed-chip" : ""} ${riskStatus?.halted ? "risk-lock-chip" : ""}`}
            title={
              riskStatus?.halted
                ? riskStatus.halt_reason ??
                  (riskStatus.halt_kind === "streak" ? "连续止损冷却" : "日风控锁定")
                : undefined
            }
          >

            {riskStatus?.halted
              ? riskStatus.halt_kind === "streak"
                ? "DISARM · 连损锁"
                : "DISARM · 日风控锁"
              : armState === "armed"
                ? "ARM · 可下单"
                : "DISARM"}

          </span>

          <span className={`chip mt5-conn ${executeOnMt5 ? "ok" : "bad"}`}>
            {executeOnMt5 ? "MT5 直连" : "MT5 未连接"}
          </span>

          <button
            type="button"
            className={`tool-btn ${dailyHardRiskOpen ? "tool-btn-accent" : ""}`}
            onClick={() => setDailyHardRiskOpen((o) => !o)}
            title="侧栏展开十条硬风控箴言"
          >
            每日必读
          </button>
          <button type="button" className="tool-btn" onClick={() => setRiskOpen(true)}>
            风控
          </button>
          <button type="button" className="tool-btn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
          {riskStatus?.halted ? (
            <span className="chip latency bad">
              {riskStatus.halt_kind === "streak" ? "连损暂停" : "日风控停"}
            </span>
          ) : null}

        </div>

      </header>



      <ChartToolbars
        timeframe={timeframe}
        timeframes={TIMEFRAMES}
        onTimeframe={onTimeframe}
        onResetView={() => chartRef.current?.resetVisibleRange()}
        onRefresh={refreshMock}
        drawTool={drawTool}
        onDrawTool={setDrawTool}
        onClearDrawings={() => {
          setChartDrawings([]);
          setSelectedDrawingId(null);
        }}
        selectedDrawingId={selectedDrawingId}
        onDeleteSelectedDrawing={deleteSelectedDrawing}
        onScrollToLatest={() => chartRef.current?.scrollToLatest()}
        onOpenTickSpread={() => setTickSpreadOpen(true)}
        tickSpreadActive={tickSpreadOpen}
      />

      <BidAskTickChartModal
        open={tickSpreadOpen}
        symbol={market.symbol}
        onClose={() => setTickSpreadOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        account={account}
        onAccountChange={() => {
          setAccountEpoch((n) => n + 1);
          setDataEpoch((n) => n + 1);
          void reloadAccount();
        }}
        onSettingsChange={setSettings}
      />

      <RiskPanel open={riskOpen} onClose={() => setRiskOpen(false)} account={account} />

      <StreakOrdinanceModal
        open={streakOrdinanceAlert.open}
        tier={streakOrdinanceAlert.tier}
        consecutiveLosses={streakOrdinanceAlert.consecutiveLosses}
        pauseMinutes={streakOrdinanceAlert.pauseMinutes}
        onClose={streakOrdinanceAlert.dismiss}
      />

      <div className="main-grid">

        <div className="chart-pane">

          {market.loadingTf ? <div className="chart-loading">加载 {timeframe} …</div> : null}

          {!account ? (
            <Mt5ConnectBanner error={accountError} onRetry={() => void reloadAccount()} />
          ) : accountError ? (
            <div className="chart-error" title={accountError}>
              账户接口：{accountError.slice(0, 120)}
            </div>
          ) : null}
          {market.error && market.source !== "mt5" && !accountError ? (
            <div className="chart-error" title={market.error}>
              MT5 未就绪：{market.error.slice(0, 80)}
            </div>
          ) : null}

          <ChartIndicatorLegend
            displayTimeframe={timeframe}
            indicators={chartIndicators}
            onToggleVisible={(id) =>
              setChartIndicators((list) =>
                list.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
              )
            }
            onRemove={(id) => setChartIndicators((list) => list.filter((i) => i.id !== id))}
            onAdd={(type) =>
              setChartIndicators((list) => [
                ...list,
                {
                  id: `ind-${Date.now()}`,
                  type,
                  sourceTimeframe: timeframe,
                  visible: true,
                  length: 20,
                  bbMult: 2,
                },
              ])
            }
            onUpdate={(id, patch) =>
              setChartIndicators((list) =>
                list.map((i) => (i.id === id ? { ...i, ...patch } : i)),
              )
            }
          />

          <div className="chart-pane-body">

          <div className="crosshair-hud">

            <div>

              <strong>O</strong> {crosshair.ohlc?.open.toFixed(2) ?? "—"} · <strong>H</strong>{" "}

              {crosshair.ohlc?.high.toFixed(2) ?? "—"} · <strong>L</strong>{" "}

              {crosshair.ohlc?.low.toFixed(2) ?? "—"} · <strong>C</strong>{" "}

              {crosshair.ohlc?.close.toFixed(2) ?? "—"}

            </div>

            <div>

              {fmtTime(crosshair.time)} · 价 {crosshair.price?.toFixed(2) ?? "—"}

            </div>

          </div>

          <TradingChart

            ref={chartRef}

            candles={candles}

            timeframe={timeframe}

            overlays={overlays}
            markPrice={market.bid ?? lastPrice}
            bid={market.bid}
            ask={market.ask}

            onCrosshair={onCrosshair}

            onLastPrice={onLastPrice}
            onChartClick={
              stopLimitDraft
                ? (clientY) => {
                    const price = chartRef.current?.clientYToPrice(clientY);
                    const draft = stopLimitDraftRef.current;
                    if (price == null || !draft) return;
                    void submitStopLimitAtPrices(draft.stopPrice, price, draft.side);
                  }
                : undefined
            }

            onLevelChange={onLevelChange}
            onLevelCommit={onLevelCommit}
            pendingDragPreview={pendingDragPreview}
            onEntryDoubleClick={openSlTpEditor}
            activeDrawTool={drawTool}
            drawings={chartDrawings}
            onDrawingsChange={setChartDrawings}
            indicatorPlans={indicatorPlans}
            volumeVisible={volumeVisible}
            selectedDrawingId={selectedDrawingId}
            onSelectDrawing={setSelectedDrawingId}
            onDeleteDrawing={(id) => {
              setChartDrawings((list) => list.filter((d) => d.id !== id));
              setSelectedDrawingId((cur) => (cur === id ? null : cur));
            }}
            onExitDrawTool={() => setDrawTool(null)}
          />
          </div>

          {slTpEditor ? (
            <SlTpEditorPanel
              model={slTpEditor}
              onPatch={patchSlTpEditor}
              onConfirm={() => void confirmSlTpEditor()}
              onDismiss={() => setSlTpEditor(null)}
              disabled={armState !== "armed"}
            />
          ) : null}

          <PaletteDragLayer
            drag={paletteDrag}
            midPrice={midPrice}
            chartWrapEl={chartRef.current?.getWrapElement() ?? null}
            priceLineClientY={palettePriceLineY}
            stopLimitPhase={pendingDragPreview?.stopLimitPhase}
          />

        </div>



        <aside className="side-panel">

          <div className="risk-strip">

            <h2>风控 · ARM</h2>

            <RiskHud status={riskStatus} onOpenRisk={() => setRiskOpen(true)} />

            <DailyHardRiskPanel
              expanded={dailyHardRiskOpen}
              onToggle={() => setDailyHardRiskOpen((o) => !o)}
            />

            <div className="arm-row">

              <button

                type="button"

                className={`arm-btn ${armState === "disarmed" || riskStatus?.halted ? "disarmed" : ""}`}

                onClick={() => setArmState("disarmed")}

              >

                DISARM

              </button>

              <button

                type="button"

                className={`arm-btn ${armState === "armed" && !riskStatus?.halted ? "armed" : ""}`}

                disabled={!!riskStatus?.halted}

                onClick={() => {
                  if (riskStatus?.halted) {
                    setFlash(riskStatus.halt_reason ?? "日风控锁定");
                    return;
                  }
                  setArmState("armed");
                }}

              >

                ARM

              </button>

            </div>

            <p className="arm-hint">

              {riskStatus?.halted
                ? riskStatus.halt_kind === "streak"
                  ? "连续止损已触发，已强制 DISARM；见上方冷却倒计时。"
                  : "日损触顶，已强制 DISARM；见上方倒计时。"
                : armState === "armed"
                  ? "B/S 市价 · X 平仓（选中优先，否则最近开仓）· L 图形挂单 · 1/2/3 手数。"
                  : "Space 或 ARM 解锁后再下单。"}

            </p>

          </div>

          <OrderTicket
            armState={armState}
            lastPrice={lastPrice}
            bid={market.bid}
            ask={market.ask}
            form={form}
            mt5Connected={executeOnMt5 && market.connected}
            tradingLocked={!!riskStatus?.halted}
            onFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            onSubmit={(side) => void submitOrder(side)}
            onFlash={setFlash}
            onPaletteDragMove={onPaletteDragMove}
            onPaletteDragEnd={onPaletteDragEnd}
            stopLimitAwaitingTrigger={stopLimitDraft != null}
            onStopLimitDraftCancel={cancelStopLimitDraft}
          />

          <PositionsPanel
            positions={positionsForInstrument}
            pending={pending}
            lastPrice={lastPrice}
            instrumentId={tradeInstrument}
            selectedId={selectedId}
            tradingLocked={!!riskStatus?.halted}

            onSelect={setSelectedId}

            onClosePosition={(id) => closePositionById(id)}

            onCancelPending={(id) => {
              const o = pending.find((x) => x.id === id);
              if (executeOnMt5Ref.current && o?.ticket) {
                void cancelMt5Order(o.ticket)
                  .then(() => {
                    setOrderSyncTick((n) => n + 1);
                    setFlash("已撤 MT5 挂单");
                  })
                  .catch((e) => setFlash(e instanceof Error ? e.message : String(e)));
              }
              if (selectedId === id) setSelectedId(null);
            }}

          />

        </aside>

      </div>



      <footer className="status-bar">

        <span>

          周期 <strong>{timeframe}</strong> · K 线 {candles.length} ·{" "}
          {market.connected ? "MT5 已连接" : "MT5 断开"} · 持仓 {positions.length}

        </span>

        <span>

          <kbd>Space</kbd> ARM · <kbd>B</kbd>/<kbd>S</kbd> 市价 · <kbd>X</kbd> 平仓 · <kbd>L</kbd> 图形挂单 · <kbd>1</kbd>

          <kbd>2</kbd>

          <kbd>3</kbd> 手数 · <kbd>Esc</kbd> 取消选中

        </span>

        {flash ? <span className="flash-msg">{flash}</span> : null}

      </footer>

    </div>

  );

}


