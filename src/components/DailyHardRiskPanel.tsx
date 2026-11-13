import { HARD_RISK_ORDINANCE, SIN_POISON_LABEL, type SinPoison } from "../data/hardRiskOrdinance";

interface Props {
  expanded: boolean;
  onToggle: () => void;
}

function SinBadge({ sin }: { sin: SinPoison }) {
  return <span className={`hard-sin-badge sin-${sin}`}>{SIN_POISON_LABEL[sin]}</span>;
}

export default function DailyHardRiskPanel({ expanded, onToggle }: Props) {
  return (
    <div className="daily-hard-risk-panel">
      <button type="button" className="daily-hard-risk-toggle" onClick={onToggle} aria-expanded={expanded}>
        <span className="daily-hard-risk-toggle-label">每日必读 · 硬风控</span>
        <span className="daily-hard-risk-toggle-meta">{expanded ? "▾ 收起" : "▸ 十条箴言"}</span>
      </button>
      {expanded ? (
        <div className="daily-hard-risk-body">
          <p className="daily-hard-risk-hint">外览四字 · 点卡片展开细则 · 触即德破</p>
          <div className="daily-hard-risk-cards">
            {HARD_RISK_ORDINANCE.map((rule) => (
              <details key={rule.id} className="hard-risk-mini-card">
                <summary className="hard-risk-mini-summary">
                  <span className="hard-risk-mini-idx">{rule.id}</span>
                  {rule.sins.map((s) => (
                    <SinBadge key={s} sin={s} />
                  ))}
                  <span className="hard-seven-badge">{rule.sevenDeadly}</span>
                  <span className="hard-poem-text">{rule.poem}</span>
                  <span className="hard-risk-chevron">▸</span>
                </summary>
                <p className="hard-risk-mini-detail">
                  <strong>{rule.title}</strong>
                  {rule.detail}
                  <span className="hard-risk-mini-warn">{rule.warn}</span>
                </p>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
