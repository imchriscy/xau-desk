import type { RiskStatusDto } from "../api/risk";

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

function fmtPause(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

interface Props {
  status: RiskStatusDto;
  compact?: boolean;
}

export default function StreakRiskProgress({ status, compact }: Props) {
  const t1 = status.config.streak_tier1_losses ?? 3;
  const t1m = status.config.streak_tier1_pause_minutes ?? 30;
  const t2 = status.config.streak_tier2_losses ?? 5;
  const t2m = status.config.streak_tier2_pause_minutes ?? 180;

  const n = status.consecutive_losses ?? 0;
  const tier3 = status.streak_tier3_armed === true;
  const maxBar = Math.max(t2, 1);
  const pct = Math.min(100, (Math.min(n, maxBar) / maxBar) * 100);
  const tick1Pct = (t1 / maxBar) * 100;
  const streakHalt = status.halted && status.halt_kind === "streak";
  const countdown = streakHalt ? formatCountdown(status.halted_until_bjt) : null;

  let stage = `下一档：${t1} 笔 → ${fmtPause(t1m)}`;
  if (n >= t2) stage = `已达 ${t2} 笔档`;
  else if (n >= t1) stage = tier3 ? `已触发 ${fmtPause(t1m)} · 继续至 ${t2} 笔 → ${fmtPause(t2m)}` : `已达 ${t1} 笔档`;

  return (
    <div className={`streak-risk-block ${compact ? "compact" : ""}`}>
      <div className="streak-risk-head">
        <span>
          当前 <strong className={n >= t1 - 1 ? "chg-down" : ""}>{n}</strong> / {t2}
        </span>
        {!compact ? <span className="streak-stage-hint">{stage}</span> : null}
        {status.streak_sync?.error ? (
          <span className="risk-halt" title={status.streak_sync.error_detail ?? status.streak_sync.hint}>
            成交未同步
          </span>
        ) : null}
      </div>
      <div className="risk-progress risk-streak-progress" title={`${n}/${t2}`}>
        <div className="risk-streak-tick" style={{ left: `${tick1Pct}%` }} aria-hidden />
        <div className="risk-streak-tick tick-end" aria-hidden />
        <div
          className={`risk-progress-fill streak ${n >= t1 ? "streak-warn" : ""} ${n >= t2 ? "streak-danger" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="streak-risk-legend">
        <span>0</span>
        <span style={{ marginLeft: `${Math.max(0, tick1Pct - 8)}%` }}>
          {t1}·{fmtPause(t1m)}
        </span>
        <span>
          {t2}·{fmtPause(t2m)}
        </span>
      </div>
      {streakHalt && !compact ? (
        <div className="streak-cooldown-row">
          <span className="risk-halt">{status.halt_reason ?? "连续止损暂停"}</span>
          <span>
            冷却 <strong>{countdown}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}
