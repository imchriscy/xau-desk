import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { stateFileStalenessMs } from "./read-state-json.mjs";

const WINE_USERS = path.join(
  os.homedir(),
  "Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users",
);

function newestMtimeUnder(dir, maxDepth, nameRe) {
  let best = 0;
  const walk = (d, depth) => {
    if (depth > maxDepth || !fs.existsSync(d)) return;
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (nameRe.test(e.name)) {
        try {
          const m = fs.statSync(p).mtimeMs;
          if (m > best) best = m;
        } catch {
          /* */
        }
      }
    }
  };
  walk(dir, 0);
  return best;
}

/** 当前正在用的 Wine MT5 配置（看终端日志 / 社区缓存新鲜度，不靠陈旧 xau_state）。 */
export function detectActiveWineUser() {
  if (!fs.existsSync(WINE_USERS)) {
    return { wineUser: "user", commonFiles: null, terminalDir: null, score: 0 };
  }
  let bestUser = "user";
  let bestScore = -1;
  let bestTerminal = null;
  for (const ent of fs.readdirSync(WINE_USERS, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === "Public") continue;
    const terminalRoot = path.join(
      WINE_USERS,
      ent.name,
      "AppData/Roaming/MetaQuotes/Terminal",
    );
    if (!fs.existsSync(terminalRoot)) continue;
    const logFresh = newestMtimeUnder(terminalRoot, 6, /\.log$/i);
    const datFresh = newestMtimeUnder(path.join(terminalRoot, "Community"), 2, /\.dat$/i);
    let stateFresh = 0;
    const stateJson = path.join(terminalRoot, "Common/Files/xau_state.json");
    if (fs.existsSync(stateJson)) {
      try {
        const stale = stateFileStalenessMs(stateJson, null);
        if (stale < 120_000) stateFresh = Date.now() - stale;
      } catch {
        /* */
      }
    }
    const score = logFresh * 1.2 + datFresh + stateFresh;
    if (score > bestScore) {
      bestScore = score;
      bestUser = ent.name;
      bestTerminal = terminalRoot;
    }
  }
  const commonFiles = bestTerminal
    ? path.join(bestTerminal, "Common/Files")
    : null;
  return { wineUser: bestUser, commonFiles, terminalDir: bestTerminal, score: bestScore };
}

export function mt5ProcessLikelyRunning() {
  try {
    const out = execSync("pgrep -fl terminal64.exe 2>/dev/null || true", {
      encoding: "utf8",
    });
    return out.includes("terminal64");
  } catch {
    return false;
  }
}