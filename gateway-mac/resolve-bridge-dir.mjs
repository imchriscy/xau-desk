import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickActiveBridgeDir, persistUserBridgeDir, userBridgePathFile } from "./bridge-discover.mjs";
import { readStateJsonFile, stateFileStalenessMs } from "./read-state-json.mjs";
import { detectActiveWineUser } from "./wine-profile.mjs";

const STATE_FRESH_MS = Number(process.env.XAU_STATE_FRESH_MS || 90_000);

let cachedDir = null;

function bridgePathFileBesideGateway() {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const f = path.join(here, "bridge-path.txt");
    if (fs.existsSync(f)) {
      const line = fs.readFileSync(f, "utf8").trim();
      if (line && fs.existsSync(line)) return line;
    }
  } catch {
    /* optional */
  }
  return null;
}

function readPathFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const line = fs.readFileSync(filePath, "utf8").trim();
      if (line && fs.existsSync(line)) return line;
    }
  } catch {
    /* optional */
  }
  return null;
}

function dirStateFresh(dir) {
  const jf = path.join(dir, STATE_FILE);
  if (!fs.existsSync(jf)) return false;
  try {
    const j = readStateJsonFile(jf);
    return stateFileStalenessMs(jf, j?.ts) < STATE_FRESH_MS;
  } catch {
    try {
      return stateFileStalenessMs(jf, null) < STATE_FRESH_MS;
    } catch {
      return false;
    }
  }
}

function resolveBridgeDirUncached() {
  const custom = process.env.XAU_BRIDGE_DIR?.trim();
  if (custom && fs.existsSync(custom) && dirStateFresh(custom)) return custom;

  const picked = pickActiveBridgeDir();
  if (picked && dirStateFresh(picked)) {
    persistUserBridgeDir(picked);
    return picked;
  }

  const fromUser = readPathFile(userBridgePathFile());
  if (fromUser && dirStateFresh(fromUser)) return fromUser;

  const active = detectActiveWineUser();
  if (active.commonFiles && fs.existsSync(active.commonFiles)) {
    if (!fromUser || fromUser !== active.commonFiles) {
      persistUserBridgeDir(active.commonFiles);
    }
    return active.commonFiles;
  }

  if (picked) {
    persistUserBridgeDir(picked);
    return picked;
  }
  if (fromUser && fs.existsSync(fromUser)) return fromUser;

  const fromPackaged = bridgePathFileBesideGateway();
  if (fromPackaged) return fromPackaged;

  const home = os.homedir();
  return path.join(
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
  );
}

/** MT5 FILE_COMMON 目录（Mac 原生 / Wine MT5）。 */
export function defaultCommonFilesDir() {
  return resolveBridgeDirUncached();
}

export function bridgeDir() {
  if (cachedDir) return cachedDir;
  const base = resolveBridgeDirUncached();
  try {
    fs.mkdirSync(base, { recursive: true });
    cachedDir = base;
    return base;
  } catch (e) {
    const fallback = path.join(process.cwd(), ".xau-bridge");
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(`[xau-gateway-mac] bridge mkdir failed (${base}): ${e}; using ${fallback}`);
    cachedDir = fallback;
    return fallback;
  }
}

/** 运行中若 EA 换目录写了 state，可重新探测并切桥（返回是否变更）。 */
export function rescanBridgeDir() {
  const prev = cachedDir || bridgeDir();
  let picked = pickActiveBridgeDir();
  const active = detectActiveWineUser();
  if (active.commonFiles && (!picked || !dirStateFresh(picked))) {
    picked = active.commonFiles;
  }
  if (!picked || picked === prev) return { changed: false, dir: prev };
  persistUserBridgeDir(picked);
  process.env.XAU_BRIDGE_DIR = picked;
  cachedDir = picked;
  console.log(`[xau-gateway-mac] bridge dir -> ${picked}`);
  return { changed: true, dir: picked, prev };
}

export const STATE_FILE = "xau_state.json";
export const CMD_FILE = "xau_cmd.json";
export const ACK_FILE = "xau_ack.json";
