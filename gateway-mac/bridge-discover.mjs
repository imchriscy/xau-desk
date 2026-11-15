import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStateJsonFile, stateFileStalenessMs } from "./read-state-json.mjs";

const APP_SUPPORT = path.join(os.homedir(), "Library", "Application Support", "XauDesk");

export function userBridgePathFile() {
  return path.join(APP_SUPPORT, "bridge-path.txt");
}

export function persistUserBridgeDir(dir) {
  try {
    fs.mkdirSync(APP_SUPPORT, { recursive: true });
    fs.writeFileSync(userBridgePathFile(), `${dir.trim()}\n`, "utf8");
  } catch (e) {
    console.warn("[xau-gateway-mac] persist bridge-path failed:", e);
  }
}

function walkFindCommonFiles(dir, depth, out) {
  if (depth > 8 || !fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === "Files" && dir.endsWith(`${path.sep}Common`)) out.push(p);
    else walkFindCommonFiles(p, depth + 1, out);
  }
}

export function listBridgeCandidateDirs() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "Library", "Application Support", "MetaQuotes", "Terminal", "Common", "Files"),
    path.join(
      home,
      "Library",
      "Application Support",
      "net.metaquotes.wine.metatrader5",
      "drive_c",
      "users",
      "user",
      "AppData",
      "Roaming",
      "MetaQuotes",
      "Terminal",
      "Common",
      "Files",
    ),
  ];
  const wineUsers = path.join(
    home,
    "Library",
    "Application Support",
    "net.metaquotes.wine.metatrader5",
    "drive_c",
    "users",
  );
  walkFindCommonFiles(wineUsers, 0, candidates);
  const seen = new Set();
  const existing = [];
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (fs.existsSync(p)) existing.push(p);
  }
  return existing;
}

/** 选 EA 正在写的 Common/Files：新鲜度看文件 mtime + ts，避免经纪商时钟领先本机。 */
export function pickActiveBridgeDir({ freshMs = 20_000 } = {}) {
  let best = null;
  let bestScore = Infinity;
  for (const dir of listBridgeCandidateDirs()) {
    const jf = path.join(dir, "xau_state.json");
    if (!fs.existsSync(jf)) continue;
    let staleMs;
    try {
      const j = readStateJsonFile(jf);
      staleMs = stateFileStalenessMs(jf, j?.ts);
    } catch {
      try {
        staleMs = Math.max(0, Date.now() - fs.statSync(jf).mtimeMs);
      } catch {
        continue;
      }
    }
    if (staleMs <= freshMs && staleMs < bestScore) {
      bestScore = staleMs;
      best = dir;
    }
  }
  if (best) return best;
  let fallback = null;
  let fallbackStale = Infinity;
  for (const dir of listBridgeCandidateDirs()) {
    const jf = path.join(dir, "xau_state.json");
    if (!fs.existsSync(jf)) continue;
    let staleMs;
    try {
      staleMs = stateFileStalenessMs(jf, null);
    } catch {
      continue;
    }
    if (staleMs < fallbackStale) {
      fallbackStale = staleMs;
      fallback = dir;
    }
  }
  if (fallback) return fallback;
  for (const dir of listBridgeCandidateDirs()) {
  const jf = path.join(dir, "xau_state.json");
  if (fs.existsSync(jf)) return dir;
  }
  return listBridgeCandidateDirs()[0] || null;
}
