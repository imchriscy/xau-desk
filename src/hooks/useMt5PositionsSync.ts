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

export function useMt5PositionsSync(
  enabled: boolean,
  symbol: string | undefined,
  tick: number,
  accountMargin?: number,
) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    let failStreak = 0;
    const load = async () => {
      try {
        let rows = await fetchMt5Positions(symbol || undefined);
        if (accountMargin != null && accountMargin <= 1.5 && rows.length > 0) {
          rows = [];
        }
        if (!cancelled) {
          failStreak = 0;
          setPositions(rows.map(mapRow));
        }
      } catch {
        failStreak += 1;
        if (!cancelled && failStreak >= 2) setPositions([]);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 80);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, symbol, tick, accountMargin]);

  return positions;
}
