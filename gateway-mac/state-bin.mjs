/**
 * 读取 EA 状态：多路径扫描（Wine 全局 Common / 本地 MQL5/Files）+ json/bin
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bridgeDir } from "./resolve-bridge-dir.mjs";

const STATE_BIN = "xau_state.bin";
const STATE_JSON = "xau_state.json";
const MAX_POS = 32;

function discoverStateDirs() {
  const home = os.homedir();
  const dirs = [bridgeDir()];
  const roots = [
    path.join(home, "Library", "Application Support", "net.metaquotes.wine.metatrader5"),
    path.join(home, "Library", "Application Support", "MetaQuotes"),
  ];
  const seen = new Set(dirs);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir, depth) => {
      if (depth > 9) return;
      let ents;
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        if (!e.isDirectory()) continue;
        const p = path.join(dir, e.name);
        if (e.name === "Files" && dir.endsWith(`${path.sep}Common`) && !seen.has(p)) {
          seen.add(p);
          dirs.push(p);
        }
        if (e.name === "MQL5" || e.name === "Files" || e.name === "Terminal" || e.name === "user" || e.name === "users")
          walk(p, depth + 1);
      }
    };
    walk(root, 0);
  }
  const mqlFiles = path.join(
    home,
    "Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files",
  );
  if (fs.existsSync(mqlFiles) && !seen.has(mqlFiles)) dirs.push(mqlFiles);
  return dirs;
}

function readJsonState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseBin(buf) {
  if (buf.length < 128) return null;
  if (buf.subarray(0, 4).toString("ascii") !== "XAU1") return null;
  const tsSec = buf.readDoubleLE(8);
  const symbol = buf.toString("utf8", 16, 32).replace(/\0.*$/, "");
  const bid = buf.readDoubleLE(32);
  const ask = buf.readDoubleLE(40);
  const login = Number(buf.readBigInt64LE(52));
  const equity = buf.readDoubleLE(60);
  const balance = buf.readDoubleLE(68);
  const fresh = Date.now() / 1000 - tsSec < 60;
  const last = (bid + ask) / 2;
  return {
    connected: fresh,
    ts: tsSec,
    symbol,
    terminal: "XauDeskExec",
    trade_allowed: true,
    quote: { symbol, bid, ask, last, time: Math.floor(tsSec), mt5_ms: 0.1 },
    account: {
      login,
      server: "",
      name: "",
      company: "",
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
    risk: { require_stop_loss: true, halted: false, armed: true, consecutive_losses: 0 },
    _from: "bin",
  };
}

export function readBinaryState() {
  let best = null;
  let bestTs = 0;
  for (const dir of discoverStateDirs()) {
    const jf = path.join(dir, STATE_JSON);
    if (fs.existsSync(jf)) {
      const j = readJsonState(jf);
      const ts = Number(j?.ts || 0);
      if (j && ts >= bestTs) {
        bestTs = ts;
        best = { ...j, _path: jf };
      }
    }
    const bf = path.join(dir, STATE_BIN);
    if (fs.existsSync(bf)) {
      const b = parseBin(fs.readFileSync(bf));
      const ts = Number(b?.ts || 0);
      if (b && ts >= bestTs) {
        bestTs = ts;
        best = { ...b, _path: bf };
      }
    }
  }
  if (best && best.ts) {
    const ageMs = Date.now() - Number(best.ts) * 1000;
    best.connected = ageMs < 60_000;
  }
  return best;
}
