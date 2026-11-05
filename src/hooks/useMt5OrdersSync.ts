import { useEffect, useState } from "react";
import { fetchMt5Orders } from "../api/mt5";
import type { PendingOrder, PendingOrderMode } from "../types";

function mapRow(r: Awaited<ReturnType<typeof fetchMt5Orders>>[number]): PendingOrder {
  return {
    id: `mt5-order-${r.ticket}`,
    ticket: r.ticket,
    side: r.side,
    lots: r.lots,
    entryPrice: r.price,
    sl: r.sl,
    tp: r.tp,
    createdAt: r.setup_time,
    mode: r.mode as PendingOrderMode,
  };
}

export function useMt5OrdersSync(enabled: boolean, symbol: string, tick: number) {
  const [pending, setPending] = useState<PendingOrder[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchMt5Orders(symbol);
        if (!cancelled) setPending(rows.map(mapRow));
      } catch {
        /* keep last */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, symbol, tick]);

  return pending;
}
