import { useEffect, useRef } from "react";
import type { OrderSide } from "../types";
import { legUsd } from "../orderDraftLogic";

export interface SlTpEditorModel {
  overlayId: string;
  kind: "position" | "pending";
  entry: number;
  side: OrderSide;
  lots: number;
  sl: number | null;
  tp: number | null;
  slEnabled: boolean;
  tpEnabled: boolean;
}

interface Props {
  model: SlTpEditorModel;
  onPatch: (patch: Partial<SlTpEditorModel>) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

const HIDE_MS = 2000;

export default function SlTpEditorPanel({ model, onPatch, onConfirm, onDismiss, disabled }: Props) {
  const hideTimer = useRef<number | null>(null);

  const clearHide = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleHide = () => {
    clearHide();
    hideTimer.current = window.setTimeout(() => onDismiss(), HIDE_MS);
  };

  useEffect(() => () => clearHide(), []);

  const slUsd =
    model.slEnabled && model.sl != null ? legUsd(model.entry, model.sl, model.lots) : null;
  const tpUsd =
    model.tpEnabled && model.tp != null ? legUsd(model.entry, model.tp, model.lots) : null;

  return (
    <div
      className="sltp-editor-panel"
      onMouseEnter={clearHide}
      onMouseLeave={scheduleHide}
    >
      <div className="sltp-editor-head">
        <span className="sltp-title">止盈止损</span>
        <span className={`draft-side ${model.side}`}>{model.side === "buy" ? "BUY" : "SELL"}</span>
        <span className="sltp-meta">@{model.entry.toFixed(2)} · {model.lots.toFixed(2)} lot</span>
      </div>
      <p className="field-hint">可只设 SL 或 TP；拖动图上橙/绿线微调。移出面板 {HIDE_MS / 1000}s 后自动关闭。</p>
      <div className="draft-toggles">
        <button
          type="button"
          className={`toggle-sl ${model.slEnabled ? "on" : ""}`}
          onClick={() => onPatch({ slEnabled: !model.slEnabled })}
        >
          SL {slUsd != null ? `$${slUsd.toFixed(0)}` : "—"}
        </button>
        <button
          type="button"
          className={`toggle-tp ${model.tpEnabled ? "on" : ""}`}
          onClick={() => onPatch({ tpEnabled: !model.tpEnabled })}
        >
          TP {tpUsd != null ? `$${tpUsd.toFixed(0)}` : "—"}
        </button>
      </div>
      <button
        type="button"
        className="btn-confirm-pending"
        disabled={disabled || (!model.slEnabled && !model.tpEnabled)}
        onClick={onConfirm}
      >
        确认止盈止损
      </button>
    </div>
  );
}
