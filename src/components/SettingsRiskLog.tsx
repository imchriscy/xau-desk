import { useCallback, useEffect, useState } from "react";
import { fetchRiskAudit, type RiskAuditBundle, type RiskEventRow } from "../api/risk";

function loginLabel(row: RiskEventRow): string {
  const n = row.login;
  if (n === 0) return "系统";
  return `#${n}`;
}

export default function SettingsRiskLog() {
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<RiskAuditBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const b = await fetchRiskAudit(100);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <section className="modal-section">
      <h3>风控审计日志</h3>
      <button type="button" className="tool-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "收起日志" : "查看风控日志"}
      </button>
      {open ? (
        <div className="settings-risk-log">
          {loading ? <p className="field-hint">加载中…</p> : null}
          {err ? <p className="settings-msg">{err}</p> : null}
          {bundle ? (
            <>
              <div className="risk-log-meta">
                <span>
                  完整性{" "}
                  <strong className={bundle.integrity.valid ? "risk-ok" : "risk-halt"}>
                    {bundle.integrity.valid ? "通过" : "异常"}
                  </strong>
                </span>
                <span>已校验 {bundle.integrity.checked_rows} 条</span>
                {bundle.integrity.legacy_rows_without_hash > 0 ? (
                  <span>旧版无哈希 {bundle.integrity.legacy_rows_without_hash} 条</span>
                ) : null}
                {!bundle.integrity.valid && bundle.integrity.first_break_line != null ? (
                  <span className="risk-halt">断链行 #{bundle.integrity.first_break_line}</span>
                ) : null}
                <span className="field-micro">
                  服务器 {bundle.server_ts_bjt.slice(0, 19)} BJT
                  {bundle.gateway_version ? ` · 网关 ${bundle.gateway_version}` : ""}
                </span>
              </div>
              {bundle.integrity.tip ? (
                <p className="help-fold-body" style={{ marginTop: "0.35rem" }}>
                  {bundle.integrity.tip}
                </p>
              ) : null}
              <ul className="risk-event-list risk-event-list-settings">
                {bundle.events.length === 0 ? (
                  <li>暂无事件</li>
                ) : (
                  bundle.events.map((ev, i) => (
                    <li key={`${ev.seq ?? i}-${ev.ts_bjt}`}>
                      <div className="risk-log-line-head">
                        <time>{ev.ts_bjt.replace("T", " ").slice(0, 19)}</time>
                        <span>{loginLabel(ev)}</span>
                        <code>{ev.event}</code>
                        {ev.seq != null ? <span className="field-micro">seq {ev.seq}</span> : null}
                      </div>
                      <div>{ev.detail}</div>
                      {ev.row_hash ? (
                        <div className="field-micro risk-log-hash" title={ev.row_hash}>
                          #{ev.row_hash.slice(0, 12)}…
                        </div>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
              <button type="button" className="link-btn" onClick={() => void load()}>
                刷新
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
