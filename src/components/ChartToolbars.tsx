import type { DrawToolKind, Timeframe } from "../types";
import { tfLabel } from "../mockData";

const DRAW_TOOLS: { id: DrawToolKind; label: string; title: string }[] = [
  { id: "trend", label: "直线", title: "拖拽画趋势线" },
  { id: "rect", label: "矩形", title: "拖拽画矩形" },
  { id: "fib", label: "斐波", title: "拖拽画斐波那契" },
];

interface Props {
  timeframe: Timeframe;
  timeframes: Timeframe[];
  onTimeframe: (tf: Timeframe) => void;
  onResetView: () => void;
  onRefresh: () => void;
  drawTool: DrawToolKind;
  onDrawTool: (t: DrawToolKind) => void;
  onClearDrawings: () => void;
  selectedDrawingId?: string | null;
  onDeleteSelectedDrawing?: () => void;
  onScrollToLatest?: () => void;
}

export default function ChartToolbars({
  timeframe,
  timeframes,
  onTimeframe,
  onResetView,
  onRefresh,
  drawTool,
  onDrawTool,
  onClearDrawings,
  selectedDrawingId = null,
  onDeleteSelectedDrawing,
  onScrollToLatest,
}: Props) {
  return (
    <div className="chart-command-bar">
      <div className="chart-command-section">
        <span className="group-label">周期</span>
        {timeframes.map((tf) => (
          <button
            key={tf}
            type="button"
            className={`tf-btn ${timeframe === tf ? "active" : ""}`}
            onClick={() => onTimeframe(tf)}
          >
            {tfLabel(tf)}
          </button>
        ))}
      </div>

      <div className="chart-command-divider" aria-hidden />

      <div className="chart-command-section chart-command-draw">
        <span className="group-label">绘制</span>
        {DRAW_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tf-btn tf-btn-compact ${drawTool === t.id ? "active" : ""}`}
            title={t.title}
            onClick={() => onDrawTool(drawTool === t.id ? null : t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="tool-btn tool-btn-compact"
          disabled={!selectedDrawingId}
          title="删除选中的画线"
          onClick={() => onDeleteSelectedDrawing?.()}
        >
          删选中
        </button>
        <button type="button" className="tool-btn tool-btn-compact" onClick={onClearDrawings}>
          清空
        </button>
      </div>

      <div className="chart-command-spacer" />

      <div className="chart-command-section chart-command-actions">
        <button
          type="button"
          className="tool-btn tool-btn-compact"
          title="跳到最新 K 线"
          onClick={() => onScrollToLatest?.()}
        >
          最新
        </button>
        <button type="button" className="tool-btn tool-btn-compact" onClick={onResetView}>
          重置视图
        </button>
        <button type="button" className="tool-btn tool-btn-compact" onClick={onRefresh}>
          刷新
        </button>
      </div>
    </div>
  );
}
