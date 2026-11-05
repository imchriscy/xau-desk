import { useCallback, useEffect, useState } from "react";
import { fetchRiskStatus, type RiskStatusDto } from "../api/risk";

export function useRiskStatus(enabled: boolean, accountLogin: number | null | undefined) {
  const [status, setStatus] = useState<RiskStatusDto | null>(null);

  const reload = useCallback(async () => {
    if (accountLogin == null) return;
    try {
      const st = await fetchRiskStatus();
      if (st.account_login != null && st.account_login !== accountLogin) return;
      setStatus(st);
    } catch {
      /* gateway old version */
    }
  }, [accountLogin]);

  useEffect(() => {
    setStatus(null);
    if (!enabled || accountLogin == null) {
      return;
    }
    void reload();
    const id = window.setInterval(() => void reload(), 3000);
    return () => clearInterval(id);
  }, [enabled, accountLogin, reload]);

  return { status, reload };
}
