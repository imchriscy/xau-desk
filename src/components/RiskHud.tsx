import { useEffect, useState } from "react";
import type { RiskStatusDto } from "../api/risk";
import StreakRiskProgress from "./StreakRiskProgress";

function formatCountdown(untilIso: string | null | undefined): string {
  if (!untilIso) return "—";
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return "即将解锁";
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  status: RiskStatusDto | null;
  onOpenRisk: () => void;
}

export default function RiskHud({ status, onOpenRisk }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const streakOn = true;
  const dailyOn = status?.config.daily_enabled === true;

  if (!status) {
    return (
      <div className="risk-hud risk-hud-idle">
        <span className="risk-hud-label">风控</span>
        <span className="field-micro">加载中…</span>
        <button type="button" className="link-btn" onClick={onOpenRisk}>
          设置
        </button>
      </div>
    );
  }

  const limit = status.daily_loss_limit_usd;
  const dd = status.session_drawdown_usd ?? 0;
  const pct = limit != null && limit > 0 ? Math.min(100, (dd / limit) * 100) : 0;
  const until = status.halted ? status.halted_until_bjt ?? status.next_unlock_bjt : status.next_unlock_bjt;
  const countdown = formatCountdown(until);
  const unlockHint =
    status.halt_kind === "streak" ? "冷却倒计时（结束后计数清零）" : "次交易日 06:00（北京）";

  const perUsd = status.config.per_trade_loss_cap_usd;
  const perPct = status.config.per_trade_loss_cap_pct;

  return (
    <div className={`risk-hud ${status.halted ? "risk-hud-halt" : ""}`}>
      <div className="risk-hud-head">
        <span className="risk-hud-label">
          {dailyOn ? "日风控" : "连续止损风控"} · #{status.account_login ?? "—"} · {status.session_key}
        </span>
        {status.params_locked ? <span className="risk-hud-lock">本窗已锁定</span> : null}
        <button type="button" className="link-btn" onClick={onOpenRisk}>
          详情
        </button>
      </div>
      <div className="risk-hud-metrics">
        {dailyOn ? (
          <>
            <span>日损上限 {limit != null ? `$${limit.toFixed(0)}` : "—"}</span>
            <span>
              已亏 <strong className={dd > 0 ? "chg-down" : ""}>${dd.toFixed(0)}</strong>
            </span>
          </>
        ) : null}
        {status.exposure ? (
          <span className="field-micro">
            单 {status.exposure.app_open_slots}/{status.exposure.max_combined_slots} · 保证金{" "}
            {status.exposure.margin_used_usd.toFixed(0)}/{status.exposure.margin_budget_usd.toFixed(0)}
          </span>
        ) : null}
        {(perUsd != null || perPct != null) && (
          <span className="field-micro">
            单笔 ≤ {perUsd != null ? `$${perUsd}` : ""}
            {perUsd != null && perPct != null ? " / " : ""}
            {perPct != null ? `${perPct}%` : ""}
          </span>
        )}
      </div>
      {dailyOn && limit != null && limit > 0 ? (
        <div className="risk-progress" title={`${pct.toFixed(1)}%`}>
          <div className="risk-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <StreakRiskProgress status={status} compact />
      {status.halted ? (
        <div className="risk-hud-halt-row">
          <span className="risk-halt">{status.halt_reason ?? "日风控停"}</span>
          <span className="risk-countdown">
            {unlockHint} <strong>{countdown}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}
