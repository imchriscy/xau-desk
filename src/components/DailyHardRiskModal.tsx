import { HARD_RISK_ORDINANCE, SIN_POISON_LABEL, type SinPoison } from "../data/hardRiskOrdinance";

interface Props {
  open: boolean;
  onClose: () => void;
}

function SinBadge({ sin }: { sin: SinPoison }) {
  return <span className={`hard-sin-badge sin-${sin}`}>{SIN_POISON_LABEL[sin]}</span>;
}

export default function DailyHardRiskModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-wide daily-hard-risk-modal"
        role="dialog"
        aria-labelledby="daily-hard-risk-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="daily-hard-risk-title">每日必读 · 硬风控十条</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
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
      </div>
    </div>
  );
}