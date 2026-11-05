import PendingOrderPalette from "./PendingOrderPalette";
import type { ArmState, OrderFormState, OrderKind, OrderSide, PendingOrderMode } from "../types";

interface Props {
  armState: ArmState;
  lastPrice: number;
  bid?: number | null;
  ask?: number | null;
  form: OrderFormState;
  mt5Connected: boolean;
  onFormChange: (patch: Partial<OrderFormState>) => void;
  onSubmit: (side: OrderSide) => void;
  onFlash?: (msg: string) => void;
  onPaletteDragMove?: (mode: PendingOrderMode, clientX: number, clientY: number) => void;
  onPaletteDragEnd?: (mode: PendingOrderMode, clientX: number, clientY: number) => void;
  stopLimitAwaitingTrigger?: boolean;
  onStopLimitDraftCancel?: () => void;
  tradingLocked?: boolean;
}

export default function OrderTicket({
  armState,
  lastPrice,
  bid,
  ask,
  form,
  mt5Connected,
  onFormChange,
  onSubmit,
  onFlash,
  onPaletteDragMove,
  onPaletteDragEnd,
  stopLimitAwaitingTrigger,
  onStopLimitDraftCancel,
  tradingLocked,
}: Props) {
  const disabled = armState !== "armed" || !!tradingLocked;

  const trySubmit = (side: OrderSide) => {
    if (tradingLocked) {
      onFlash?.("日风控锁定中，无法下单");
      return;
    }
    if (disabled) {
      onFlash?.("请先 ARM（Space）后再下单");
      return;
    }
    if (!mt5Connected) {
      onFlash?.("MT5 未连接：请打开终端并 restart-backend.cmd");
      return;
    }
    onSubmit(side);
  };

  return (
    <div className="order-ticket">
      <div className="order-ticket-quote">
        <span className="quote-label">参考价</span>
        <span className="quote-last">{lastPrice.toFixed(2)}</span>
        {bid != null && ask != null ? (
          <span className="quote-ba">
            Bid {bid.toFixed(2)} · Ask {ask.toFixed(2)}
          </span>
        ) : null}
      </div>

      <div className="field-row order-type-row">
        <div className="field field-grow">
          <label>类型</label>
          <select
            value={form.kind}
            disabled={disabled}
            onChange={(e) => onFormChange({ kind: e.target.value as OrderKind })}
          >
            <option value="market">市价</option>
            <option value="pending">图形挂单</option>
          </select>
        </div>
        <div className="field field-lots">
          <label>手数 · 1/2/3</label>
          <input
            type="number"
            value={form.lots}
            min={0.01}
            step={0.01}
            disabled={disabled}
            onChange={(e) => onFormChange({ lots: Number(e.target.value) || 0.01 })}
          />
        </div>
      </div>

      {form.kind === "market" ? (
        <>
          <div className="field-row">
            <div className="field">
              <label>止损 $（0=不带）</label>
              <input
                type="number"
                value={form.slOffset}
                min={0}
                step={0.5}
                disabled={disabled}
                onChange={(e) => onFormChange({ slOffset: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>止盈 $（0=不带）</label>
              <input
                type="number"
                value={form.tpOffset}
                min={0}
                step={0.5}
                disabled={disabled}
                onChange={(e) => onFormChange({ tpOffset: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="order-actions">
            <button type="button" className="btn-long" disabled={disabled} onClick={() => trySubmit("buy")}>
              买入 <kbd>B</kbd>
            </button>
            <button type="button" className="btn-short" disabled={disabled} onClick={() => trySubmit("sell")}>
              卖出 <kbd>S</kbd>
            </button>
          </div>
        </>
      ) : (
        <PendingOrderPalette
          lots={form.lots}
          disabled={disabled || !mt5Connected}
          stopLimitAwaitingTrigger={stopLimitAwaitingTrigger}
          onStopLimitDraftCancel={onStopLimitDraftCancel}
          onDragMove={(mode, x, y) => onPaletteDragMove?.(mode, x, y)}
          onDragEnd={(mode, x, y) => onPaletteDragEnd?.(mode, x, y)}
        />
      )}
    </div>
  );
}
