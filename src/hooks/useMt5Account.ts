import { useCallback, useEffect, useState } from "react";
import { fetchAccount, type Mt5AccountSnapshot } from "../api/mt5";

export function useMt5Account(refreshKey = 0) {
  const [account, setAccount] = useState<Mt5AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const a = await fetchAccount();
      setAccount(a);
      setError(null);
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("404")) {
        msg = "网关 404：请运行 restart-backend.cmd（需版本 0.3-risk-chart，含 /api/account/detect）";
      }
      setError(msg);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 2500);
    return () => clearInterval(id);
  }, [reload, refreshKey]);

  return { account, error, reload };
}
