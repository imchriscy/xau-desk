#!/usr/bin/env node
/** 找出 Wine MT5 实际使用的用户目录（chenchris / user 等） */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINE = path.join(
  os.homedir(),
  "Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users",
);

function scoreTerminalDir(terminalDir) {
  const common = path.join(terminalDir, "Common", "Files", "xau_state.json");
  const origin = path.join(terminalDir, "origin.txt");
  let score = 0;
  try {
    if (fs.existsSync(common)) {
      score += 1_000_000_000 - Math.min(1e9, fs.statSync(common).mtimeMs);
    }
  } catch {
    /* */
  }
  try {
    if (fs.existsSync(origin)) score += 1000;
  } catch {
    /* */
  }
  try {
    if (fs.existsSync(terminalDir)) score += 1;
  } catch {
    /* */
  }
  return score;
}

export function detectWineMt5Profile() {
  if (!fs.existsSync(WINE)) return { wineUser: "user", terminalDir: null };
  let bestUser = "user";
  let bestScore = -1;
  let bestTerminal = null;
  for (const ent of fs.readdirSync(WINE, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const terminalDir = path.join(WINE, ent.name, "AppData/Roaming/MetaQuotes/Terminal");
    if (!fs.existsSync(terminalDir)) continue;
    const s = scoreTerminalDir(terminalDir);
    if (s > bestScore) {
      bestScore = s;
      bestUser = ent.name;
      bestTerminal = terminalDir;
    }
  }
  return { wineUser: bestUser, terminalDir: bestTerminal };
}

