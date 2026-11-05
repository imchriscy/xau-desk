import { useEffect, useState } from "react";
import { formatBarCountdown } from "../chartBarCountdown";
import type { Timeframe } from "../types";

interface Props {
  timeframe: Timeframe;
  lastBarOpenSec: number | null;
}

/** 独立秒针，避免拖动图表时因父组件每秒 setState 导致持仓标签抖动 */
export default function ChartBarCountdown({ timeframe, lastBarOpenSec }: Props) {
  const [text, setText] = useState(() => formatBarCountdown(timeframe, undefined, lastBarOpenSec));

  useEffect(() => {
    const tick = () => setText(formatBarCountdown(timeframe, undefined, lastBarOpenSec));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeframe, lastBarOpenSec]);

  return (
    <div className="chart-bar-countdown">
      {text}
    </div>
  );
}
