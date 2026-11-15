import fs from "node:fs";

/** 读 EA 写的 xau_state.json（Windows ANSI / UTF-8 混排）。 */
export function readStateJsonFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const texts = [];
  try {
    texts.push(raw.toString("utf8"));
  } catch {
    /* rare */
  }
  texts.push(raw.toString("latin1"));
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    texts.push(raw.toString("utf16le"));
  }
  for (const text of texts) {
    try {
      return JSON.parse(text);
    } catch {
      /* next encoding */
    }
  }
  throw new Error("state JSON 无法解析（编码或格式错误）");
}

export function stateFileStalenessMs(filePath, tsSec) {
  const parts = [];
  try {
    parts.push(Math.max(0, Date.now() - fs.statSync(filePath).mtimeMs));
  } catch {
    /* missing */
  }
  if (tsSec != null && Number.isFinite(Number(tsSec))) {
    let fromTs = Date.now() - Number(tsSec) * 1000;
    if (fromTs < 0) fromTs = 0;
    parts.push(fromTs);
  }
  if (parts.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(...parts);
}
