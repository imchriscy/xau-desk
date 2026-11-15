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