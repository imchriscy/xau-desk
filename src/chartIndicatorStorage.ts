import type { ChartDrawing, ChartIndicatorInst } from "./types";

const KEY = "ming-win-trade-chart-v1";

export interface StoredChartUi {
  indicators: ChartIndicatorInst[];
  drawings: ChartDrawing[];
}

export function loadStoredChartUi(): StoredChartUi {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { indicators: [], drawings: [] };
    const j = JSON.parse(raw) as StoredChartUi;
    return {
      indicators: Array.isArray(j.indicators) ? j.indicators : [],
      drawings: Array.isArray(j.drawings) ? j.drawings : [],
    };
  } catch {
    return { indicators: [], drawings: [] };
  }
}

export function saveStoredChartUi(data: StoredChartUi): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}
