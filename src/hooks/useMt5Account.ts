import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoAttachMt5Bridge,
  detectMt5Account,
  fetchMt5Status,
  rescanMt5Bridge,
  type Mt5AccountSnapshot,
} from "../api/mt5";
import { brokerSessionKey } from "../lib/goldSymbol";

const POLL_MS = 800;
const STALE_MS = 25_000;
const RESCAN_WHEN_OFFLINE_MS = 5_000;

export function useMt5Account(
  refreshKey = 0,
  onSessionChange?: (session: string, prev: string | null) => void,
) {
  const [account, setAccount] = useState<Mt5AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMeta, setStatusMeta] = useState<{
    symbol?: string;
    state_age_ms?: number | null;
    bridge_dir?: string;
  } | null>(null);
  const prevSessionRef = useRef<string | null>(null);
  const fingerprintRef = useRef<string | null>(null);
  const lastAutoAttachAt = useRef(0);

  const reload = useCallback(async () => {
    try {
      const status = await fetchMt5Status();
      setStatusMeta({
        symbol: status.symbol,
        state_age_ms: status.state_age_ms,
        bridge_dir: (status as { bridge_dir?: string }).bridge_dir,
      });

      if (!status.connected) {
        const age = status.state_age_ms ?? null;
        const staleMsg =
          age != null && age > STALE_MS
            ? `MT5 桥接未刷新（${Math.round(age / 1000)}s，与休市无关）：请确认算法交易为绿色，或在设置里点「修复 MT5 连接」`
            : status.error ?? "MT5 未连接：请打开 MT5 并开启算法交易";
        setAccount(null);
        setError(staleMsg);
        prevSessionRef.current = null;
        fingerprintRef.current = null;
        const shortGap = status.stale_login != null && age != null && age < 180_000;
        const attachCooldownMs = 120_000;
        if (
          !shortGap &&
          Date.now() - lastAutoAttachAt.current > attachCooldownMs
        ) {
          lastAutoAttachAt.current = Date.now();
          void autoAttachMt5Bridge().catch(() => undefined);
        }
        return;
      }
      lastAutoAttachAt.current = 0;

      const a = await detectMt5Account();
      const session = brokerSessionKey(a.login, a.server);
      const fingerprint = `${session}|${a.balance.toFixed(2)}|${a.equity.toFixed(2)}`;

      if (
        session &&
        prevSessionRef.current != null &&
        prevSessionRef.current !== session
      ) {
        onSessionChange?.(session, prevSessionRef.current);
      } else if (fingerprintRef.current != null && fingerprintRef.current !== fingerprint && session) {
        const prevKey = fingerprintRef.current.split("|")[0] || null;
        if (prevKey && prevKey !== session) {
          onSessionChange?.(session, prevKey);
        }
      }

      if (session) prevSessionRef.current = session;
      fingerprintRef.current = fingerprint;

      setAccount(a);
      setError(null);
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("404")) {
        msg = "网关 404：请运行 restart-backend.cmd（需版本 0.3-risk-chart，含 /api/account/detect）";
      }
      setAccount(null);
      setError(msg);
      prevSessionRef.current = null;
    }
  }, [onSessionChange]);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (account != null) return;
      void rescanMt5Bridge()
        .then(() => reload())
        .catch(() => reload());
    }, RESCAN_WHEN_OFFLINE_MS);
    return () => clearInterval(id);
  }, [account, reload]);

  return { account, error, reload, statusMeta };
}
