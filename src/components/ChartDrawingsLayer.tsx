import type { ChartDrawing, Timeframe } from "../types";
import { TF_SECONDS } from "../mockData";

export interface ChartCoordApi {
  timeToX: (time: number) => number | null;
  priceToY: (price: number) => number | null;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

type TwoPointDrawing = Extract<
  ChartDrawing,
  { kind: "trend" | "rect" | "measure" | "fib" }
>;

function isTwoPoint(d: ChartDrawing): d is TwoPointDrawing {
  return d.kind === "trend" || d.kind === "rect" || d.kind === "measure" || d.kind === "fib";
}

function measureStats(d: TwoPointDrawing, tf: Timeframe): { bars: number; pct: number; dur: string } {
  const step = TF_SECONDS[tf];
  const bars = Math.max(1, Math.round(Math.abs(d.t2 - d.t1) / step));
  const pct = d.p1 !== 0 ? ((d.p2 - d.p1) / d.p1) * 100 : 0;
  const sec = Math.abs(d.t2 - d.t1);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const dur = h > 0 ? `${h}h${m}m` : `${m}m`;
  return { bars, pct, dur };
}

function renderDrawing(
  d: ChartDrawing,
  coord: ChartCoordApi,
  timeframe: Timeframe,
  width: number,
  selected: boolean,
): React.ReactNode {
  const selClass = selected ? " draw-selected" : "";
  if (d.kind === "hline") {
    const y = coord.priceToY(d.price);
    if (y == null) return null;
    return (
      <g key={d.id}>
        <line x1={0} y1={y} x2={width} y2={y} className="draw-hline" />
        <text x={4} y={y - 4} className="draw-label">
          {d.price.toFixed(2)}
        </text>
      </g>
    );
  }

  if (d.kind === "rr") {
    const x = coord.timeToX(d.t);
    const ye = coord.priceToY(d.entry);
    const ys = coord.priceToY(d.stop);
    const yt = coord.priceToY(d.target);
    if (x == null || ye == null || ys == null || yt == null) return null;
    const risk = Math.abs(d.entry - d.stop);
    const reward = Math.abs(d.target - d.entry);
    const rr = risk > 0 ? reward / risk : 0;
    const yTop = Math.min(ye, ys, yt);
    const yBot = Math.max(ye, ys, yt);
    return (
      <g key={d.id}>
        <rect x={x - 20} y={yTop} width={40} height={yBot - yTop} className="draw-rr-box" />
        <line x1={x - 30} x2={x + 30} y1={ye} y2={ye} className="draw-rr-entry" />
        <line x1={x - 30} x2={x + 30} y1={ys} y2={ys} className="draw-rr-stop" />
        <line x1={x - 30} x2={x + 30} y1={yt} y2={yt} className="draw-rr-target" />
        <text x={x + 34} y={ye} className="draw-label">
          RR 1:{rr.toFixed(2)}
        </text>
      </g>
    );
  }

  if (!isTwoPoint(d)) return null;

  const x1 = coord.timeToX(d.t1);
  const x2 = coord.timeToX(d.t2);
  const y1 = coord.priceToY(d.p1);
  const y2 = coord.priceToY(d.p2);
  if (x1 == null || x2 == null || y1 == null || y2 == null) return null;

  if (d.kind === "trend") {
    return (
      <g key={d.id}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className={`draw-trend${selClass}`} />
        {selected ? (
          <>
            <circle cx={x1} cy={y1} r={5} className="draw-handle" />
            <circle cx={x2} cy={y2} r={5} className="draw-handle" />
          </>
        ) : null}
      </g>
    );
  }

  if (d.kind === "rect") {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    return (
      <g key={d.id}>
        <rect x={x} y={y} width={w} height={h} className={`draw-rect${selClass}`} />
        {selected ? (
          <>
            <circle cx={x1} cy={y1} r={5} className="draw-handle" />
            <circle cx={x2} cy={y2} r={5} className="draw-handle" />
          </>
        ) : null}
      </g>
    );
  }

  if (d.kind === "measure") {
    const st = measureStats(d, timeframe);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return (
      <g key={d.id}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="draw-measure" />
        <text x={mx} y={my - 6} className="draw-label draw-measure-label">
          {st.bars} 根 · {st.pct >= 0 ? "+" : ""}
          {st.pct.toFixed(2)}% · {st.dur}
        </text>
      </g>
    );
  }

  const top = Math.min(d.p1, d.p2);
  const bot = Math.max(d.p1, d.p2);
  const span = bot - top;
  return (
    <g key={d.id}>
      {selected ? (
        <>
          <circle cx={x1} cy={y1} r={5} className="draw-handle" />
          <circle cx={x2} cy={y2} r={5} className="draw-handle" />
        </>
      ) : null}
      {FIB_LEVELS.map((lv) => {
        const price = bot - span * lv;
        const y = coord.priceToY(price);
        if (y == null) return null;
        return (
          <g key={`${d.id}-${lv}`}>
            <line x1={Math.min(x1, x2)} y1={y} x2={Math.max(x1, x2)} y2={y} className="draw-fib" />
            <text x={Math.max(x1, x2) + 4} y={y + 3} className="draw-label draw-fib-label">
              {(lv * 100).toFixed(1)}% · {price.toFixed(2)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface Props {
  drawings: ChartDrawing[];
  preview: ChartDrawing | null;
  selectedId: string | null;
  coord: ChartCoordApi;
  timeframe: Timeframe;
  width: number;
  height: number;
}

export default function ChartDrawingsLayer({
  drawings,
  preview,
  selectedId,
  coord,
  timeframe,
  width,
  height,
}: Props) {
  const all = preview ? [...drawings, preview] : drawings;

  return (
    <svg className="chart-drawings-svg" width={width} height={height} aria-hidden>
      {all.map((d) =>
        renderDrawing(d, coord, timeframe, width, d.id === selectedId && d.id !== "preview"),
      )}
    </svg>
  );
}
