import { useEffect, useState } from "react";
import type { Mt5AccountSnapshot } from "../api/mt5";
import { detectMt5Account } from "../api/mt5";
import type { AppSettings } from "../settingsStorage";
import SettingsRiskLog from "./SettingsRiskLog";
import CollapsibleHelp from "./CollapsibleHelp";

interface Props {
  open: boolean;
  onClose: () => void;
  account: Mt5AccountSnapshot | null;
  onAccountChange: () => void;
  onSettingsChange: (s: AppSettings) => void;
}

export default function SettingsModal({
  open,
  onClose,
  account,
  onAccountChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open) setMsg("");
  }, [open]);

  if (!open) return null;

  const refreshFromMt5 = async () => {
    setBusy(true);
    setMsg("");
    try {
      const a = await detectMt5Account();
      if (!a.online) {
        setMsg("MT5 未登录或未连接；请在 MetaTrader 5 登录目标账户并开启「算法交易」");
        return;
      }
      onAccountChange();
      setMsg(`已同步 #${a.login} · ${a.server} · 净值 ${a.equity.toFixed(2)} ${a.currency}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-settings"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>设置</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="modal-section">
          <div className="settings-actions-row">
            <button
              type="button"
              className="btn-confirm-pending"
              disabled={busy}
              onClick={() => void refreshFromMt5()}
            >
              刷新 MT5 连接
            </button>
          </div>
          {account ? (
            <div className="account-card">
              <div className="acct-line">
                <strong>#{account.login}</strong> · {account.server}
              </div>
              <div className="acct-balances">
                <span>余额 {account.balance.toFixed(2)} {account.currency}</span>
                <span>净值 {account.equity.toFixed(2)}</span>
                <span>可用 {account.margin_free.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="field-hint">终端会自动读取当前 MT5 登录；若为空请确认网关 5191 已启动</p>
          )}
        </section>

        <CollapsibleHelp title="使用说明（必读）">
          <ol className="settings-help-list">
            <li>在 MetaTrader 5 本地登录你要交易的账户（模拟/实盘以 MT5 为准）。</li>
            <li>在 MT5 工具栏开启<strong>算法交易</strong>（AutoTrading）。</li>
            <li>保持本终端与网关运行；图表与账户会自动同步，也可点上方「刷新 MT5 连接」。</li>
            <li>换账户时：只需在 MT5 切换登录，再点刷新即可，无需在本界面填写账号密码。</li>
            <li>网关异常时运行项目内的 restart-backend.cmd。</li>
          </ol>
        </CollapsibleHelp>

        <SettingsRiskLog />
        {msg ? <p className="settings-msg">{msg}</p> : null}
      </div>
    </div>
  );
}
