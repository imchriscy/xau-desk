import type { Candle, Timeframe } from "../types";

const BASE = "/api";

async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { detail?: string };
    if (j.detail === "not found") {
      return `${fallback}（HTTP 404：网关路由不存在，请运行 restart-backend.cmd 重启 5191）`;
    }
    return j.detail ?? t ?? fallback;
  } catch {
    return t || fallback;
  }
}

export interface Mt5Status {
  connected: boolean;
  symbol?: string;
  login?: number;
  server?: string;
  terminal?: string;
  error?: string;
}

export interface QuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  time: number;
  mt5_ms: number;
}

export interface BarsResponse {
  symbol: string;
  timeframe: string;
  count: number;
  candles: Candle[];
  mt5_ms: number;
  cached?: boolean;
}

export interface PingResponse {
  ok: boolean;
  symbol: string;
  mt5_ms: number;
  server_ms: number;
  ts: number;
}

export async function fetchMt5Status(): Promise<Mt5Status> {
  const res = await fetch(`${BASE}/mt5/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function pingMt5(): Promise<PingResponse & { rtt_ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/ping`);
  const rtt_ms = performance.now() - t0;
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as PingResponse;
  return { ...body, rtt_ms };
}

export async function fetchQuote(): Promise<QuoteResponse & { rtt_ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/quote`);
  const rtt_ms = performance.now() - t0;
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as QuoteResponse;
  return { ...body, rtt_ms };
}

export async function fetchBars(
  timeframe: Timeframe,
  signal?: AbortSignal,
): Promise<BarsResponse & { rtt_ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/bars?timeframe=${encodeURIComponent(timeframe)}`, { signal });
  const rtt_ms = performance.now() - t0;
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as BarsResponse;
  return { ...body, rtt_ms };
}

export type AccountKind = "demo" | "real";

export interface Mt5AccountSnapshot {
  login: number;
  server: string;
  name: string;
  company: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  margin_free: number;
  profit: number;
  leverage: number;
  account_kind: AccountKind;
  account_kind_label: string;
  trade_allowed: boolean;
  trade_expert: boolean;
  terminal_trade_allowed: boolean | null;
}

export interface Mt5PositionRow {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  open_price: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  open_time: number;
}

export async function detectMt5Account(): Promise<Mt5AccountSnapshot & { online: boolean }> {
  const res = await fetch(`${BASE}/account/detect`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, "检测 MT5 账户失败"));
  return res.json();
}

export async function fetchAccount(): Promise<Mt5AccountSnapshot> {
  const res = await fetch(`${BASE}/account`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMt5Positions(symbol?: string): Promise<Mt5PositionRow[]> {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const res = await fetch(`${BASE}/positions${q}`);
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as { positions: Mt5PositionRow[] };
  return body.positions;
}

export async function loginMt5Account(body: {
  login: number;
  server: string;
  password: string;
}): Promise<Mt5AccountSnapshot> {
  const res = await fetch(`${BASE}/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    let detail = t;
    try {
      detail = (JSON.parse(t) as { detail?: string }).detail ?? t;
    } catch {
      /* plain text */
    }
    if (res.status === 404) {
      throw new Error("登录接口 404：请先重启 run-backend.cmd（网关需 v0.2-account）");
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { account: Mt5AccountSnapshot };
  return data.account;
}

export async function sendPendingOrder(body: {
  mode: "limit" | "stop" | "stop_limit";
  side: "buy" | "sell";
  lots: number;
  price: number;
  stoplimit?: number | null;
  sl?: number | null;
  tp?: number | null;
  allow_demo_mt5?: boolean;
}): Promise<{ ok: boolean; order?: number }> {
  const res = await fetch(`${BASE}/order/pending`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "挂单失败"));
  const data = (await res.json()) as { ok?: boolean; detail?: string; order?: number };
  return { ok: !!data.ok, order: data.order };
}

export interface Mt5OrderRow {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  mode: string;
  lots: number;
  price: number;
  sl: number | null;
  tp: number | null;
  setup_time: number;
}

export async function fetchMt5Orders(symbol?: string): Promise<Mt5OrderRow[]> {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const res = await fetch(`${BASE}/orders${q}`);
  if (!res.ok) throw new Error(await apiErrorMessage(res, "读取挂单失败"));
  const body = (await res.json()) as { orders: Mt5OrderRow[] };
  return body.orders;
}

export async function cancelMt5Order(ticket: number): Promise<void> {
  const res = await fetch(`${BASE}/order/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "撤单失败"));
}

export async function modifyMt5Order(
  ticket: number,
  patch: { price?: number | null; sl?: number | null; tp?: number | null },
): Promise<void> {
  const res = await fetch(`${BASE}/order/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, ...patch }),
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, "改单失败"));
}

export async function sendLimitOrder(body: {
  side: "buy" | "sell";
  lots: number;
  price: number;
  sl?: number | null;
  tp?: number | null;
  allow_demo_mt5?: boolean;
}): Promise<{ ok: boolean; mt5_ms?: number }> {
  const res = await fetch(`${BASE}/order/limit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; detail?: string };
  if (!res.ok) throw new Error(data.detail ?? JSON.stringify(data));
  return { ok: !!data.ok };
}

export async function sendMarketOrder(body: {
  side: "buy" | "sell";
  lots: number;
  sl?: number | null;
  tp?: number | null;
  allow_demo_mt5?: boolean;
}): Promise<{ ok: boolean; detail?: string; mt5_ms?: number }> {
  const res = await fetch(`${BASE}/order/market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; detail?: string; mt5_ms?: number };
  if (!res.ok) throw new Error(data.detail ?? JSON.stringify(data));
  return { ok: !!data.ok, mt5_ms: data.mt5_ms, detail: data.detail };
}

export async function closeMt5Position(ticket: number): Promise<void> {
  const res = await fetch(`${BASE}/order/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function modifyMt5Position(ticket: number, sl?: number | null, tp?: number | null): Promise<void> {
  const res = await fetch(`${BASE}/position/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, sl, tp }),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** 已连接 MT5 账户则一律经本地网关发单（模拟/实盘均发 MT5，无前端演示仓） */
export function shouldExecuteOnMt5(account: Mt5AccountSnapshot | null): boolean {
  return account != null;
}

export async function fetchGatewayVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/version`);
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

export function gatewayVersionHint(version: string | null): string | null {
  if (!version) return "无法连接本地网关 5191：请运行 restart-backend.cmd";
  if (version === "0.2-account") {
    return "网关版本过旧 (0.2-account)：请运行 restart-backend.cmd 以支持挂单/风控/检测账户";
  }
  return null;
}
