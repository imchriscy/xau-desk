#!/usr/bin/env node
/** 实时 tail xau_latency.jsonl，便于你去 XauDesk 连点 B/X 时看事件 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = execSync(`node "${path.join(ROOT, "scripts/print-active-bridge-dir.mjs")}"`, { encoding: "utf8" }).trim();
const logPath = path.join(dir, "xau_latency.jsonl");

console.log("监视", logPath);
console.log("请在 XauDesk 连开 BTC 并平仓；Ctrl+C 结束，之后运行: node scripts/analyze-latency.mjs\n");

let pos = 0;
if (fs.existsSync(logPath)) {
  pos = fs.statSync(logPath).size;
}

setInterval(() => {
  if (!fs.existsSync(logPath)) return;
  const st = fs.statSync(logPath);
  if (st.size <= pos) return;
  const chunk = fs.readFileSync(logPath, "utf8", { start: Math.max(0, pos - 1) });
  pos = st.size;
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const tag = j.stage?.padEnd(22) ?? "";
      const op = j.op ? ` ${j.op}` : "";
      const extra = [
        j.ea_us != null ? `ea_us=${j.ea_us}` : "",
        j.gw_t_cmd_write_ms != null ? `gw_w=${j.gw_t_cmd_write_ms}` : "",
        j.gw_polls != null ? `polls=${j.gw_polls}` : "",
        j.ui_t0_ms != null ? `ui0=${j.ui_t0_ms.toFixed?.(1) ?? j.ui_t0_ms}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`${new Date().toISOString()}  ${tag}${op}  trace=${(j.trace_id || "").slice(0, 8)}  ${extra}`);
    } catch {
      console.log(line);
    }
  }
}, 200);