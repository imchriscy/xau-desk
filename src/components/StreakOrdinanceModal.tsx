import { HARD_RISK_ORDINANCE, SIN_POISON_LABEL } from "../data/hardRiskOrdinance";

export type StreakAlertTier = "tier1" | "tier2";

interface Props {
  open: boolean;
  tier: StreakAlertTier;
  consecutiveLosses: number;
  pauseMinutes: number;
  onClose: () => void;
}

const HIGHLIGHT_IDS = [7, 8, 4, 5] as const;

export default function StreakOrdinanceModal({
  open,
  tier,
  consecutiveLosses,
  pauseMinutes,
  onClose,
}: Props) {
  if (!open) return null;

  const title =
    tier === "tier1"
      ? `连续止损 ${consecutiveLosses} 笔 · 暂停 ${pauseMinutes} 分钟`
      : `连续止损 ${consecutiveLosses} 笔 · 暂停 ${pauseMinutes} 分钟（长档）`;

  const highlights = HARD_RISK_ORDINANCE.filter((r) => HIGHLIGHT_IDS.includes(r.id as (typeof HIGHLIGHT_IDS)[number]));

  return (
    <div
      className="modal-backdrop streak-ordinance-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="streak-ordinance-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel modal-panel-streak-ordinance">
        <div className="modal-head">
          <h2 id="streak-ordinance-title">连损触发 · 每日硬风控复读</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <p className="streak-ordinance-lead">{title}</p>
        <p className="streak-ordinance-lead sub">已强制 DISARM · 阅读后关闭，冷静期满前禁止 ARM。</p>
        <div className="streak-ordinance-cards">
          {highlights.map((rule) => (
            <div key={rule.id} className="hard-risk-mini-card flat">
              <div className="hard-risk-mini-summary static">
                {rule.sins.map((s) => (
                  <span key={s} className={`hard-sin-badge sin-${s}`}>
                    {SIN_POISON_LABEL[s]}
                  </span>
                ))}
                <span className="hard-seven-badge">{rule.sevenDeadly}</span>
                <span className="hard-poem-text">{rule.poem}</span>
              </div>
              <p className="hard-risk-mini-detail open">
                <strong>{rule.title}</strong>
                {rule.detail}
              </p>
            </div>
          ))}
        </div>
        <p className="streak-ordinance-footer">完整十条见侧栏「每日必读 · 硬风控」。</p>
        <div className="streak-ordinance-actions">
          <button type="button" className="tool-btn streak-ordinance-dismiss" onClick={onClose}>
            我已阅读 · 关闭
          </button>
        </div>
      </div>
    </div>
  );
}
