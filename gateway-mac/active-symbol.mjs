import fs from "node:fs";
import path from "node:path";
import { bridgeDir } from "./resolve-bridge-dir.mjs";
import { listBridgeCandidateDirs } from "./bridge-discover.mjs";

export const ACTIVE_SYMBOL_FILE = "xau_active_instrument.txt";
export const SYMBOL_MAP_FILE = "xau_symbol_map.json";

export const INSTRUMENTS = {
  xau: {
    id: "xau",
    label: "黄金",
    candidates: ["XAUUSD", "XAUUSDm", "XAUUSDx", "GOLD", "XAUUSD.m"],
  },
  btc: {
    id: "btc",
    label: "BTC",
    candidates: ["BTCUSD", "BTCUSDm", "BTCUSD.", "BTCUSDT", "Bitcoin"],
  },
  nas100: {
    id: "nas100",
    label: "NAS100",
    candidates: ["NAS100", "NAS100m", "US100", "USTEC", "NAS100.", "US100.cash"],
  },
};

export function readActiveInstrumentId() {
  const p = path.join(bridgeDir(), ACTIVE_SYMBOL_FILE);
  try {
    const line = fs.readFileSync(p, "utf8").trim();
    const low = line.toLowerCase();
    if (low && INSTRUMENTS[low]) return low;
    if (line.length >= 3) return line;
  } catch {
    /* default */
  }
  return "xau";
}

export function readSymbolMap() {
  const p = path.join(bridgeDir(), SYMBOL_MAP_FILE);
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j && typeof j === "object") return j;
  } catch {
    /* EA 尚未写入 */
  }
  for (const dir of listBridgeCandidateDirs()) {
    const alt = path.join(dir, SYMBOL_MAP_FILE);
    try {
      const j = JSON.parse(fs.readFileSync(alt, "utf8"));
      if (j && typeof j === "object") return j;
    } catch {
      /* */
    }
  }
  return null;
}

export function brokerCandidatesForInstrument(instrumentId) {
  const id = String(instrumentId || "xau").trim().toLowerCase();
  const staticList = INSTRUMENTS[id]?.candidates ?? INSTRUMENTS.xau.candidates;
  const map = readSymbolMap();
  const resolved = map?.[id === "nas" ? "nas100" : id];
  if (resolved && typeof resolved === "string" && resolved.length > 1) {
    return [resolved, ...staticList.filter((s) => s !== resolved)];
  }
  return staticList;
}

export function writeActiveInstrumentId(instrumentId) {
  const id = String(instrumentId || "xau").trim().toLowerCase();
  if (!INSTRUMENTS[id] && !id.includes("USD")) {
    throw new Error(`未知品种: ${instrumentId}`);
  }
  const body = `${id}\n`;
  const dirs = new Set([bridgeDir(), ...listBridgeCandidateDirs()]);
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ACTIVE_SYMBOL_FILE), body, "utf8");
    } catch {
      /* one profile may be missing */
    }
  }
  return id;
}