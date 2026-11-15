import fs from "node:fs";
import path from "node:path";
import { bridgeDir } from "./resolve-bridge-dir.mjs";
import { listBridgeCandidateDirs } from "./bridge-discover.mjs";

export const LATENCY_LOG = "xau_latency.jsonl";

/** 默认关闭；压测时设 XAU_LATENCY_TRACE=1 */
export function latencyTraceEnabled() {
  return process.env.XAU_LATENCY_TRACE === "1";
}

function logPaths() {
  const dirs = new Set([bridgeDir(), ...listBridgeCandidateDirs()]);
  return [...dirs].map((d) => path.join(d, LATENCY_LOG));
}

export function appendLatencyRecord(record) {
  if (!latencyTraceEnabled()) return;
  const line = `${JSON.stringify({ ...record, t_wall_ms: record.t_wall_ms ?? Date.now() })}\n`;
  for (const p of logPaths()) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, line, "utf8");
    } catch {
      /* */
    }
  }
}

export function readLatencyLog({ tail = 80 } = {}) {
  const p = path.join(bridgeDir(), LATENCY_LOG);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-tail).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}