import { TF_SECONDS } from "./mockData";
import type { Timeframe } from "./types";

/**
 * 优先用最后一根 K 的开盘 time（与图表一致）；异常时退回墙钟对齐。
 */
export function barRemainingSeconds(
  tf: Timeframe,
  lastBarOpenSec?: number | null,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const step = TF_SECONDS[tf];
  if (lastBarOpenSec != null && lastBarOpenSec > 0) {
    const age = nowSec - lastBarOpenSec;
    if (age >= 0 && age < step * 2) {
      return Math.max(0, lastBarOpenSec + step - nowSec);
    }
  }
  const open = nowSec - (nowSec % step);
  return Math.max(0, open + step - nowSec);
}

export function formatBarCountdown(
  tf: Timeframe,
  rem?: number,
  lastBarOpenSec?: number | null,
): string {
  const sec = rem ?? barRemainingSeconds(tf, lastBarOpenSec);

  if (tf === "1d") {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  if (tf === "4h" || tf === "1h") {
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
  }

  if (sec >= 86400) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return `${d}d ${h}h`;
  }

  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
