import { unrealizedPnl } from "../orderLogic";
import type { PendingOrder, Position } from "../types";

interface Props {
  positions: Position[];
  pending: PendingOrder[];
  lastPrice: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClosePosition: (id: string) => void;
  onCancelPending: (id: string) => void;
  tradingLocked?: boolean;
}

function fmtSide(side: "buy" | "sell"): string {
  return side === "buy" ? "多" : "空";
}

export default function PositionsPanel({
  positions,
  pending,
  lastPrice,
  selectedId,
  onSelect,
  onClosePosition,
  onCancelPending,
  tradingLocked,
}: Props) {
  const totalPnl = positions.reduce(
    (s, p) => s + unrealizedPnl(p.side, p.lots, p.openPrice, lastPrice),
    0,
  );

  return (
    <div className="positions-panel">
      <div className="positions-summary">
        <span>
          持仓 <strong>{positions.length}</strong>
        </span>
        <span>
          挂单 <strong>{pending.length}</strong>
        </span>
        <span className={totalPnl >= 0 ? "chg-up" : "chg-down"}>
          浮盈 <strong>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}</strong> USD
        </span>
      </div>

      {positions.length === 0 && pending.length === 0 ? (
        <p className="positions-empty">暂无</p>
      ) : null}

      <ul className="trade-list">
        {positions.map((p) => {
          const pnl = unrealizedPnl(p.side, p.lots, p.openPrice, lastPrice);
          const active = selectedId === p.id;
          return (
            <li key={p.id} className={`trade-row position ${active ? "selected" : ""}`}>
              <button type="button" className="trade-row-main" onClick={() => onSelect(active ? null : p.id)}>
                <span className={`side ${p.side}`}>{fmtSide(p.side)}</span>
                <span className="mono">{p.lots.toFixed(2)} lot</span>
                <span className="mono">@{p.openPrice.toFixed(2)}</span>
                <span className={`mono pnl ${pnl >= 0 ? "up" : "down"}`}>
                  {pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(2)}
                </span>
              </button>
              <div className="trade-row-meta">
                <span>#{p.ticket}</span>
                <span>SL {p.sl?.toFixed(2) ?? "—"}</span>
                <span>TP {p.tp?.toFixed(2) ?? "—"}</span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={tradingLocked}
                  onClick={() => onClosePosition(p.id)}
                >
                  平仓
                </button>
              </div>
            </li>
          );
        })}
        {pending.map((o) => {
          const active = selectedId === o.id;
          return (
            <li key={o.id} className={`trade-row pending ${active ? "selected" : ""}`}>
              <button type="button" className="trade-row-main" onClick={() => onSelect(active ? null : o.id)}>
                <span className="side limit">限价</span>
                <span className={`side ${o.side}`}>{fmtSide(o.side)}</span>
                <span className="mono">{o.lots.toFixed(2)}</span>
                <span className="mono">@{o.entryPrice.toFixed(2)}</span>
              </button>
              <div className="trade-row-meta">
                <span>SL {o.sl?.toFixed(2) ?? "—"}</span>
                <span>TP {o.tp?.toFixed(2) ?? "—"}</span>
                <span className="drag-hint">图上拖动 SL/TP/入场</span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={tradingLocked}
                  onClick={() => onCancelPending(o.id)}
                >
                  撤单
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

