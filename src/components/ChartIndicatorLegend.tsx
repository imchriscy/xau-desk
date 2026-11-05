import { useState } from "react";
import { tfLabel } from "../mockData";
import type { ChartIndicatorInst, ChartIndicatorType, Timeframe } from "../types";

interface Props {
  displayTimeframe: Timeframe;
  indicators: ChartIndicatorInst[];
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (type: ChartIndicatorType) => void;
  onUpdate: (id: string, patch: Partial<Pick<ChartIndicatorInst, "length" | "bbMult">>) => void;
}

function label(ind: ChartIndicatorInst): string {
  const tf = tfLabel(ind.sourceTimeframe);
  if (ind.type === "vol") return `成交量 · ${tf}`;
  if (ind.type === "ma") return `MA(${ind.length}) · ${tf}`;
  return `BB(${ind.length}, ${ind.bbMult ?? 2}) · ${tf}`;
}

function parsePositiveInt(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 500 ? n : fallback;
}

function parsePositiveFloat(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : fallback;
}

export default function ChartIndicatorLegend({
  displayTimeframe,
  indicators,
  onToggleVisible,
  onRemove,
  onAdd,
  onUpdate,
}: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`chart-indicator-legend ${collapsed ? "collapsed" : ""}`}>
      <div className="chart-indicator-head">
        <button type="button" className="ind-collapse-btn" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="chart-indicator-title">指标</span>
        {!collapsed ? (
          <>
            <span className="field-micro">@{tfLabel(displayTimeframe)}</span>
            <button type="button" className="link-btn" onClick={() => onAdd("ma")}>
              + MA
            </button>
            <button type="button" className="link-btn" onClick={() => onAdd("bb")}>
              + BB
            </button>
          </>
        ) : null}
      </div>
      {collapsed ? null : indicators.length === 0 ? (
        <span className="chart-indicator-empty">点击 + MA / + BB 添加</span>
      ) : (
        <ul className="chart-indicator-list">
          {indicators.map((ind) => {
            const editing = editId === ind.id;
            return (
              <li key={ind.id} className={editing ? "ind-editing" : ""}>
                <button
                  type="button"
                  className={`ind-eye ${ind.visible ? "on" : "off"}`}
                  title={ind.visible ? "隐藏" : "显示"}
                  onClick={() => onToggleVisible(ind.id)}
                >
                  {ind.visible ? "👁" : "◌"}
                </button>
                <button
                  type="button"
                  className={`ind-name ind-${ind.type} ind-name-btn`}
                  title="点击编辑周期参数"
                  onClick={() => setEditId(editing ? null : ind.id)}
                >
                  {label(ind)}
                </button>
                {ind.type !== "vol" ? (
                  <button type="button" className="link-btn ind-del" onClick={() => onRemove(ind.id)}>
                    ×
                  </button>
                ) : null}
                {editing && ind.type !== "vol" ? (
                  <div className="ind-params-row">
                    <label>
                      周期
                      <input
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        key={`len-${ind.id}-${ind.length}`}
                        defaultValue={ind.length}
                        onBlur={(e) =>
                          onUpdate(ind.id, { length: parsePositiveInt(e.target.value, ind.length) })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </label>
                    {ind.type === "bb" ? (
                      <label>
                        σ
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.1}
                          key={`sig-${ind.id}-${ind.bbMult}`}
                          defaultValue={ind.bbMult ?? 2}
                          onBlur={(e) =>
                            onUpdate(ind.id, {
                              bbMult: parsePositiveFloat(e.target.value, ind.bbMult ?? 2),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
