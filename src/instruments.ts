/** 交易品种预设（券商命名各异，由 EA 解析为实际 symbol） */
export type TradeInstrumentId = "xau" | "btc" | "nas100";

export interface TradeInstrument {
  id: TradeInstrumentId;
  label: string;
  short: string;
  /** UI 价格小数位 */
  digits: number;
  /** 默认止损/止盈「点数」为价格偏移绝对值（USD 报价点） */
  defaultSlOffset: number;
  defaultTpOffset: number;
  /** 无 MT5 profit 字段时的粗算合约乘数 */
  pnlContractSize: number;
  candidates: string[];
}

export const TRADE_INSTRUMENTS: TradeInstrument[] = [
  {
    id: "xau",
    label: "黄金 XAUUSD",
    short: "XAU",
    digits: 2,
    defaultSlOffset: 4,
    defaultTpOffset: 4,
    pnlContractSize: 100,
    candidates: ["XAUUSD", "XAUUSDm", "XAUUSDx", "GOLD", "XAUUSD.m"],
  },
  {
    id: "btc",
    label: "比特币 BTC",
    short: "BTC",
    digits: 2,
    defaultSlOffset: 120,
    defaultTpOffset: 120,
    pnlContractSize: 1,
    candidates: [
      "BTCUSD",
      "BTCUSDm",
      "BTCUSD.",
      "BTCUSD#",
      "BTCUSDT",
      "Bitcoin",
      "BTC/USD",
      "BTCUSD.c",
    ],
  },
  {
    id: "nas100",
    label: "纳指 NAS100",
    short: "NAS",
    digits: 1,
    defaultSlOffset: 25,
    defaultTpOffset: 25,
    pnlContractSize: 1,
    candidates: [
      "NAS100",
      "NAS100m",
      "NAS100.",
      "US100",
      "USTEC",
      "US100.cash",
      "NDX100",
      "NASDAQ100",
      "US100#",
    ],
  },
];

export const STORAGE_INSTRUMENT_KEY = "xaudesk.tradeInstrument";

export function instrumentById(id: string): TradeInstrument {
  return TRADE_INSTRUMENTS.find((i) => i.id === id) ?? TRADE_INSTRUMENTS[0];
}

export function formatPrice(price: number, instrumentId: TradeInstrumentId): string {
  return price.toFixed(instrumentById(instrumentId).digits);
}

const normSym = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** 判断网关返回的 symbol 是否属于当前交易品种（过滤切换品种后的滞后报价） */
export function symbolMatchesInstrument(quoteSymbol: string, instrumentId: TradeInstrumentId): boolean {
  const q = normSym(quoteSymbol);
  if (!q) return false;
  const inst = instrumentById(instrumentId);
  return inst.candidates.some((c) => {
    const n = normSym(c);
    return q === n || q.includes(n) || n.includes(q);
  });
}

export function symbolsLooselyEqual(a: string, b: string): boolean {
  const na = normSym(a);
  const nb = normSym(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** 粗判 K 线收盘价是否像该品种（防跨品种污染缓存） */
export function lastClosePlausibleForInstrument(instrumentId: TradeInstrumentId, close: number): boolean {
  if (!Number.isFinite(close) || close <= 0) return false;
  if (instrumentId === "xau") return close >= 800 && close <= 8_000;
  if (instrumentId === "nas100") return close >= 8_000 && close <= 80_000;
  if (instrumentId === "btc") return close >= 3_000 && close <= 500_000;
  return true;
}