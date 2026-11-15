#!/usr/bin/env node
/**
 * 合并 xau_latency.jsonl，按 trace_id 输出开/平仓分段延迟（微秒/毫秒）。
 * 用法：node scripts/analyze-latency.mjs [tail行数，默认 500]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tail = Math.max(50, Number(process.argv[2] || 500));

import { execSync } from "node:child_process";
const logPath = path.join(
  execSync(`node "${path.join(ROOT, "scripts/print-active-bridge-dir.mjs")}"`, { encoding: "utf8" }).trim(),
  "xau_latency.jsonl",
);

if (!fs.existsSync(logPath)) {
  console.error("未找到", logPath, "— 请先编译 1.018 EA、重启 MT5，并在 XauDesk 下单");
  process.exit(1);
}

const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).slice(-tail);
const events = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

const byTrace = new Map();
for (const e of events) {
  const id = e.trace_id;
  if (!id || id === "-") continue;
  if (!byTrace.has(id)) byTrace.set(id, []);
  byTrace.get(id).push(e);
}

function pickStage(list, stage) {
  return list.find((x) => x.stage === stage);
}

const rows = [];
for (const [trace_id, list] of byTrace) {
  const op = list.find((x) => x.op)?.op ?? "?";
  const gwWrite = pickStage(list, "gw_cmd_written");
  const gwAck = pickStage(list, "gw_ack");
  const eaRead = pickStage(list, "ea_trade_file_read");
  const eaBefore = pickStage(list, "ea_ordersend_before");
  const eaAfter = pickStage(list, "ea_ordersend_after");
  const ui0 = gwWrite?.ui_t0_ms ?? gwAck?.ui_t0_ms;

  const clickToCmd =
    gwWrite && Number.isFinite(ui0) ? gwWrite.gw_t_cmd_write_ms - ui0 : null;
  const clickToAck =
    gwAck && Number.isFinite(ui0) ? gwAck.gw_t_ack_ms - ui0 : null;
  const cmdToAck = gwWrite && gwAck ? gwAck.gw_t_ack_ms - gwWrite.gw_t_cmd_write_ms : null;
  const eaQueueUs =
    eaRead && eaBefore && eaBefore.ea_us >= eaRead.ea_us ? eaBefore.ea_us - eaRead.ea_us : null;
  const ordersendUs =
    eaBefore && eaAfter && eaAfter.ea_us >= eaBefore.ea_us ? eaAfter.ea_us - eaBefore.ea_us : null;
  const cmdToEaReadMs =
    eaRead && gwWrite?.gw_t_cmd_write_ms
      ? eaRead.ea_local_ms - gwWrite.gw_t_cmd_write_ms
      : null;

  rows.push({
    trace_id: trace_id.slice(0, 8),
    op,
    clickToCmd,
    cmdToEaReadMs,
    eaQueueUs,
    ordersendUs,
    cmdToAck,
    clickToAck,
    polls: gwAck?.gw_polls,
  });
}

rows.sort((a, b) => (b.clickToAck ?? 0) - (a.clickToAck ?? 0));

console.log(`\n延迟分析（${rows.length} 笔 trace，日志 ${logPath}）\n`);
console.log(
  "trace    op       UI→写盘  写盘→EA读  EA排队μs  OrderSendμs  写盘→ack  UI→ack  polls",
);
for (const r of rows.slice(-30)) {
  const fmt = (n, d = 1) => (n == null ? "   —" : `${n.toFixed(d).padStart(6)}`);
  const fmtUs = (n) => (n == null ? "      —" : `${Math.round(n).toString().padStart(7)}`);
  console.log(
    `${r.trace_id}  ${r.op.padEnd(7)} ${fmt(r.clickToCmd)}ms ${fmt(r.cmdToEaReadMs)}ms ${fmtUs(r.eaQueueUs)}μs ${fmtUs(r.ordersendUs)}μs ${fmt(r.cmdToAck)}ms ${fmt(r.clickToAck)}ms ${r.polls ?? "—"}`,
  );
}

const markets = rows.filter((r) => r.op === "market" && r.clickToAck != null);
const closes = rows.filter((r) => r.op === "close" && r.clickToAck != null);
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.floor(s.length / 2)];
}
if (markets.length) {
  console.log(
    `\n市价单 UI→ack：中位 ${median(markets.map((r) => r.clickToAck))?.toFixed(1)}ms，` +
      `n=${markets.length}；OrderSend 中位 ${median(markets.map((r) => r.ordersendUs).filter(Boolean))}μs`,
  );
}
if (closes.length) {
  console.log(
    `平仓 UI→ack：中位 ${median(closes.map((r) => r.clickToAck))?.toFixed(1)}ms，n=${closes.length}`,
  );
}
console.log(
  "\n说明：EA排队/OrderSend 用 GetMicrosecondCount()，与 UI 墙钟对齐有 ±数百 ms 误差属正常；\n" +
    "      「写盘→EA读」受 Wine 定时器(16ms)主导；「UI→ack」含网关 25ms 轮询。\n",
);