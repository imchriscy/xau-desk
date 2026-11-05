import { useRef, useState } from "react";
import type { PendingOrderMode } from "../types";

interface Props {
  lots: number;
  disabled?: boolean;
  stopLimitAwaitingTrigger?: boolean;
  onStopLimitDraftCancel?: () => void;
  onDragMove: (mode: PendingOrderMode, clientX: number, clientY: number) => void;
  onDragEnd: (mode: PendingOrderMode, clientX: number, clientY: number) => void;
}

const MODES: { mode: PendingOrderMode; label: string; className: string }[] = [
  { mode: "limit", label: "Limit", className: "card-limit" },
  { mode: "stop", label: "Stop", className: "card-stop" },
  { mode: "stop_limit", label: "StopLimit", className: "card-stoplimit" },
];

export default function PendingOrderPalette({
  lots,
  disabled,
  stopLimitAwaitingTrigger,
  onStopLimitDraftCancel,
  onDragMove,
  onDragEnd,
}: Props) {
  const dragModeRef = useRef<PendingOrderMode | null>(null);
  const [draggingMode, setDraggingMode] = useState<PendingOrderMode | null>(null);

  const finishDrag = (mode: PendingOrderMode, e: React.PointerEvent) => {
    dragModeRef.current = null;
    setDraggingMode(null);
    onDragEnd(mode, e.clientX, e.clientY);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const startDrag = (mode: PendingOrderMode, e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragModeRef.current = mode;
    setDraggingMode(mode);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onDragMove(mode, e.clientX, e.clientY);
  };

  return (
    <div className="pending-palette">
      <div className="palette-cards">
        {MODES.map((m) => (
          <div
            key={m.mode}
            role="button"
            tabIndex={0}
            className={`palette-card ${m.className} ${draggingMode === m.mode ? "dragging" : ""} ${
              m.mode === "stop_limit" && stopLimitAwaitingTrigger ? "stoplimit-step2" : ""
            }`}
            title={
              m.mode === "stop_limit" && stopLimitAwaitingTrigger
                ? "第 2 步：拖到图表设触发价；双击取消"
                : m.mode === "stop_limit"
                  ? "第 1 步：拖到图表设 STOP"
                  : undefined
            }
            onDoubleClick={(e) => {
              if (m.mode !== "stop_limit") return;
              e.preventDefault();
              e.stopPropagation();
              onStopLimitDraftCancel?.();
            }}
            onPointerDown={(e) => startDrag(m.mode, e)}
            onPointerMove={(e) => {
              if (dragModeRef.current !== m.mode) return;
              onDragMove(m.mode, e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (dragModeRef.current !== m.mode) return;
              finishDrag(m.mode, e);
            }}
            onPointerCancel={(e) => {
              if (dragModeRef.current !== m.mode) return;
              finishDrag(m.mode, e);
            }}
          >
            <span className="card-type">{m.label}</span>
            {m.mode === "stop_limit" && stopLimitAwaitingTrigger ? (
              <span className="card-step">2/2 触发</span>
            ) : m.mode === "stop_limit" ? (
              <span className="card-step muted">1/2 STOP</span>
            ) : null}
            <span className="card-lots">{lots.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
