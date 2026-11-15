/** Mac MQL 网关 Phase 1：风控字段占位，与 UI 类型兼容；规则真源在 EA。 */

function bjtNowIso() {
  const utc = Date.now() + 8 * 3600 * 1000;
  return new Date(utc).toISOString().replace("Z", "+08:00");
}

function sessionKeyBjt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function defaultRiskStatus(equity = 0, login = 0, eaRisk = {}) {
  const halted = Boolean(eaRisk.halted);
  return {
    account_login: login,
    config: {
      daily_enabled: true,
      per_trade_loss_cap_usd: null,
      per_trade_loss_cap_pct: 2,
      daily_loss_cap_usd: null,
      daily_loss_cap_pct: 5,
      baseline_equity: equity || null,
      baseline_confirmed_at: null,
      streak_enabled: true,
      streak_tier1_losses: 2,
      streak_tier1_pause_minutes: 15,
      streak_tier2_losses: 3,
      streak_tier2_pause_minutes: 60,
      require_stop_loss: eaRisk.require_stop_loss !== false,
      virtual_equity_usd: null,
      margin_cap_factor: 0.35,
      max_combined_slots: 6,
      app_magic_only: true,
    },
    session_key: sessionKeyBjt(),
    session_start_bjt: `${sessionKeyBjt()}T08:00:00+08:00`,
    session_end_bjt: `${sessionKeyBjt()}T23:59:59+08:00`,
    bjt_now: bjtNowIso(),
    halted,
    halt_reason: eaRisk.halt_reason ?? (halted ? "ea_halt" : null),
    consecutive_losses: eaRisk.consecutive_losses ?? 0,
    streak_enabled: true,
    halt_kind: halted ? (eaRisk.halt_kind ?? "streak") : null,
    exposure: eaRisk.exposure ?? {
      app_open_slots: eaRisk.app_open_slots ?? 0,
      max_combined_slots: eaRisk.max_combined_slots ?? 6,
      margin_used_usd: Number(eaRisk.app_margin_usd ?? eaRisk.margin_used_usd ?? 0),
      margin_budget_usd: Number(eaRisk.margin_budget_usd ?? 0),
      risk_notional_usd: Number(eaRisk.risk_notional_usd ?? 0),
      leverage: Number(eaRisk.leverage ?? 0),
      foreign_exposure_count: Number(eaRisk.foreign_exposure_count ?? 0),
    },
    gateway_backend: "mql5-file-bridge",
  };
}
