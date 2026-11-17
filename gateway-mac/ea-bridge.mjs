import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ACK_FILE,
  CMD_FILE,
  STATE_FILE,
  bridgeDir,
  rescanBridgeDir,
} from "./resolve-bridge-dir.mjs";
import { listBridgeCandidateDirs } from "./bridge-discover.mjs";
import { readStateJsonFile, stateFileStalenessMs } from "./read-state-json.mjs";
import { appendLatencyRecord, latencyTraceEnabled } from "./latency-trace.mjs";

const RPC_TIMEOUT_MS = Number(process.env.XAU_RPC_TIMEOUT_MS || 8000);
const RPC_POLL_MS = Number(process.env.XAU_RPC_POLL_MS || 25);
const STATE_FRESH_MS = Number(process.env.XAU_STATE_FRESH_MS || 90_000);

function filePath(name) {
  return path.join(bridgeDir(), name);
}

function readBinStateInDir(dir) {
  const bf = path.join(dir, "xau_state.bin");
  if (!fs.existsSync(bf)) return null;
  try {
    const buf = fs.readFileSync(bf);
    if (buf.length < 128 || buf.subarray(0, 4).toString("ascii") !== "XAU1") return null;
    const tsSec = buf.readDoubleLE(8);
    const symbol = buf.toString("utf8", 16, 32).replace(/\0.*$/, "");
    const bid = buf.readDoubleLE(32);
    const ask = buf.readDoubleLE(40);
    const login = Number(buf.readBigInt64LE(52));
    const equity = buf.readDoubleLE(60);
    const balance = buf.readDoubleLE(68);
    const last = (bid + ask) / 2;
    const staleMs = stateFileStalenessMs(bf, tsSec);
    return {
      connected: staleMs < STATE_FRESH_MS,
      ts: tsSec,
      symbol,
      terminal: "XauDeskExec",
      quote: { symbol, bid, ask, last, time: Math.floor(tsSec), mt5_ms: 0.1 },
      account: {
        login,
        server: "",
        name: "",
        currency: "USD",
        balance,
        equity,
        margin: 0,
        margin_free: 0,
        profit: 0,
        leverage: 100,
        account_kind: "real",
        account_kind_label: "实盘",
        trade_allowed: true,
        trade_expert: true,
        terminal_trade_allowed: true,
      },
      positions: [],
      orders: [],
      risk: { require_stop_loss: true, halted: false },
      _path: bf,
      _source: "bin",
      state_age_ms: staleMs,
    };
  } catch {
    return null;
  }
}

function readStateFromPath(jf) {
  const j = readStateJsonFile(jf);
  const staleMs = stateFileStalenessMs(jf, j?.ts);
  return {
    ...j,
    connected: staleMs < STATE_FRESH_MS && Boolean(j.connected ?? true),
    state_age_ms: staleMs,
    _path: jf,
    _source: "json",
    bridge_session:
      j.bridge_session ||
      (j.account?.login
        ? `${j.account.login}@${String(j.account.server || "").trim()}`
        : undefined),
  };
}

/** 扫描全部 Wine Common/Files，取最新 state（休市也会写账户快照）。 */
export function readState() {
  let best = null;
  let bestStale = Infinity;
  const dirs = listBridgeCandidateDirs();
  for (const dir of dirs) {
    const jf = path.join(dir, STATE_FILE);
    if (!fs.existsSync(jf)) continue;
    try {
      const staleMs = stateFileStalenessMs(jf, readStateJsonFile(jf)?.ts);
      if (staleMs < bestStale) {
        bestStale = staleMs;
        best = readStateFromPath(jf);
      }
    } catch {
      /* try bin */
      const bin = readBinStateInDir(dir);
      if (bin && (bin.state_age_ms ?? Infinity) < bestStale) {
        bestStale = bin.state_age_ms;
        best = bin;
      }
    }
  }

  if (best) {
    const primaryDir = bridgeDir();
    const bestDir = path.dirname(best._path);
    if (bestDir !== primaryDir && bestStale < (best.connected ? STATE_FRESH_MS : 600_000)) {
      rescanBridgeDir();
    }
    if (!best.connected && best.account?.login > 0 && bestStale < 600_000) {
      best.hint =
        "与开盘无关：XauDeskBridge 未在写文件。请开启算法交易，或在设置里点「修复 MT5 连接」。";
    }
    return best;
  }

  for (const dir of dirs) {
    const bin = readBinStateInDir(dir);
    if (bin) return bin;
  }

  const rescanned = rescanBridgeDir();
  if (rescanned.changed) return readState();

  return {
    connected: false,
    error:
      "EA 未连接：XauDesk 会自动挂载 XauDeskBridge；请保持 MT5 登录并开启算法交易（与是否开盘无关）",
    bridge_dir: bridgeDir(),
  };
}

export function stateAgeMs(state) {
  if (state?.state_age_ms != null) return Number(state.state_age_ms);
  if (!state?._path || !state?.ts) return null;
  try {
    return stateFileStalenessMs(state._path, state.ts);
  } catch {
    return null;
  }
}

function stateFresh(state) {
  const age = stateAgeMs(state);
  if (age == null) return false;
  return age < STATE_FRESH_MS;
}

export function eaOnline() {
  const s = readState();
  if (!stateFresh(s)) return false;
  const login = Number(s.account?.login || 0);
  const bid = Number(s.quote?.bid || 0);
  return Boolean(s.connected && (login > 0 || bid > 0));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcFile(payload, cmdName, ackName, timeoutMs) {
  const id = randomUUID();
  const trace_id = payload.trace_id || id;
  const gw_t_recv_ms = Date.now();
  const gw_hr0 = process.hrtime.bigint();
  const cmd = {
    id,
    trace_id,
    ...payload,
    gw_t_recv_ms,
    gw_hr0: gw_hr0.toString(),
  };
  const cmdPath = filePath(cmdName);
  const ackPath = filePath(ackName);

  if (fs.existsSync(ackPath)) {
    try {
      fs.unlinkSync(ackPath);
    } catch {
      /* stale */
    }
  }

  const gw_t_cmd_write_ms = Date.now();
  cmd.gw_t_cmd_write_ms = gw_t_cmd_write_ms;
  fs.writeFileSync(cmdPath, JSON.stringify(cmd), "utf8");

  if (latencyTraceEnabled() && cmdName.includes("trade")) {
    appendLatencyRecord({
      trace_id,
      stage: "gw_cmd_written",
      op: payload.op,
      id,
      ui_t0_ms: payload.ui_t0_ms,
      gw_t_recv_ms,
      gw_t_cmd_write_ms,
      gw_write_us: Number(process.hrtime.bigint() - gw_hr0) / 1000,
    });
  }

  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  while (Date.now() < deadline) {
    polls += 1;
    if (fs.existsSync(ackPath)) {
      try {
        const ack = JSON.parse(fs.readFileSync(ackPath, "utf8"));
        if (ack.id === id) {
          fs.unlinkSync(ackPath);
          const gw_t_ack_ms = Date.now();
          const gw_ack_us = Number(process.hrtime.bigint() - gw_hr0) / 1000;
          if (latencyTraceEnabled() && cmdName.includes("trade")) {
            appendLatencyRecord({
              trace_id,
              stage: "gw_ack",
              op: payload.op,
              id,
              gw_t_ack_ms,
              gw_ack_us,
              gw_polls: polls,
              ui_t0_ms: payload.ui_t0_ms,
              ok: ack.ok,
            });
          }
          const _latency = latencyTraceEnabled()
            ? { trace_id, gw_t_recv_ms, gw_t_cmd_write_ms, gw_t_ack_ms, gw_polls: polls, gw_ack_us }
            : undefined;
          return { ...ack, _latency };
        }
      } catch {
        /* partial write */
      }
    }
    await sleep(RPC_POLL_MS);
  }
  throw new Error("EA 响应超时：确认 EA 已运行且允许算法交易");
}

export function rpcToEa(payload) {
  return rpcFile(payload, CMD_FILE, ACK_FILE, RPC_TIMEOUT_MS);
}

const SNAP_MIN_MS = Number(process.env.XAU_SNAPSHOT_MIN_MS || 55);
const SNAP_CACHE_MS = 120;
let snapChain = Promise.resolve();
/** @type {{ at: number, data: Record<string, unknown> | null }} */
let snapCache = { at: 0, data: null };

/** 走 xau_cmd 让 EA 现场枚举持仓（含历史校验），避免只读陈旧 xau_state.json */
export function fetchLiveSnapshot() {
  const now = Date.now();
  if (snapCache.data && now - snapCache.at < SNAP_CACHE_MS) {
    return Promise.resolve(snapCache.data);
  }
  const run = snapChain.then(async () => {
    if (snapCache.data && Date.now() - snapCache.at < SNAP_MIN_MS) {
      return snapCache.data;
    }
    try {
      const ack = await rpcFile({ op: "snapshot" }, CMD_FILE, ACK_FILE, 3500);
      if (ack?.ok && ack.result) {
        snapCache = { at: Date.now(), data: ack.result };
        return ack.result;
      }
    } catch {
      /* EA 忙或超时 */
    }
    return snapCache.data;
  });
  snapChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let tradeChain = Promise.resolve();

/** 下单/平仓专用文件，不和 K 线抢 xau_cmd.json。 */
export function rpcTrade(payload) {
  const once = () => rpcFile(payload, "xau_trade.json", "xau_trade_ack.json", 4000);
  const run = tradeChain.then(async () => {
    try {
      return await once();
    } catch (e) {
      return await once();
    }
  });
  tradeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function readFastQuote() {
  const p = path.join(bridgeDir(), "xau_quote.txt");
  try {
    const age = Date.now() - fs.statSync(p).mtimeMs;
    const maxAge = Number(process.env.XAU_QUOTE_MAX_AGE_MS || 250);
    if (age > maxAge) {
      const st = readState();
      if (stateFresh(st) && st.quote && Number(st.quote.bid) > 0) {
        return { ...st.quote, age_ms: st.state_age_ms ?? age, from_state: true };
      }
      return null;
    }
    const [bidS, askS, symbol] = fs.readFileSync(p, "utf8").trim().split(",");
    const bid = Number(bidS);
    const ask = Number(askS);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0) return null;
    return {
      symbol: symbol || "",
      bid,
      ask,
      last: bid,
      time: Math.floor(Date.now() / 1000),
      mt5_ms: 0.1,
      age_ms: age,
    };
  } catch {
    return null;
  }
}
