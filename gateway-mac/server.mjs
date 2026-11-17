#!/usr/bin/env node
/**
 * macOS / 可移植：Node HTTP 网关（5191），API 与 serve_mt5.py 对齐。
 * 执行层：XauDeskExec EA · 下单走 TCP :5192 快通道；状态 xau_state.bin
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import {
  eaOnline,
  fetchLiveSnapshot,
  readFastQuote,
  readState,
  rpcToEa,
  rpcTrade,
  stateAgeMs,
} from "./ea-bridge.mjs";
import { REQUIRED_BRIDGE_VER, bridgeVerAtLeast } from "./bridge-version.mjs";
import { ensureMt5Bridge } from "./ensure-mt5-bridge.mjs";
import { detectActiveWineUser, mt5ProcessLikelyRunning } from "./wine-profile.mjs";
import { bridgeDir, rescanBridgeDir } from "./resolve-bridge-dir.mjs";
import { positionMatchesSymbol, symbolsMatch } from "./gold-symbol.mjs";
import {
  INSTRUMENTS,
  brokerCandidatesForInstrument,
  readActiveInstrumentId,
  readSymbolMap,
  writeActiveInstrumentId,
} from "./active-symbol.mjs";
import { latencyTraceEnabled, readLatencyLog } from "./latency-trace.mjs";
import {
  buildMacRiskStatus,
  confirmBaseline,
  ingestCloseDeal,
  resyncStreakFromJournal,
  saveRiskConfig,
  watchPositionsForStreak,
} from "./risk-mac.mjs";
import {
  closeFastLane,
  marketFastLane,
  modifyFastLane,
  pendingFastLane,
} from "./fast-lane.mjs";

const HOST = process.env.XAU_GATEWAY_HOST || "127.0.0.1";
const PORT = Number(process.env.XAU_GATEWAY_PORT || 5191);
const VERSION = "0.2.0-mql-exec";

const barsCache = new Map();
function barsCacheKey(tf, symbol) {
  return `${symbol || "default"}:${tf}`;
}
function resolveTradeSymbol(st, url) {
  const q = url.searchParams.get("symbol");
  if (q) return q;
  return st?.symbol || "";
}
const BARS_CACHE_MS = 1500;

const BAR_COUNTS = {
  "1m": 2500,
  "3m": 1800,
  "5m": 1500,
  "15m": 1000,
  "30m": 800,
  "1h": 700,
  "4h": 500,
  "1d": 400,
};

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function formatEaOfflineDetail(st) {
  const ageMs = stateAgeMs(st);
  const ageSec = ageMs != null ? Math.round(ageMs / 1000) : null;
  if (st?._path && st?.account?.login) {
    if (ageSec != null && ageSec < 180) {
      return (
        `MT5 状态短暂中断（${ageSec}s 未刷新）。账户仍是 #${st.account.login} @ ${st.account.server || "?"} / ${st.symbol || "?"}。` +
        `常见于正在拉取 K 线，或 MT5 刚重启；不必重新挂 EA。算法交易保持绿色即可。`
      );
    }
    return (
      `MT5 Bridge 已 ${ageSec ?? "?"}s 未更新（与是否开盘无关）。上次账户 #${st.account.login} @ ${st.account.server || "?"} / ${st.symbol || "?"}。` +
      `请确认 MT5 已登录、算法交易为绿色；XauDesk 可自动挂 XauDeskBridge。`
    );
  }
  return (
    "MT5 Bridge 未连接：导航器 → XauDeskBridge → 拖到黄金图（XAUUSD / XAUUSDm / XAUUSDx），" +
    "并开启算法交易。首次可运行 scripts/mt5-autoload-ea.sh"
  );
}

/** Wine 终端常滞后写 positions[]；保证金已释放时按空仓返回（手机/外部平仓） */
function reconcilePositionsWithMargin(st, positions) {
  const rows = Array.isArray(positions) ? positions : [];
  if (rows.length === 0) return rows;
  const margin = Number(st?.account?.margin);
  if (!Number.isFinite(margin)) return rows;
  if (margin <= 1.5) return [];
  return rows;
}

function requireEa(res) {
  const st = readState();
  if (!eaOnline()) {
    json(res, 503, {
      detail: st.error || formatEaOfflineDetail(st),
      bridge_dir: bridgeDir(),
      state_age_ms: stateAgeMs(st),
      stale_login: st.account?.login,
      stale_server: st.account?.server,
    });
    return null;
  }
  return st;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && path === "/api/health") {
      json(res, 200, { ok: true, service: "mt5-gateway", version: VERSION, backend: "mql5-mac" });
      return;
    }

    if (req.method === "GET" && path === "/api/version") {
      json(res, 200, {
        version: VERSION,
        features: ["account", "detect", "quote", "bars", "positions", "orders", "risk", "order"],
        bridge_dir: bridgeDir(),
        ea_online: eaOnline(),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/mt5/status") {
      const st = readState();
      const online = eaOnline();
      json(res, 200, {
        connected: online,
        symbol: online ? st.symbol : undefined,
        login: online ? st.account?.login : undefined,
        server: online ? st.account?.server : undefined,
        terminal: st.terminal,
        trade_allowed: st.trade_allowed,
        error: online ? undefined : st.error || formatEaOfflineDetail(st),
        state_age_ms: stateAgeMs(st),
        account_ts: st.ts,
        bridge_dir: bridgeDir(),
        bridge_session: online ? st.bridge_session : undefined,
        bridge_ver: st.bridge_ver,
        bridge_ver_required: REQUIRED_BRIDGE_VER,
        bridge_ver_ok: bridgeVerAtLeast(st.bridge_ver),
        active_instrument: st.active_instrument,
        state_path: st._path,
        stale_login: online ? undefined : st.account?.login,
        stale_server: online ? undefined : st.account?.server,
        wine_user: detectActiveWineUser().wineUser,
        mt5_running: mt5ProcessLikelyRunning(),
        offline_hint: st.hint,
      });
      return;
    }

    if (req.method === "POST" && path === "/api/mt5/auto-attach") {
      let force = url.searchParams.get("force") === "1";
      if (!force) {
        try {
          const body = await readBody(req);
          if (body?.force === true) force = true;
        } catch {
          /* empty body */
        }
      }
      const st = readState();
      const needEa = eaOnline() && !bridgeVerAtLeast(st.bridge_ver);
      const r = await ensureMt5Bridge({ force: force || needEa });
      json(res, 200, r);
      return;
    }

    if (req.method === "POST" && path === "/api/bridge/rescan") {
      const r = rescanBridgeDir();
      const st = readState();
      json(res, 200, {
        ok: true,
        changed: r.changed,
        bridge_dir: r.dir,
        prev: r.prev,
        connected: eaOnline(),
        login: st.account?.login,
        server: st.account?.server,
        state_age_ms: stateAgeMs(st),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/ping") {
      const t0 = performance.now();
      const st = requireEa(res);
      if (!st) return;
      const server_ms = performance.now() - t0;
      json(res, 200, {
        ok: true,
        symbol: st.symbol,
        mt5_ms: st.quote?.mt5_ms ?? 0,
        server_ms: Math.round(server_ms * 100) / 100,
        ts: Date.now() / 1000,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/quote") {
      const fast = readFastQuote();
      if (fast) {
        json(res, 200, fast);
        return;
      }
      const st = requireEa(res);
      if (!st) return;
      json(res, 200, st.quote);
      return;
    }

    if (req.method === "GET" && path === "/api/account") {
      const st = requireEa(res);
      if (!st) return;
      json(res, 200, st.account);
      return;
    }

    if (req.method === "GET" && path === "/api/account/detect") {
      const st = requireEa(res);
      if (!st) return;
      json(res, 200, {
        ...st.account,
        symbol: st.symbol,
        online: eaOnline(),
        state_age_ms: stateAgeMs(st),
        account_ts: st.ts,
        bridge_session: st.bridge_session,
        bridge_dir: bridgeDir(),
        state_path: st._path,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/positions") {
      let st = requireEa(res);
      if (!st) return;
      const login = Number(st.account?.login ?? 0);
      const symbol = url.searchParams.get("symbol");
      let positions = st.positions || [];
      positions = reconcilePositionsWithMargin(st, positions);
      let liveSnap = false;
      try {
        const live = await Promise.race([
          fetchLiveSnapshot(),
          new Promise((resolve) => setTimeout(() => resolve(null), 600)),
        ]);
        if (live?.positions) {
          positions = live.positions;
          liveSnap = true;
          if (live.account) {
            st = { ...st, account: { ...st.account, ...live.account } };
          }
        }
      } catch {
        /* 用已 reconcile 的 state 列表 */
      }
      positions = reconcilePositionsWithMargin(st, positions);
      watchPositionsForStreak(login, positions);
      if (symbol) positions = positions.filter((p) => positionMatchesSymbol(p.symbol, symbol));
      const accountMargin = Number(st?.account?.margin);
      json(res, 200, {
        positions,
        live_snapshot: liveSnap,
        account_margin: Number.isFinite(accountMargin) ? accountMargin : null,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/orders") {
      const st = requireEa(res);
      if (!st) return;
      const symbol = url.searchParams.get("symbol");
      let orders = st.orders || [];
      const live = await fetchLiveSnapshot();
      if (live?.orders) orders = live.orders;
      if (symbol) orders = orders.filter((o) => positionMatchesSymbol(o.symbol, symbol));
      json(res, 200, { orders, live_snapshot: Boolean(live) });
      return;
    }

    if (req.method === "GET" && path === "/api/instruments") {
      json(res, 200, { instruments: Object.values(INSTRUMENTS) });
      return;
    }

    if (req.method === "GET" && path === "/api/symbol/active") {
      const st = readState();
      const inst = readActiveInstrumentId();
      const map = readSymbolMap();
      const mapped = map?.[inst === "nas" ? "nas100" : inst];
      json(res, 200, {
        instrument: inst,
        broker_symbol: st.symbol,
        mapped_symbol: mapped,
        symbol_map: map,
        connected: eaOnline(),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/symbol/map") {
      json(res, 200, { map: readSymbolMap(), instrument: readActiveInstrumentId() });
      return;
    }

    if (req.method === "GET" && path === "/api/latency/recent") {
      const tail = Math.min(500, Math.max(1, Number(url.searchParams.get("tail") || 120)));
      json(res, 200, { events: readLatencyLog({ tail }) });
      return;
    }

    if (req.method === "POST" && path === "/api/symbol/active") {
      const body = await readBody(req);
      const id = writeActiveInstrumentId(body.instrument ?? body.symbol ?? "xau");
      barsCache.clear();
      json(res, 200, {
        ok: true,
        instrument: id,
        broker_candidates: brokerCandidatesForInstrument(id),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/bars") {
      const st = requireEa(res);
      if (!st) return;
      const tf = url.searchParams.get("timeframe") || "15m";
      const inst = readActiveInstrumentId();
      let sym = resolveTradeSymbol(st, url);
      if (!url.searchParams.get("symbol")) {
        const cands = brokerCandidatesForInstrument(inst);
        if (cands[0]) sym = cands[0];
      }
      if (!BAR_COUNTS[tf]) {
        json(res, 400, { detail: `unsupported timeframe: ${tf}` });
        return;
      }
      const ck = barsCacheKey(tf, sym);
      const hit = barsCache.get(ck);
      if (hit && Date.now() - hit.at < BARS_CACHE_MS) {
        json(res, 200, { ...hit.body, cached: true });
        return;
      }
      let ack = await rpcToEa({ op: "bars", timeframe: tf, count: BAR_COUNTS[tf], symbol: sym });
      if ((!ack.ok || !ack.result?.candles?.length) && inst !== "xau") {
        for (const alt of brokerCandidatesForInstrument(inst)) {
          if (alt === sym) continue;
          ack = await rpcToEa({ op: "bars", timeframe: tf, count: BAR_COUNTS[tf], symbol: alt });
          if (ack.ok && ack.result?.candles?.length) {
            sym = alt;
            break;
          }
        }
      }
      if (!ack.ok) {
        json(res, 502, { detail: ack.error || "bars_failed" });
        return;
      }
      barsCache.set(ck, { at: Date.now(), body: ack.result });
      json(res, 200, ack.result);
      return;
    }

    if (req.method === "GET" && path === "/api/risk/status") {
      const st = requireEa(res);
      if (!st) return;
      const equity = Number(st.account?.equity || 0);
      const login = Number(st.account?.login || 0);
      watchPositionsForStreak(login, st.positions || []);
      resyncStreakFromJournal(login, { rebuild: false });
      json(res, 200, buildMacRiskStatus(equity, login, st.risk || {}));
      return;
    }

    if (req.method === "GET" && path === "/api/risk/events") {
      json(res, 200, { events: [], integrity: { valid: true, tip: "Mac Phase1：EA 审计待移植" } });
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);

      if (path === "/api/order/market") {
        const st = requireEa(res);
        if (!st) return;
        const login = Number(st.account?.login ?? 0);
        const risk = buildMacRiskStatus(Number(st.account?.equity ?? 0), login, st.risk || {});
        if (risk.halted) {
          json(res, 403, { detail: risk.halt_reason ?? "风控暂停" });
          return;
        }
        if (!res.writableEnded) {
          const symbol = body.symbol || st.symbol;
          const ack = await rpcTrade({ op: "market", ...body, symbol });
          const code = ack.ok ? 200 : ack.status || 502;
          const lat = latencyTraceEnabled() ? ack._latency : undefined;
          const ui0 = Number(body.ui_t0_ms);
          const summary =
            lat && Number.isFinite(ui0)
              ? {
                  trace_id: lat.trace_id,
                  click_to_cmd_write_ms: lat.gw_t_cmd_write_ms - ui0,
                  click_to_ack_ms: lat.gw_t_ack_ms - ui0,
                  cmd_write_to_ack_ms: lat.gw_t_ack_ms - lat.gw_t_cmd_write_ms,
                  gw_polls: lat.gw_polls,
                }
              : undefined;
          const latencyPayload = lat ? { latency: { ...lat, summary } } : {};
          json(
            res,
            code,
            ack.ok
              ? { ok: true, ...(ack.result || {}), ...latencyPayload }
              : { detail: ack.error || "下单失败", ...latencyPayload },
          );
        }
        return;
      }

      if (path === "/api/order/pending" || path === "/api/order/limit") {
        const stPend = requireEa(res);
        if (!stPend) return;
        if (!res.writableEnded) {
          try {
            const r = await pendingFastLane({
              ...body,
              price: body.price,
            });
            json(res, r.ok ? 200 : 502, { ok: r.ok, fast_lane: true, retcode: r.retcode });
          } catch (e) {
            const ack = await rpcTrade({ op: "pending", ...body, symbol: body.symbol || stPend.symbol });
            json(res, ack.ok ? 200 : 502, ack.ok ? { ok: true, ...(ack.result || {}) } : { detail: ack.error ?? String(e) });
          }
        }
        return;
      }

      if (path === "/api/order/close") {
        const stClose = requireEa(res);
        if (!stClose) return;
        const login = Number(stClose.account?.login ?? 0);
        if (!res.writableEnded) {
          const pre = (stClose.positions || []).find((p) => Number(p.ticket) === Number(body.ticket));
          const ack = await rpcTrade({ op: "close", ...body, symbol: pre?.symbol || stClose.symbol });
          const lat = latencyTraceEnabled() ? ack._latency : undefined;
          const ui0 = Number(body.ui_t0_ms);
          const summary =
            lat && Number.isFinite(ui0)
              ? {
                  trace_id: lat.trace_id,
                  click_to_cmd_write_ms: lat.gw_t_cmd_write_ms - ui0,
                  click_to_ack_ms: lat.gw_t_ack_ms - ui0,
                  cmd_write_to_ack_ms: lat.gw_t_ack_ms - lat.gw_t_cmd_write_ms,
                  gw_polls: lat.gw_polls,
                }
              : undefined;
          const latencyPayload = lat ? { latency: { ...lat, summary } } : {};
          if (ack.ok && login > 0) {
            let profit = pre?.profit;
            let sym = pre?.symbol;
            try {
              const r = typeof ack.result === "string" ? JSON.parse(ack.result) : ack.result;
              if (r?.profit != null) profit = r.profit;
              if (r?.symbol) sym = r.symbol;
            } catch {
              /* */
            }
            if (profit != null) {
              ingestCloseDeal(login, profit, {
                symbol: sym,
                position_ticket: body.ticket,
                deal_ticket: body.ticket,
                close_kind: "manual",
              });
            }
          }
          json(
            res,
            ack.ok ? 200 : 502,
            ack.ok ? { ok: true, ...latencyPayload } : { detail: ack.error || "平仓失败", ...latencyPayload },
          );
        }
        return;
      }

      if (path === "/api/order/modify") {
        requireEa(res);
        if (!res.writableEnded) {
          try {
            const ack = await rpcTrade({ op: "order_modify", ...body });
            json(res, ack.ok ? 200 : 502, ack.ok ? { ok: true } : { detail: ack.error || "改挂单失败" });
          } catch (e) {
            json(res, 502, { detail: e instanceof Error ? e.message : String(e) });
          }
        }
        return;
      }

      if (path === "/api/position/modify") {
        requireEa(res);
        if (!res.writableEnded) {
          try {
            const r = await modifyFastLane(body);
            json(res, r.ok ? 200 : 502, { ok: r.ok, fast_lane: true });
          } catch (e) {
            const ack = await rpcTrade({ op: "position_modify", ...body });
            json(res, ack.ok ? 200 : 502, ack.ok ? ack.result : { detail: ack.error });
          }
        }
        return;
      }

      if (path === "/api/risk/arm") {
        const arm = body.arm === true || body.armed === true;
        const ctrlPath = path.join(bridgeDir(), "xau_ctrl.json");
        fs.writeFileSync(ctrlPath, JSON.stringify({ arm, ts: Date.now() }), "utf8");
        json(res, 200, { ok: true, arm });
        return;
      }

      if (path === "/api/risk/config") {
        const cfg = saveRiskConfig(body);
        json(res, 200, { ok: true, config: cfg });
        return;
      }

      if (path === "/api/risk/confirm") {
        const st = readState();
        const login = Number(st.account?.login ?? 0);
        const eq = Number(body.equity ?? st.account?.equity ?? 0);
        const cfg = confirmBaseline(login, eq);
        json(res, 200, { ok: true, config: cfg });
        return;
      }

      if (path === "/api/risk/resync-streak") {
        const st = readState();
        const login = Number(st.account?.login ?? 0);
        const rebuild = body.rebuild === true;
        const sync = resyncStreakFromJournal(login, { rebuild });
        const equity = Number(st.account?.equity ?? 0);
        json(res, 200, { ok: true, streak_sync: sync, status: buildMacRiskStatus(equity, login, st.risk || {}) });
        return;
      }

      json(res, 404, { detail: `POST ${path} not found (mac gateway phase1)` });
      return;
    }

    json(res, 404, { detail: "not found" });
  } catch (e) {
    json(res, 503, { detail: e instanceof Error ? e.message : String(e) });
  }
});

function startIpcServer() {
  if (process.env.XAU_IPC_SERVER === "0") return;
  const sock = process.env.MT5_IPC_SOCK || "/tmp/mt5_bridge.sock";
  const gatewayDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(gatewayDir, "..");
  const py = path.join(root, "ipc", "native", "mt5_bridge_server.py");
  const nodeSrv = path.join(root, "ipc", "native", "mt5_bridge_server.mjs");
  const script = fs.existsSync(py) ? py : fs.existsSync(nodeSrv) ? nodeSrv : null;
  if (!script) return;
  const bin = script.endsWith(".py") ? "python3" : process.execPath;
  const args = script.endsWith(".py") ? [script, "--sock", sock] : [script];
  try {
    const child = spawn(bin, args, {
      env: { ...process.env, MT5_IPC_SOCK: sock, ELECTRON_RUN_AS_NODE: "1" },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(`[xau-gateway-mac] ipc server ipc://${sock}`);
  } catch (e) {
    console.warn("[xau-gateway-mac] ipc server skip", e);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`[xau-gateway-mac] http://${HOST}:${PORT}  bridge=${bridgeDir()}`);
  console.log("[xau-gateway-mac] EA: XauDeskBridge 文件桥（含下单）");
  startIpcServer();
  setTimeout(() => {
    rescanBridgeDir();
    const st = readState();
    const stale = stateAgeMs(st);
    const needForce =
      (mt5ProcessLikelyRunning() && stale != null && stale > 60_000 && !eaOnline()) ||
      (eaOnline() && !bridgeVerAtLeast(st.bridge_ver));
    ensureMt5Bridge({ force: needForce })
      .then((r) => console.log("[xau-gateway-mac] ensure", JSON.stringify(r)))
      .catch((e) => console.warn("[xau-gateway-mac] ensure failed", e));
  }, 1500);
});
