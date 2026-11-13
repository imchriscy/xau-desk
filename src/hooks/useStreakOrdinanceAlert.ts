import { useEffect, useRef, useState } from "react";
import type { RiskStatusDto } from "../api/risk";
import type { StreakAlertTier } from "../components/StreakOrdinanceModal";

export interface StreakOrdinanceAlertState {
  open: boolean;
  tier: StreakAlertTier;
  consecutiveLosses: number;
  pauseMinutes: number;
  dismiss: () => void;
}

/**
 * 连亏数越过 tier1 / tier2 阈值时弹窗（每档每 session 可关；数清零后重置，可再次弹出）。
 */
export function useStreakOrdinanceAlert(status: RiskStatusDto | null): StreakOrdinanceAlertState {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<StreakAlertTier>("tier1");
  const [snapshot, setSnapshot] = useState({ n: 0, pause: 30 });

  const prevNRef = useRef(0);
  const firedTierRef = useRef<{ t1: boolean; t2: boolean }>({ t1: false, t2: false });
  const initedRef = useRef(false);

  useEffect(() => {
    if (!status) return;

    const n = status.consecutive_losses ?? status.streak_sync?.consecutive_losses ?? 0;
    const t1 = status.config.streak_tier1_losses ?? 3;
    const t2 = status.config.streak_tier2_losses ?? 5;
    const m1 = status.config.streak_tier1_pause_minutes ?? 30;
    const m2 = status.config.streak_tier2_pause_minutes ?? 180;

    if (n === 0) {
      firedTierRef.current = { t1: false, t2: false };
      prevNRef.current = 0;
      initedRef.current = false;
      return;
    }

    if (!initedRef.current) {
      initedRef.current = true;
      prevNRef.current = n;
      if (n >= t2) firedTierRef.current = { t1: true, t2: true };
      else if (n >= t1) firedTierRef.current = { t1: true, t2: false };
      return;
    }

    const prev = prevNRef.current;
    const crossT2 = prev < t2 && n >= t2;
    const crossT1 = prev < t1 && n >= t1;

    if (crossT2 && !firedTierRef.current.t2) {
      firedTierRef.current = { t1: true, t2: true };
      setTier("tier2");
      setSnapshot({ n, pause: m2 });
      setOpen(true);
    } else if (crossT1 && !firedTierRef.current.t1) {
      firedTierRef.current.t1 = true;
      setTier("tier1");
      setSnapshot({ n, pause: m1 });
      setOpen(true);
    }

    prevNRef.current = n;
  }, [status]);

  const dismiss = () => setOpen(false);

  return {
    open,
    tier,
    consecutiveLosses: snapshot.n,
    pauseMinutes: snapshot.pause,
    dismiss,
  };
}
