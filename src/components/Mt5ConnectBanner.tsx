import { useState } from "react";
import { rescanMt5Bridge } from "../api/mt5";

interface Props {
  error: string | null;
  onRetry: () => void;
}

export default function Mt5ConnectBanner({ error, onRetry }: Props) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  const connectNow = async () => {
    setBusy(true);
    setHint("");
    try {
      const r = await rescanMt5Bridge();
      onRetry();
      if (r.changed) {
        setHint(`已切换到桥目录：${r.bridge_dir ?? ""}`);
      } else {
        setHint("已重新扫描。若仍无账户，请确认算法交易为绿色。");
      }
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt5-connect-banner" role="status">
      <h3 id="mt5-connect-title">只需两步</h3>
      <ol>
        <li>打开 MetaTrader 5 并登录账户。</li>
        <li>
          点工具栏<strong>算法交易</strong>（绿色）。连接组件由 XauDesk 自动挂载，不用在导航器里拖 EA。
        </li>
      </ol>
      <p className="field-hint">
        黄金 / 比特币 / 纳指等品种名因券商而异，无需去「市场报价」手填；开启算法交易后 EA 会自动在全市场匹配。
      </p>
      {error ? <p className="chart-error">{error}</p> : null}
      <div className="settings-actions-row">
        <button type="button" className="btn-confirm-pending" disabled={busy} onClick={() => void connectNow()}>
          {busy ? "正在连接…" : "立即刷新 MT5 连接"}
        </button>
      </div>
      {hint ? <p className="settings-msg">{hint}</p> : null}
    </div>
  );
}
