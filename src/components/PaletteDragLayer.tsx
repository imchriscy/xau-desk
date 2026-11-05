import type { PendingPaletteDrag } from "../types";
import { inferSide, modeLabel } from "../orderDraftLogic";

interface Props {
  drag: PendingPaletteDrag | null;
  midPrice: number;
  chartWrapEl: HTMLElement | null;
  priceLineClientY: number | null;
  stopLimitPhase?: 1 | 2;
}

const CARD_CLASS: Record<PendingPaletteDrag["mode"], string> = {
  limit: "card-limit",
  stop: "card-stop",
  stop_limit: "card-stoplimit",
};

export default function PaletteDragLayer({
  drag,
  midPrice,
  chartWrapEl,
  priceLineClientY,
  stopLimitPhase,
}: Props) {
  if (!drag) return null;

  const side =
    drag.price != null ? inferSide(drag.mode, drag.price, midPrice) : ("buy" as const);
  const cardClass = CARD_CLASS[drag.mode];
  const inChart = drag.inChart && drag.price != null && priceLineClientY != null;

  return (
    <>
      {inChart && chartWrapEl ? (
        <div
          className="palette-drag-price-line"
          style={{
            top: priceLineClientY,
            left: chartWrapEl.getBoundingClientRect().left,
            width: chartWrapEl.getBoundingClientRect().width,
          }}
        />
      ) : null}
      <div
        className={`palette-drag-ghost palette-drag-ghost-flat ${cardClass}`}
        style={{
          left: drag.clientX + 10,
          top: drag.clientY,
        }}
      >
        <span className="card-type">{modeLabel(drag.mode)}</span>
        <span className={`draft-side ${side}`}>{side === "buy" ? "BUY" : "SELL"}</span>
        <span className="card-lots">{drag.lots.toFixed(2)}</span>
        {drag.price != null ? (
          <span className="palette-drag-price-inline">{drag.price.toFixed(2)}</span>
        ) : null}
        {inChart ? (
          <span className="palette-drag-hint">
            {drag.mode === "stop_limit" && stopLimitPhase === 1
              ? "松手设 STOP"
              : drag.mode === "stop_limit" && stopLimitPhase === 2
                ? "松手设触发价 · 确认"
                : "松手挂单"}
          </span>
        ) : null}
      </div>
    </>
  );
}
