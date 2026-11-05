import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TradingChart, { type TradingChartHandle } from "./components/TradingChart";

import OrderTicket from "./components/OrderTicket";
import PaletteDragLayer from "./components/PaletteDragLayer";

import PositionsPanel from "./components/PositionsPanel";
import SettingsModal from "./components/SettingsModal";
import RiskHud from "./components/RiskHud";
import RiskPanel from "./components/RiskPanel";
import ChartToolbars from "./components/ChartToolbars";
import ChartIndicatorLegend from "./components/ChartIndicatorLegend";
import { buildIndicatorRenderPlans } from "./chartIndicators";
import { loadStoredChartUi, saveStoredChartUi } from "./chartIndicatorStorage";
import { fetchBars } from "./api/mt5";
import { generateMockCandles } from "./mockData";
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

function paperProfitUsd(p: Position, px: number): number {
  const diff = p.side === "buy" ? px - p.openPrice : p.openPrice - px;
  return diff * 100 * p.lots;
}

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

  const [form, setForm] = useState<OrderFormState>(DEFAULT_FORM);

  const [paperPositions, setPaperPositions] = useState<Position[]>([]);

  const [orderSyncTick, setOrderSyncTick] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
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

  const chartRef = useRef<TradingChartHandle>(null);

  const formRef = useRef(form);

  const armRef = useRef(armState);

  const settingsRef = useRef(settings);

  formRef.current = form;

  armRef.current = armState;

  settingsRef.current = settings;



  const market = useMt5Market(timeframe, dataEpoch);

  const { account, error: accountError, reload: reloadAccount } = useMt5Account(dataEpoch + accountEpoch);
  const { status: riskStatus } = useRiskStatus(market.connected, account?.login);

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

  const mt5Positions = useMt5PositionsSync(executeOnMt5, market.symbol, posSyncTick);
  const mt5Pending = useMt5OrdersSync(executeOnMt5, market.symbol, orderSyncTick);
  const pending = executeOnMt5 ? mt5Pending : [];

  const positions = executeOnMt5 ? mt5Positions : paperPositions;

  const positionsRef = useRef(positions);
  const pendingRef = useRef(pending);
  const slTpEditorRef = useRef(slTpEditor);

  const executeOnMt5Ref = useRef(executeOnMt5);

  positionsRef.current = positions;
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
    if (orderSyncTick === 0) return;
    const list = pendingRef.current;
    if (list.length === 0) return;
    const latest = [...list].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) setSelectedId(latest.id);
  }, [orderSyncTick]);

  useEffect(() => {
    if (!executeOnMt5 || posSyncTick === 0 || mt5Positions.length === 0) return;
    const latest = [...mt5Positions].sort((a, b) => b.openTime - a.openTime)[0];
    if (latest) setSelectedId(latest.id);
  }, [posSyncTick, executeOnMt5, mt5Positions]);

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
        setFlash(`${modeLabel(mode)} ${side.toUpperCase()} @ ${price.toFixed(2)} · 已送 MT5`);
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
            `STOP @ ${price.toFixed(2)} · 再拖 StopLimit 卡片设触发价（双击卡片取消）`,
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
      const { sl, tp } = slTpFromOffsets(side, lastPrice, f.slOffset, f.tpOffset);
      try {
        const res = await sendMarketOrder({
          side,
          lots: f.lots,
          sl: f.slOffset > 0 ? sl : null,
          tp: f.tpOffset > 0 ? tp : null,
          allow_demo_mt5: true,
        });
        if (!res.ok) {
          setFlash("MT5 拒单，请查看终端日志");
          return;
        }
        setPosSyncTick((n) => n + 1);
        void reloadAccount();
        setFlash(`MT5 成交 · ${res.mt5_ms?.toFixed(1) ?? "?"} ms · 双击线可设 SL/TP`);
      } catch (e) {
        setFlash(e instanceof Error ? e.message : String(e));
      }
    },
    [account, lastPrice, reloadAccount, riskStatus],
  );

  const closePositionById = useCallback((id: string) => {
    const p = positionsRef.current.find((x) => x.id === id);
    if (!p) return;
    if (executeOnMt5Ref.current) {
      void closeMt5Position(p.ticket)
        .then(() => {
          setPosSyncTick((n) => n + 1);
          setFlash(`已平仓 #${p.ticket} · ${p.side.toUpperCase()} ${p.lots} @ ${p.openPrice.toFixed(2)}`);
        })
        .catch((e) => setFlash(e instanceof Error ? e.message : String(e)));
    } else {
      setPaperPositions((list) => list.filter((x) => x.id !== id));
      setFlash("已平仓");
    }
    if (selectedIdRef.current === id) setSelectedId(null);
  }, []);

  const pickCloseTargetId = useCallback((): string | null => {
    const list = positionsRef.current;
    if (list.length === 0) return null;
    const sel = selectedIdRef.current;
    if (sel && list.some((p) => p.id === sel)) return sel;
    const latest = [...list].sort((a, b) => b.openTime - a.openTime)[0];
    return latest?.id ?? null;
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

    for (const p of positions) {
      const ov = levelOverrides[p.id];
      // 与持仓明细一致：跟报价 tick 重算，不用 MT5 持仓轮询里的 profit（约 1.5s）
      const profitUsd = paperProfitUsd(p, lastPrice);
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
  }, [positions, pending, selectedId, levelOverrides, slTpEditor, lastPrice, stopLimitDraft]);

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

        submitOrder("buy");

      } else if (e.key === "s" || e.key === "S") {

        e.preventDefault();

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
        const id = pickCloseTargetId();
        if (!id) {
          setFlash("无持仓可平");
          return;
        }
        closePositionById(id);
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

  }, [refreshMock, submitOrder, slTpEditor, closePositionById, pickCloseTargetId]);



  return (

    <div className="app-shell">

      <header className="top-bar">

        <div className="symbol-block">

          <span className="tag">Spot</span>

          <h1>{market.symbol}</h1>

          <div className="quote-line">

            <span className="last">{lastPrice.toFixed(2)}</span>

            {market.bid != null && market.ask != null ? (
              <span className="meta bid-ask">
                Bid {market.bid.toFixed(2)} · Ask {market.ask.toFixed(2)}
              </span>
            ) : null}

            <span className={chg >= 0 ? "chg-up" : "chg-down"}>

              {chg >= 0 ? "+" : ""}

              {chg.toFixed(2)} ({chgPct >= 0 ? "+" : ""}

              {chgPct.toFixed(2)}%)

            </span>

            <span className="meta">
              {market.source === "mt5" ? "MT5 K 线" : "离线 K 线"}
            </span>

            {account ? (
              <span className="meta acct-mini">
                #{account.login} · 净值 {account.equity.toFixed(2)} {account.currency} · 余额{" "}
                {account.balance.toFixed(2)}
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
            title={
              "MT5 ms = 本机 Python 调 MT5 API 耗时；RTT = 浏览器到本地网关的 HTTP 往返（含网络栈，非券商延迟）"
            }
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
        onTimeframe={setTimeframe}
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

      <div className="main-grid">

        <div className="chart-pane">

          {market.loadingTf ? <div className="chart-loading">加载 {timeframe} …</div> : null}

          {accountError ? (
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
            markPrice={lastPrice}

            onCrosshair={onCrosshair}

            onLastPrice={onLastPrice}

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

            positions={positions}

            pending={pending}

            lastPrice={lastPrice}

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


