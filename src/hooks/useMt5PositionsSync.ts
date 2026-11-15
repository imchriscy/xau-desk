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

export function useMt5PositionsSync(enabled: boolean, symbol: string | undefined, tick: number) {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMt5Positions(symbol || undefined);
        if (!cancelled) setPositions(rows.map(mapRow));
      } catch {
        /* keep last */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 80);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, symbol, tick]);

  return positions;
}
