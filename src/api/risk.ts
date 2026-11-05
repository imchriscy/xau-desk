export interface RiskConfigDto {
  daily_enabled: boolean;
  per_trade_loss_cap_usd: number | null;
  per_trade_loss_cap_pct: number | null;
  daily_loss_cap_usd: number | null;
  daily_loss_cap_pct: number | null;
  baseline_equity: number | null;
  baseline_confirmed_at: string | null;
  streak_enabled?: boolean;
  streak_tier1_losses?: number;
  streak_tier1_pause_minutes?: number;
  streak_tier2_losses?: number;
  streak_tier2_pause_minutes?: number;
  require_stop_loss?: boolean;
  virtual_equity_usd?: number | null;
  margin_cap_factor?: number;
  max_combined_slots?: number;
  app_magic_only?: boolean;
}

export interface RiskStatusDto {
  account_login?: number;
  config: RiskConfigDto;
  session_key: string;
  session_start_bjt: string;
  session_end_bjt: string;
  bjt_now: string;
  halted: boolean;
  halt_reason: string | null;
  session_drawdown_usd?: number;
  daily_loss_limit_usd?: number | null;
  params_locked?: boolean;
  halted_until_bjt?: string | null;
  next_unlock_bjt?: string;
  consecutive_losses?: number;
  streak_tier3_armed?: boolean;
  streak_enabled?: boolean;
  halt_kind?: "daily" | "streak" | null;
  suggested_caps?: { per_trade_loss_cap_pct: number; daily_loss_cap_pct: number };
  streak_sync?: {
    consecutive_losses?: number;
    synced?: number;
    deals_in_window?: number;
    hint?: string;
    error?: string;
    error_detail?: string;
    triggered?: string[];
  };
  exposure?: {
    app_open_slots: number;
    max_combined_slots: number;
    margin_used_usd: number;
    margin_budget_usd: number;
    risk_notional_usd: number;
    leverage: number;
    foreign_exposure_count: number;
    app_magic?: number;
  };
}

export interface RiskEventRow {
  ts_bjt: string;
  login: number;
  event: string;
  detail: string;
  payload?: Record<string, unknown>;
  seq?: number;
  prev_hash?: string;
  row_hash?: string;
}

export interface RiskAuditIntegrity {
  valid: boolean;
  checked_rows: number;
  legacy_rows_without_hash: number;
  first_break_line: number | null;
  tip: string;
}

export interface RiskAuditBundle {
  login?: number | null;
  events: RiskEventRow[];
  integrity: RiskAuditIntegrity;
  log_path: string;
  server_ts_bjt: string;
  gateway_version?: string;
}

export async function fetchGatewayVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version");
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: string };
    return j.version ?? null;
  } catch {
    return null;
  }
}

function isAuditBundle(x: unknown): x is RiskAuditBundle {
  if (!x || typeof x !== "object") return false;
  const o = x as RiskAuditBundle;
  return Array.isArray(o.events) && o.integrity != null;
}

export async function fetchRiskAudit(limit = 80): Promise<RiskAuditBundle> {
  const urls = [
    `/api/risk/events?limit=${limit}&system=1`,
    `/api/risk/audit?limit=${limit}&system=1`,
    `/api/risk/status?audit_limit=${limit}`,
  ];
  let lastErr = "";
  for (const url of urls) {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      lastErr = text.slice(0, 120) || `HTTP ${res.status}`;
      continue;
    }
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (isAuditBundle(body)) return body;
      const embedded = body.audit;
      if (isAuditBundle(embedded)) {
        const ver =
          (typeof body.gateway_version === "string" ? body.gateway_version : undefined) ??
          embedded.gateway_version;
        return { ...embedded, gateway_version: ver ?? embedded.gateway_version };
      }
    } catch {
      lastErr = "响应解析失败";
    }
  }
  const ver = await fetchGatewayVersion();
  const need = "0.4.6+";
  throw new Error(
    ver
      ? `审计接口不可用（当前网关 ${ver}，需 ${need}）。请运行 restart-backend.cmd 后刷新。${lastErr ? ` · ${lastErr}` : ""}`
      : `审计接口不可用，请确认 5191 网关已启动并运行 restart-backend.cmd（需 ${need}）`,
  );
}

export async function resyncStreakLosses(rebuild = false): Promise<void> {
  const res = await fetch("/api/risk/resync-streak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rebuild }),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** @deprecated use fetchRiskAudit */
export async function fetchRiskEvents(limit = 40): Promise<RiskEventRow[]> {
  const b = await fetchRiskAudit(limit);
  return b?.events ?? [];
}

async function riskApiError(res: Response, fallback: string): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { detail?: string };
    if (j.detail === "not found") {
      return `${fallback}（请 restart-backend.cmd → 0.3-risk-chart）`;
    }
    return j.detail ?? t ?? fallback;
  } catch {
    return t || fallback;
  }
}

export async function fetchRiskStatus(): Promise<RiskStatusDto> {
  const res = await fetch("/api/risk/status");
  if (!res.ok) throw new Error(await riskApiError(res, "风控状态不可用"));
  return res.json();
}

export async function saveRiskConfig(patch: Partial<RiskConfigDto>): Promise<RiskConfigDto> {
  const res = await fetch("/api/risk/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (res.status === 403) throw new Error(await riskApiError(res, "本交易窗风控已锁定"));
  if (!res.ok) throw new Error(await riskApiError(res, "保存风控失败"));
  const body = (await res.json()) as { config: RiskConfigDto };
  return body.config;
}

export async function confirmRiskBaseline(equity?: number): Promise<RiskConfigDto> {
  const res = await fetch("/api/risk/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(equity != null ? { equity } : {}),
  });
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as { config: RiskConfigDto };
  return body.config;
}
