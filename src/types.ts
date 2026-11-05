export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** MT5 tick_volume */
  volume?: number;
}

export interface CrosshairInfo {
  time: number | null;
  price: number | null;
  ohlc: Candle | null;
}

export type ArmState = "disarmed" | "armed";
export type OrderSide = "buy" | "sell";
export type OrderKind = "market" | "pending";
export type PendingOrderMode = "limit" | "stop" | "stop_limit";

export interface PendingPaletteDrag {
  mode: PendingOrderMode;
  clientX: number;
  clientY: number;
  lots: number;
  inChart: boolean;
  price: number | null;
}

export interface PendingDragPreview {
  mode: PendingOrderMode;
  price: number;
  side: OrderSide;
  lots: number;
  /** StopLimit：1=设 STOP，2=设触发价并提交 */
  stopLimitPhase?: 1 | 2;
  /** StopLimit 第二次拖动时固定的 STOP 价 */
  stopLimitStopPrice?: number;
}

/** StopLimit 第一次松手后的草稿（等待第二次拖动） */
export interface StopLimitDraft {
  stopPrice: number;
  side: OrderSide;
  lots: number;
}

export interface Position {
  id: string;
  ticket: number;
  side: OrderSide;
  lots: number;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  openTime: number;
  /** MT5 浮动盈亏；演示仓由前端按现价估算 */
  profitUsd?: number;
}

export interface PendingOrder {
  id: string;
  /** MT5 挂单 ticket（演示单可省略） */
  ticket?: number;
  side: OrderSide;
  lots: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  createdAt: number;
  mode?: PendingOrderMode;
}

export type LevelField = "entry" | "sl" | "tp" | "trigger" | "limit_px";

export interface ChartTradeOverlay {
  id: string;
  kind: "position" | "pending" | "draft";
  side: OrderSide;
  entry: number;
  sl: number | null;
  tp: number | null;
  selected: boolean;
  /** 手数，用于 SL/TP 与挂单入场线的金额估算 */
  lots?: number;
  profitUsd?: number;
  label?: string;
}

export interface ChartOrderDraft {
  mode: PendingOrderMode;
  side: OrderSide;
  lots: number;
  /** Limit / Stop 主价格线 */
  entry: number;
  /** StopLimit 触发线 */
  trigger: number | null;
  /** StopLimit 限价线 */
  limitPrice: number | null;
  sl: number | null;
  tp: number | null;
  slEnabled: boolean;
  tpEnabled: boolean;
}

export interface OrderFormState {
  kind: OrderKind;
  lots: number;
  slOffset: number;
  tpOffset: number;
}

export type DrawToolKind = "trend" | "rect" | "fib" | null;

export type ChartDrawing =
  | { id: string; kind: "hline"; price: number }
  | { id: string; kind: "trend" | "rect" | "measure" | "fib"; t1: number; p1: number; t2: number; p2: number }
  | {
      id: string;
      kind: "rr";
      t: number;
      entry: number;
      stop: number;
      target: number;
    };

export type ChartIndicatorType = "ma" | "bb" | "vol";

export interface ChartIndicatorInst {
  id: string;
  type: ChartIndicatorType;
  /** 指标计算所用的 K 线周期（在其它周期图上仍显示该级别的线） */
  sourceTimeframe: Timeframe;
  visible: boolean;
  length: number;
  /** 布林带标准差倍数 */
  bbMult?: number;
}

export interface IndicatorLinePlan {
  key: string;
  color: string;
  points: { time: number; value: number }[];
}

export interface IndicatorRenderPlan {
  id: string;
  visible: boolean;
  lines: IndicatorLinePlan[];
}
