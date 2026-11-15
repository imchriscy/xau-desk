#!/usr/bin/env node
/**
 * Mac：把 XauDeskBridge 装进 MT5，并用官方 /config 自动挂到图表。
 * 用户只需登录并开启算法交易。Python MetaTrader5 库在 Mac 上不可用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readStateJsonFile, stateFileStalenessMs } from "./read-state-json.mjs";
import { pickActiveBridgeDir, persistUserBridgeDir } from "./bridge-discover.mjs";
import { detectActiveWineUser, mt5ProcessLikelyRunning } from "./wine-profile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const WINE_ROOT = path.join(
  HOME,
  "Library/Application Support/net.metaquotes.wine.metatrader5",
);
const MT5_DIR = path.join(WINE_ROOT, "drive_c/Program Files/MetaTrader 5");
const LOCK = path.join(HOME, "Library/Application Support/XauDesk/last-mt5-ensure.json");
const FRESH_MS = 20_000;
const RESTART_COOLDOWN_MS = 90_000;

function wineUser() {
  return detectActiveWineUser().wineUser || "user";
}

function wineBin() {
  const candidates = [
    "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine64",
    "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function stateIsFresh() {
  const dir = pickActiveBridgeDir({ freshMs: FRESH_MS });
  if (!dir) return false;
  const jf = path.join(dir, "xau_state.json");
  if (!fs.existsSync(jf)) return false;
  try {
    const j = readStateJsonFile(jf);
    return stateFileStalenessMs(jf, j?.ts) < FRESH_MS;
  } catch {
    return false;
  }
}

function installExpert() {
  const experts = path.join(MT5_DIR, "MQL5/Experts");
  const include = path.join(MT5_DIR, "MQL5/Include");
  fs.mkdirSync(experts, { recursive: true });
  fs.mkdirSync(include, { recursive: true });
  const destEx5 = path.join(experts, "XauDeskBridge.ex5");
  const payloadEx5 = path.join(HERE, "mt5-payload/XauDeskBridge.ex5");
  const repoRoot = path.resolve(HERE, "..");
  const srcMq5 = path.join(repoRoot, "mql5/Experts/XauDeskBridge.mq5");
  const srcMq5Local = path.join(HERE, "mt5-payload/XauDeskBridge.mq5");
  const destMq5 = path.join(experts, "XauDeskBridge.mq5");
  if (fs.existsSync(srcMq5)) fs.copyFileSync(srcMq5, destMq5);
  else if (fs.existsSync(srcMq5Local)) fs.copyFileSync(srcMq5Local, destMq5);
  for (const mqhName of ["BridgeRpc.mqh", "TradeExec.mqh"]) {
    const mqh = path.join(repoRoot, "mql5/Include", mqhName);
    if (fs.existsSync(mqh)) fs.copyFileSync(mqh, path.join(include, mqhName));
  }
  // 禁止用陈旧 payload.ex5 覆盖刚编译产物（否则会退回仅黄金的 1.008）
  if (fs.existsSync(payloadEx5)) {
    const payloadM = fs.statSync(payloadEx5).mtimeMs;
    const destM = fs.existsSync(destEx5) ? fs.statSync(destEx5).mtimeMs : 0;
    const mq5M = fs.existsSync(destMq5) ? fs.statSync(destMq5).mtimeMs : 0;
    if (!fs.existsSync(destEx5) || (payloadM > destM && payloadM >= mq5M)) {
      fs.copyFileSync(payloadEx5, destEx5);
    }
  }
}

function writeStartupIni(user) {
  const dir = path.join(
    WINE_ROOT,
    "drive_c/users",
    user,
    "AppData/Roaming/MetaQuotes/Terminal",
  );
  fs.mkdirSync(dir, { recursive: true });
  const ini = path.join(dir, "xaudesk_startup.ini");
  const text =
    "[Experts]\r\nEnabled=1\r\nAllowLiveTrading=1\r\nAllowDllImport=1\r\n\r\n" +
    "[StartUp]\r\nExpert=XauDeskBridge\r\nSymbol=EURUSD\r\nPeriod=M15\r\n";
  const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  fs.writeFileSync(ini, body);
  return `C:\\\\users\\\\${user}\\\\AppData\\\\Roaming\\\\MetaQuotes\\\\Terminal\\\\xaudesk_startup.ini`;
}

function recentlyRestarted() {
  try {
    const j = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    return Date.now() - Number(j.at || 0) < RESTART_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markRestart() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify({ at: Date.now() }));
}

export async function ensureMt5Bridge({ force = false } = {}) {
  if (!fs.existsSync(MT5_DIR)) {
    return { ok: false, reason: "未安装 MetaTrader 5（Mac）" };
  }
  installExpert();
  const active = detectActiveWineUser();
  if (active.commonFiles) {
    try {
      fs.mkdirSync(active.commonFiles, { recursive: true });
      persistUserBridgeDir(active.commonFiles);
    } catch {
      /* */
    }
  }
  const dir = pickActiveBridgeDir({ freshMs: 120_000 });
  if (dir && stateIsFresh()) persistUserBridgeDir(dir);
  if (!force && stateIsFresh()) {
    return { ok: true, action: "already_connected", wine_user: active.wineUser };
  }
  if (!force && recentlyRestarted()) {
    const hint =
      mt5ProcessLikelyRunning() && !stateIsFresh()
        ? "MT5 已打开但 EA 未写桥接文件。请开启算法交易（绿），或稍后点「修复连接」让 XauDesk 自动挂载 EA。"
        : "刚自动挂过 EA。请确认 MT5 已登录，并点亮工具栏「算法交易」（绿色）。";
    return {
      ok: false,
      reason: hint,
      action: "cooldown",
      wine_user: active.wineUser,
      needs_algo: true,
    };
  }
  const wine = wineBin();
  if (!wine) return { ok: false, reason: "未找到 MT5 的 Wine 运行时" };
  const user = active.wineUser || wineUser();
  const iniWin = writeStartupIni(user);
  markRestart();

  await new Promise((resolve) => {
    const q = spawn("osascript", ["-e", 'quit app "MetaTrader 5"'], { stdio: "ignore" });
    q.on("exit", () => resolve());
    setTimeout(resolve, 2500);
  });
  await new Promise((resolve) => {
    const k = spawn("pkill", ["-f", "terminal64.exe"], { stdio: "ignore" });
    k.on("exit", () => resolve());
    setTimeout(resolve, 2000);
  });
  await new Promise((r) => setTimeout(r, 1200));

  const terminal = path.join(MT5_DIR, "terminal64.exe");
  const child = spawn(wine, [terminal, "/portable", `/config:${iniWin}`], {
    env: { ...process.env, WINEPREFIX: WINE_ROOT, WINEDEBUG: "-all" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    ok: true,
    action: "restarted_with_bridge",
    wine_user: user,
    note: "已自动挂载 XauDeskBridge。请保持 MT5 登录并开启算法交易。",
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const force = process.argv.includes("--force");
  const r = await ensureMt5Bridge({ force });
  console.log(JSON.stringify(r, null, 2));
}
