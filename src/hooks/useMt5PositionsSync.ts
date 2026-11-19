import { useEffect, useState } from "react";
import { fetchMt5Positions } from "../api/mt5";
import type { Position } from "../types";

function mapRow(r: Awaited<ReturnType<typeof fetchMt5Positions>>[number]): Position {
  return {
    id: `mt5-${r.ticket}`,
    ticket: r.ticket,
    side: r.side,
    lots: r.lots,
    openPrice: r.open_price,
    sl: r.sl,
    tp: r.tp,
    openTime: r.open_time,
    profitUsd: r.profit,
    symbol: r.symbol,
  };
}

/** 只上报非空持仓；空响应不覆盖，避免网关/snapshot 竞态导致 UI 闪空 */
export function useMt5PositionsSync(enabled: boolean, symbol: string | undefined, tick: number) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMt5Positions(symbol || undefined, { snapshot: false });
        if (cancelled || rows.length === 0) return;
        setPositions((prev) => {
          const map = new Map(prev.map((p) => [p.ticket, p]));
          for (const r of rows) map.set(r.ticket, mapRow(r));
          return [...map.values()];
        });
      } catch {
        /* 保留上一轮 */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 120);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, symbol, tick]);

  return positions;
}