import fs from "node:fs";
import path from "node:path";
import { bridgeDir } from "./resolve-bridge-dir.mjs";

const CONFIG_FILE = "xau_risk_config.json";
const RUNTIME_FILE = "xau_risk_runtime.json";
const DEALS_FILE = "xau_deals.jsonl";

function bjtNowIso() {
  const utc = Date.now() + 8 * 3600 * 1000;
  return new Date(utc).toISOString().replace("Z", "+08:00");
}

function sessionKeyBjt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_CONFIG = {
  daily_enabled: true,
  per_trade_loss_cap_pct: 2,
  daily_loss_cap_pct: 5,
  baseline_equity: null,
  baseline_confirmed_at: null,
  streak_enabled: true,
  streak_tier1_losses: 2,
  streak_tier1_pause_minutes: 15,
  streak_tier2_losses: 3,
  streak_tier2_pause_minutes: 60,
  require_stop_loss: false,
  virtual_equity_usd: null,
  margin_cap_factor: 0.35,
  max_combined_slots: 6,
  app_magic_only: true,
};

function configPath() {
  return path.join(bridgeDir(), CONFIG_FILE);
}

function runtimePath(login) {
  return path.join(bridgeDir(), `${RUNTIME_FILE.replace(".json", "")}_${login}.json`);
}

function dealsPath() {
  return path.join(bridgeDir(), DEALS_FILE);
}

export function loadRiskConfig(login) {
  const p = configPath();
  let cfg = { ...DEFAULT_CONFIG };
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j && typeof j === "object") cfg = { ...cfg, ...j };
  } catch {
    /* */
  }
  if (login) {
    try {
      const rt = loadRuntime(login);
      if (rt.baseline_equity != null) cfg.baseline_equity = rt.baseline_equity;
      if (rt.baseline_confirmed_at) cfg.baseline_confirmed_at = rt.baseline_confirmed_at;
    } catch {
      /* */
    }
  }
  return cfg;
}

export function saveRiskConfig(patch) {
  const cur = loadRiskConfig(0);
  const next = { ...cur, ...patch, updated_at: Date.now() };
  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function defaultRuntime() {
  return {
    consecutive_losses: 0,
    streak_tier3_armed: false,
    halted: false,
    halt_kind: null,
    halt_reason: null,
    halted_until_bjt: null,
    baseline_equity: null,
    baseline_confirmed_at: null,
    seen_deals: [],
  };
}

export function loadRuntime(login) {
  const p = runtimePath(login);
  try {
    return { ...defaultRuntime(), ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return defaultRuntime();
  }
}

function saveRuntime(login, rt) {
  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.writeFileSync(runtimePath(login), JSON.stringify(rt, null, 2), "utf8");
}

function parseHaltedUntil(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).getTime();
  } catch {
    return null;
  }
}

function applyStreakHalts(login, rt, cfg) {
  const now = Date.now();
  const until = parseHaltedUntil(rt.halted_until_bjt);
  if (until && now < until) {
    rt.halted = true;
    rt.halt_kind = "streak";
    return;
  }
  if (until && now >= until) {
    rt.halted = false;
    rt.halt_kind = null;
    rt.halt_reason = null;
    rt.halted_until_bjt = null;
    rt.consecutive_losses = 0;
    rt.streak_tier3_armed = false;
  }
  const t1 = cfg.streak_tier1_losses ?? 2;
  const t2 = cfg.streak_tier2_losses ?? 3;
  const m1 = cfg.streak_tier1_pause_minutes ?? 15;
  const m2 = cfg.streak_tier2_pause_minutes ?? 60;
  if (!cfg.streak_enabled) return;
  if (rt.consecutive_losses >= t2) {
    const u = new Date(now + m2 * 60 * 1000);
    rt.halted = true;
    rt.halt_kind = "streak";
    rt.halt_reason = `连续止损 ${rt.consecutive_losses} 笔 · 暂停 ${m2} 分钟`;
    rt.halted_until_bjt = u.toISOString().replace("Z", "+08:00");
    rt.consecutive_losses = 0;
    rt.streak_tier3_armed = false;
  } else if (rt.consecutive_losses >= t1) {
    const u = new Date(now + m1 * 60 * 1000);
    rt.halted = true;
    rt.halt_kind = "streak";
    rt.halt_reason = `连续止损 ${rt.consecutive_losses} 笔 · 暂停 ${m1} 分钟`;
    rt.halted_until_bjt = u.toISOString().replace("Z", "+08:00");
    rt.consecutive_losses = 0;
  }
}

export function appendDealRecord(login, row) {
  const line = JSON.stringify({ login, session: sessionKeyBjt(), ...row, ts: Date.now() }) + "\n";
  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.appendFileSync(dealsPath(), line, "utf8");
}

export function ingestCloseDeal(login, profit, meta = {}) {
  const cfg = loadRiskConfig(login);
  if (!cfg.streak_enabled) return { consecutive_losses: 0 };
  const rt = loadRuntime(login);
  const dealKey = meta.deal_ticket ?? meta.position_ticket;
  if (dealKey != null && rt.seen_deals.includes(dealKey)) {
    return { skipped: true, consecutive_losses: rt.consecutive_losses };
  }
  const p = Number(profit);
  if (dealKey != null) {
    rt.seen_deals = [...rt.seen_deals, dealKey].slice(-500);
  }
  appendDealRecord(login, {
    kind: "close",
    profit_usd: p,
    symbol: meta.symbol,
    deal_ticket: meta.deal_ticket,
    position_ticket: meta.position_ticket,
    close_kind: meta.close_kind ?? "manual",
  });
  if (p < -0.005) rt.consecutive_losses += 1;
  else if (p > 0.005) rt.consecutive_losses = 0;
  applyStreakHalts(login, rt, cfg);
  saveRuntime(login, rt);
  return { consecutive_losses: rt.consecutive_losses, profit: p };
}

export function resyncStreakFromJournal(login, { rebuild = false } = {}) {
  const cfg = loadRiskConfig(login);
  let rt = loadRuntime(login);
  if (rebuild) {
    rt = defaultRuntime();
    saveRuntime(login, rt);
  }
  const sk = sessionKeyBjt();
  const p = dealsPath();
  if (!fs.existsSync(p)) return { consecutive_losses: rt.consecutive_losses, synced: 0 };
  let cl = 0;
  let synced = 0;
  const seen = new Set(rebuild ? [] : rt.seen_deals);
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.login !== login || j.session !== sk) continue;
      if (j.kind !== "close") continue;
      const key = j.deal_ticket ?? j.position_ticket ?? j.ts;
      if (seen.has(key)) continue;
      seen.add(key);
      synced += 1;
      const profit = Number(j.profit_usd);
      if (profit < -0.005) cl += 1;
      else if (profit > 0.005) cl = 0;
    } catch {
      /* */
    }
  }
  rt.seen_deals = [...seen].slice(-500);
  rt.consecutive_losses = cl;
  applyStreakHalts(login, rt, cfg);
  saveRuntime(login, rt);
  return { consecutive_losses: rt.consecutive_losses, synced };
}

export function confirmBaseline(login, equity) {
  const rt = loadRuntime(login);
  rt.baseline_equity = Number(equity);
  rt.baseline_confirmed_at = bjtNowIso();
  saveRuntime(login, rt);
  saveRiskConfig({ baseline_equity: rt.baseline_equity, baseline_confirmed_at: rt.baseline_confirmed_at });
  return loadRiskConfig(login);
}

const lastPosSnapshot = new Map();

/** 检测 SL/强平导致持仓消失，写入连损（全品种 magic 单） */
export function watchPositionsForStreak(login, positions = []) {
  if (!login) return;
  const prev = lastPosSnapshot.get(login) || [];
  const curr = Array.isArray(positions) ? positions : [];
  const currSet = new Set(curr.map((p) => Number(p.ticket)));
  for (const p of prev) {
    if (currSet.has(Number(p.ticket))) continue;
    ingestCloseDeal(login, Number(p.profit ?? 0), {
      symbol: p.symbol,
      position_ticket: p.ticket,
      close_kind: "auto_or_external",
    });
  }
  lastPosSnapshot.set(
    login,
    curr.map((p) => ({
      ticket: Number(p.ticket),
      profit: Number(p.profit ?? 0),
      symbol: p.symbol,
    })),
  );
}

export function buildMacRiskStatus(equity, login, eaRisk = {}) {
  const cfg = loadRiskConfig(login);
  const rt = loadRuntime(login);
  applyStreakHalts(login, rt, cfg);
  saveRuntime(login, rt);
  const halted = Boolean(rt.halted || eaRisk.halted);
  return {
    account_login: login,
    config: {
      ...cfg,
      baseline_equity: rt.baseline_equity ?? cfg.baseline_equity ?? equity,
      baseline_confirmed_at: rt.baseline_confirmed_at ?? cfg.baseline_confirmed_at,
    },
    session_key: sessionKeyBjt(),
    session_start_bjt: `${sessionKeyBjt()}T06:00:00+08:00`,
    session_end_bjt: `${sessionKeyBjt()}T23:59:59+08:00`,
    bjt_now: bjtNowIso(),
    halted,
    halt_reason: rt.halt_reason ?? (halted ? eaRisk.halt_reason : null),
    consecutive_losses: rt.consecutive_losses,
    streak_enabled: cfg.streak_enabled !== false,
    streak_tier3_armed: rt.streak_tier3_armed,
    halt_kind: rt.halt_kind,
    halted_until_bjt: rt.halted_until_bjt,
    streak_sync: { consecutive_losses: rt.consecutive_losses, synced: 0, scope: "all_symbols_magic" },
    exposure: eaRisk.exposure ?? {
      app_open_slots: eaRisk.app_open_slots ?? 0,
      max_combined_slots: cfg.max_combined_slots ?? 6,
      margin_used_usd: Number(eaRisk.app_margin_usd ?? eaRisk.margin_used_usd ?? 0),
      margin_budget_usd: Number(eaRisk.margin_budget_usd ?? 0),
      risk_notional_usd: Number(eaRisk.risk_notional_usd ?? 0),
      leverage: Number(eaRisk.leverage ?? 0),
      foreign_exposure_count: Number(eaRisk.foreign_exposure_count ?? 0),
    },
    gateway_backend: "mql5-file-bridge-mac-risk",
  };
}