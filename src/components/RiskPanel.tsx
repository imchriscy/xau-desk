import { useCallback, useEffect, useState } from "react";
import type { Mt5AccountSnapshot } from "../api/mt5";
import {
  confirmRiskBaseline,
  fetchRiskAudit,
  fetchRiskStatus,
  resyncStreakLosses,
  saveRiskConfig,
  type RiskConfigDto,
  type RiskEventRow,
  type RiskStatusDto,
} from "../api/risk";
import CollapsibleHelp from "./CollapsibleHelp";
import StreakRiskProgress from "./StreakRiskProgress";

interface Props {
  open: boolean;
  onClose: () => void;
  account: Mt5AccountSnapshot | null;
}

const emptyCfg = (): RiskConfigDto => ({
  daily_enabled: false,
  per_trade_loss_cap_usd: null,
  per_trade_loss_cap_pct: null,
  daily_loss_cap_usd: null,
  daily_loss_cap_pct: null,
  baseline_equity: null,
  baseline_confirmed_at: null,
  streak_enabled: true,
  streak_tier1_losses: 3,
  streak_tier1_pause_minutes: 30,
  streak_tier2_losses: 5,
  streak_tier2_pause_minutes: 180,
  require_stop_loss: true,
  virtual_equity_usd: null,
  margin_cap_factor: 200,
  max_combined_slots: 6,
  app_magic_only: true,
});

function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePosInt(raw: string, fallback: number, min: number, max: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function MoneyInput({
  label,
  suffix,
  placeholder,
  value,
  step,
  onChange,
  disabled,
}: {
  label: string;
  suffix?: string;
  placeholder?: string;
  value: number | null;
  step: number;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="risk-money-field">
      <span className="risk-money-label">{label}</span>
      <span className="risk-money-input-wrap">
        <input
          type="number"
          min={0}
          step={step}
          className="risk-money-input"
          placeholder={placeholder ?? "—"}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(parseOptionalNumber(e.target.value))}
          onClick={(e) => e.stopPropagation()}
        />
        {suffix ? <span className="risk-money-suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

export default function RiskPanel({ open, onClose, account }: Props) {
  const [status, setStatus] = useState<RiskStatusDto | null>(null);
  const [cfg, setCfg] = useState<RiskConfigDto>(emptyCfg());
  const [msg, setMsg] = useState("");
  const [events, setEvents] = useState<RiskEventRow[]>([]);
  const [showLog, setShowLog] = useState(false);

  const reloadAll = useCallback(async () => {
    const login = account?.login;
    if (login == null) return;
    try {
      const st = await fetchRiskStatus();
      if (st.account_login != null && st.account_login !== login) return;
      setStatus(st);
      setCfg(st.config);
      const audit = await fetchRiskAudit(50);
      setEvents(audit.events);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [account?.login]);

  const reloadStatusOnly = useCallback(async () => {
    const login = account?.login;
    if (login == null) return;
    try {
      const st = await fetchRiskStatus();
      if (st.account_login != null && st.account_login !== login) return;
      setStatus(st);
    } catch {
      /* 轮询失败不打断编辑 */
    }
  }, [account?.login]);

  useEffect(() => {
    if (!open) return;
    void reloadAll();
    const id = window.setInterval(() => void reloadStatusOnly(), 5000);
    return () => clearInterval(id);
  }, [open, account?.login, reloadAll, reloadStatusOnly]);

  if (!open) return null;

  const locked = status?.params_locked === true;
  const halted = status?.halted === true;
  const disabled = locked || halted;

  const applyStrict1000Preset = () => {
    setCfg({
      ...cfg,
      daily_enabled: true,
      streak_enabled: true,
      require_stop_loss: true,
      app_magic_only: true,
      max_combined_slots: 6,
      margin_cap_factor: 200,
      virtual_equity_usd: 1000,
      per_trade_loss_cap_usd: 20,
      per_trade_loss_cap_pct: null,
      daily_loss_cap_usd: 250,
      daily_loss_cap_pct: null,
      streak_tier1_losses: 3,
      streak_tier1_pause_minutes: 30,
      streak_tier2_losses: 5,
      streak_tier2_pause_minutes: 180,
    });
    setMsg("已填入 1000U 模板（20 / 250 / 连损 3·30m / 5·3h）");
  };

  const applyEquityPreset = () => {
    const s = status?.suggested_caps;
    if (!s) return;
    setCfg({
      ...cfg,
      daily_enabled: true,
      streak_enabled: true,
      require_stop_loss: true,
      per_trade_loss_cap_pct: s.per_trade_loss_cap_pct,
      daily_loss_cap_pct: s.daily_loss_cap_pct,
      per_trade_loss_cap_usd: null,
      daily_loss_cap_usd: null,
    });
    setMsg(`已填入净值 % 模板（单笔 ${s.per_trade_loss_cap_pct}% · 日 ${s.daily_loss_cap_pct}%）`);
  };

  const normalizeStreak = (next: RiskConfigDto): RiskConfigDto => {
    const t1 = Math.min(20, Math.max(1, next.streak_tier1_losses ?? 3));
    const t2 = Math.min(30, Math.max(t1 + 1, next.streak_tier2_losses ?? 5));
    return {
      ...next,
      streak_tier1_losses: t1,
      streak_tier1_pause_minutes: Math.min(7 * 24 * 60, Math.max(1, next.streak_tier1_pause_minutes ?? 30)),
      streak_tier2_losses: t2,
      streak_tier2_pause_minutes: Math.min(7 * 24 * 60, Math.max(1, next.streak_tier2_pause_minutes ?? 180)),
    };
  };

  const save = async () => {
    if (!account) {
      setMsg("请先连接 MT5 账户");
      return;
    }
    try {
      const payload = normalizeStreak(cfg);
      await saveRiskConfig(payload);
      if (payload.daily_enabled && payload.baseline_equity == null) {
        await confirmRiskBaseline(account.equity);
        setMsg(`已保存并锁定基准 ${account.equity.toFixed(2)} ${account.currency}`);
      } else {
        setMsg("已保存");
      }
      await reloadAll();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmBase = async () => {
    if (!account) {
      setMsg("请先连接 MT5 账户");
      return;
    }
    try {
      await confirmRiskBaseline(account.equity);
      setMsg(`基准 ${account.equity.toFixed(2)} ${account.currency}`);
      await reloadAll();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel-risk risk-panel"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head risk-panel-head">
          <h2>风控{account ? ` · #${account.login}` : ""}</h2>
          {status ? (
            <div className="risk-status-strip risk-status-inline">
              <span>
                交易日 <strong>{status.session_key}</strong>
              </span>
              {status.halted ? (
                <span className="risk-halt">暂停 · {status.halt_reason}</span>
              ) : (
                <span className="risk-ok">可下单</span>
              )}
            </div>
          ) : null}
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        {halted ? <p className="risk-lock-banner risk-lock-inline">风控暂停中</p> : null}
        {locked ? <p className="risk-lock-banner risk-lock-inline">本窗参数已锁定</p> : null}

        <div className="risk-card-grid risk-card-grid-top">
          <article className="risk-card">
            <h3>单笔亏损上限</h3>
            <div className="risk-money-row">
              <MoneyInput
                label="USD"
                suffix="U"
                placeholder="50"
                step={1}
                value={cfg.per_trade_loss_cap_usd}
                onChange={(v) => setCfg({ ...cfg, per_trade_loss_cap_usd: v })}
                disabled={disabled}
              />
              <MoneyInput
                label="净值"
                suffix="%"
                placeholder="0.5"
                step={0.1}
                value={cfg.per_trade_loss_cap_pct}
                onChange={(v) => setCfg({ ...cfg, per_trade_loss_cap_pct: v })}
                disabled={disabled}
              />
            </div>
          </article>

          <article className="risk-card">
            <h3>当日累计亏损</h3>
            <div className="risk-money-row">
              <MoneyInput
                label="USD"
                suffix="U"
                step={1}
                value={cfg.daily_loss_cap_usd}
                onChange={(v) => setCfg({ ...cfg, daily_loss_cap_usd: v })}
                disabled={disabled}
              />
              <MoneyInput
                label="净值"
                suffix="%"
                step={0.1}
                value={cfg.daily_loss_cap_pct}
                onChange={(v) => setCfg({ ...cfg, daily_loss_cap_pct: v })}
                disabled={disabled}
              />
            </div>
          </article>

          <article className="risk-card risk-card-exposure">
            <h3>头寸与保证金</h3>
            <div className="risk-money-row">
              <MoneyInput
                label="最大头寸"
                suffix="单"
                placeholder="6"
                step={1}
                value={cfg.max_combined_slots ?? 6}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    max_combined_slots: v == null ? 6 : Math.min(20, Math.max(1, Math.round(v))),
                  })
                }
                disabled={disabled}
              />
              <MoneyInput
                label="杠杆预算系数"
                suffix="×"
                placeholder="200"
                step={1}
                value={cfg.margin_cap_factor ?? 200}
                onChange={(v) => setCfg({ ...cfg, margin_cap_factor: v ?? 200 })}
                disabled={disabled}
              />
            </div>
            <div className="risk-money-row risk-money-row-tight">
              <MoneyInput
                label="演算本金"
                suffix="USD"
                placeholder="1000"
                step={1}
                value={cfg.virtual_equity_usd ?? null}
                onChange={(v) => setCfg({ ...cfg, virtual_equity_usd: v })}
                disabled={disabled}
              />
              <div className="risk-live-stat">
                <span className="risk-money-label">MT5 杠杆</span>
                <span className="risk-live-value">
                  {status?.exposure?.leverage != null ? `1:${status.exposure.leverage}` : "—"}
                </span>
              </div>
            </div>
            {status?.exposure ? (
              <div className="risk-live-bar">
                <span>
                  当前 <strong>{status.exposure.app_open_slots}</strong> / {cfg.max_combined_slots ?? 6} 单
                </span>
                <span>
                  保证金 {status.exposure.margin_used_usd.toFixed(0)} / {status.exposure.margin_budget_usd.toFixed(0)} U
                </span>
                <span>Magic {status.exposure.app_magic ?? 8805190}</span>
              </div>
            ) : null}
          </article>
        </div>

        <article className="risk-card risk-card-streak-wide">
          <div className="risk-streak-wide-head">
            <h3>连续止损</h3>
            {status ? (
              <div className="risk-streak-sync">
                <button
                  type="button"
                  className="tool-btn tool-btn-compact"
                  onClick={() =>
                    void (async () => {
                      try {
                        await resyncStreakLosses(false);
                        setMsg("已同步连损");
                        await reloadAll();
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : String(e));
                      }
                    })()
                  }
                >
                  同步
                </button>
                <button
                  type="button"
                  className="tool-btn tool-btn-compact"
                  onClick={() =>
                    void (async () => {
                      try {
                        await resyncStreakLosses(true);
                        setMsg("已重建连损");
                        await reloadAll();
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : String(e));
                      }
                    })()
                  }
                >
                  重建
                </button>
              </div>
            ) : null}
          </div>
          <div className="risk-streak-wide-body">
            {status ? (
              <div className="risk-streak-progress-col">
                <StreakRiskProgress status={status} compact />
              </div>
            ) : null}
            <table className="risk-tier-table">
              <thead>
                <tr>
                  <th>档位</th>
                  <th>连损笔数</th>
                  <th>暂停时长（分钟）</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>档 1</td>
                  <td>
                    <input
                      type="number"
                      className="risk-tier-input"
                      min={1}
                      max={20}
                      disabled={disabled}
                      value={cfg.streak_tier1_losses ?? 3}
                      onChange={(e) =>
                        setCfg((c) =>
                          normalizeStreak({
                            ...c,
                            streak_tier1_losses: parsePosInt(e.target.value, 3, 1, 20),
                          }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="risk-tier-input"
                      min={1}
                      disabled={disabled}
                      value={cfg.streak_tier1_pause_minutes ?? 30}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          streak_tier1_pause_minutes: parsePosInt(e.target.value, 30, 1, 10080),
                        })
                      }
                    />
                  </td>
                </tr>
                <tr>
                  <td>档 2</td>
                  <td>
                    <input
                      type="number"
                      className="risk-tier-input"
                      min={2}
                      max={30}
                      disabled={disabled}
                      value={cfg.streak_tier2_losses ?? 5}
                      onChange={(e) =>
                        setCfg((c) =>
                          normalizeStreak({
                            ...c,
                            streak_tier2_losses: parsePosInt(e.target.value, 5, 2, 30),
                          }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="risk-tier-input"
                      min={1}
                      disabled={disabled}
                      value={cfg.streak_tier2_pause_minutes ?? 180}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          streak_tier2_pause_minutes: parsePosInt(e.target.value, 180, 1, 10080),
                        })
                      }
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <footer className="risk-footer">
          {!disabled ? (
            <div className="risk-footer-presets">
              <button type="button" className="tool-btn tool-btn-compact" onClick={applyStrict1000Preset}>
                1000U 模板
              </button>
              {status?.suggested_caps ? (
                <button type="button" className="tool-btn tool-btn-compact" onClick={applyEquityPreset}>
                  净值 % 模板
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="risk-footer-checks">
            <label className="check-row" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={cfg.daily_enabled}
                disabled={disabled}
                onChange={(e) => setCfg({ ...cfg, daily_enabled: e.target.checked })}
              />
              <span>启用日风控（保存后本窗锁定参数）</span>
            </label>
            <label className="check-row" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={cfg.streak_enabled !== false}
                disabled={disabled}
                onChange={(e) => setCfg({ ...cfg, streak_enabled: e.target.checked })}
              />
              <span>启用连续止损暂停</span>
            </label>
            <label className="check-row" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={cfg.require_stop_loss !== false}
                disabled={disabled}
                onChange={(e) => setCfg({ ...cfg, require_stop_loss: e.target.checked })}
              />
              <span>强制每笔带止损（SL）</span>
            </label>
          </div>

          <div className="risk-footer-confirm">
            <div className="risk-baseline-row">
              <span>
                基准 {account ? `${account.equity.toFixed(2)} ${account.currency}` : "—"}
                {cfg.baseline_equity != null ? ` · 已锁 ${cfg.baseline_equity.toFixed(2)}` : ""}
              </span>
              <button type="button" className="tool-btn tool-btn-compact" disabled={disabled} onClick={() => void confirmBase()}>
                锁定基准
              </button>
            </div>
            <button type="button" className="btn-confirm-pending" disabled={disabled} onClick={() => void save()}>
              保存并确认
            </button>
          </div>

          <CollapsibleHelp title="规则说明">
            <p>单笔 / 当日：USD 与净值 % 填其一，都填取更严。日窗北京 06:00～次日 05:00。</p>
            <p>
              保证金预算 = 演算本金 × 杠杆预算系数 ÷ MT5 账户杠杆。最大头寸含持仓+挂单。仅统计 APP Magic 单。
            </p>
            <p>连损：平仓亏损计入（含手动平亏）。日风控与连损暂停取更晚解锁。</p>
          </CollapsibleHelp>

          {msg ? <p className="settings-msg">{msg}</p> : null}

          {events.length > 0 ? (
            <>
              <button type="button" className="link-btn" onClick={() => setShowLog((v) => !v)}>
                {showLog ? "收起" : "查看"} 最近风控事件
              </button>
              {showLog ? (
                <ul className="risk-event-list risk-event-list-compact">
                  {events.slice(0, 12).map((ev, i) => (
                    <li key={`${ev.ts_bjt}-${i}`}>
                      <time>{ev.ts_bjt.slice(0, 19)}</time> · <code>{ev.event}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
