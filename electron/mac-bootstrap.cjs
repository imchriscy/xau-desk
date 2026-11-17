/** @file 启动 Mac 网关 + 静态 UI 服务（打包后无 Vite） */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function walkWineCommonFiles(dir, depth, out) {
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
    else walkWineCommonFiles(p, depth + 1, out);
  }
}

function pickBridgeDir(candidates) {
  const existing = candidates.filter((p) => fs.existsSync(p));
  if (existing.length === 0) return null;
  if (existing.length === 1) return existing[0];
  let best = existing[0];
  let bestMtime = 0;
  for (const dir of existing) {
    for (const name of ["xau_state.json", "xau_state.bin"]) {
      const f = path.join(dir, name);
      try {
        const st = fs.statSync(f);
        if (st.mtimeMs > bestMtime) {
          bestMtime = st.mtimeMs;
          best = dir;
        }
      } catch {
        /* missing */
      }
    }
  }
  return bestMtime > 0 ? best : existing[0];
}

function detectBridgeDir() {
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
  walkWineCommonFiles(wineUsers, 0, candidates);
  return pickBridgeDir(candidates);
}

function userBridgeConfigPath() {
  return path.join(os.homedir(), "Library", "Application Support", "XauDesk", "bridge-path.txt");
}

function bridgeDirForGateway(cwd, repoRoot) {
  const env = process.env.XAU_BRIDGE_DIR?.trim();
  if (env && fs.existsSync(env)) return env;
  const userCfg = userBridgeConfigPath();
  if (fs.existsSync(userCfg)) {
    const line = fs.readFileSync(userCfg, "utf8").trim();
    if (line && fs.existsSync(line)) return line;
  }
  const fromFile = path.join(cwd, "bridge-path.txt");
  if (fs.existsSync(fromFile)) {
    const line = fs.readFileSync(fromFile, "utf8").trim();
    if (line && fs.existsSync(line)) return line;
  }
  const script = path.join(repoRoot || cwd, "scripts", "print-active-bridge-dir.mjs");
  if (fs.existsSync(script)) {
    try {
      const { spawnSync } = require("node:child_process");
      const r = spawnSync(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
      });
      const line = (r.stdout || "").trim();
      if (line && fs.existsSync(line)) return line;
    } catch {
      /* fallback */
    }
  }
  return detectBridgeDir();
}

let electronApp = null;
try {
  electronApp = require("electron").app;
} catch {
  /* tests */
}

const GATEWAY_PORT = Number(process.env.XAU_GATEWAY_PORT || 5191);
const UI_PORT = Number(process.env.XAU_UI_PORT || 5190);

let gatewayChild = null;

function repoRoot() {
  if (process.env.XAU_DESK_ROOT) return process.env.XAU_DESK_ROOT;
  if (electronApp?.isPackaged) return electronApp.getAppPath();
  const appDir = path.join(__dirname, "..");
  if (fs.existsSync(path.join(appDir, "dist", "index.html"))) return appDir;
  return appDir;
}

function gatewayPaths() {
  if (electronApp?.isPackaged) {
    const dir = path.join(process.resourcesPath, "gateway-mac");
    return { script: path.join(dir, "server.mjs"), cwd: dir };
  }
  const root = repoRoot();
  return { script: path.join(root, "gateway-mac", "server.mjs"), cwd: root };
}

function startGateway() {
  const { script, cwd } = gatewayPaths();
  if (!fs.existsSync(script)) {
    console.warn("[XauDesk] gateway missing:", script);
    return;
  }
  const root = repoRoot();
  const bridgeDir = bridgeDirForGateway(cwd, root);
  const env = {
    ...process.env,
    XAU_EXECUTOR: "mt5-ea",
    XAU_GATEWAY_PORT: String(GATEWAY_PORT),
    ELECTRON_RUN_AS_NODE: "1",
    ...(bridgeDir ? { XAU_BRIDGE_DIR: bridgeDir } : {}),
  };
  gatewayChild = spawn(process.execPath, [script], {
    cwd,
    env,
    stdio: "inherit",
  });
  gatewayChild.on("exit", (code) => {
    console.log("[XauDesk] gateway exited", code);
  });
  const ensureScript = path.join(cwd, "ensure-mt5-bridge.mjs");
  if (process.platform === "darwin" && fs.existsSync(ensureScript)) {
    setTimeout(() => {
      const child = spawn(process.execPath, [ensureScript], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "inherit",
        detached: true,
      });
      child.unref();
    }, 2000);
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function proxyApi(req, res) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: `127.0.0.1:${GATEWAY_PORT}` };
    delete headers.connection;
    const opts = {
      host: "127.0.0.1",
      port: GATEWAY_PORT,
      path: req.url,
      method: req.method,
      headers,
    };
    const up = http.request(opts, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "网关未启动（5191）" }));
    });
    if (body.length) up.write(body);
    up.end();
  });
}

function startUiServer(root) {
  const dist = path.join(root, "dist");
  return http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "/";
    if (url.startsWith("/api")) {
      proxyApi(req, res);
      return;
    }
    let file = path.join(dist, url === "/" ? "index.html" : url);
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const isAsset = url.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(url);
      if (isAsset) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      file = path.join(dist, "index.html");
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end("dist not built");
      return;
    }
    const headers = { "Content-Type": contentType(file) };
    headers["Access-Control-Allow-Origin"] = "*";
    if (url === "/" || url.endsWith(".html")) {
      headers["Cache-Control"] = "no-store";
    }
    if (url.endsWith(".js")) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

function resolveUiRoot() {
  const root = repoRoot();
  if (!electronApp?.isPackaged) return root;
  const resources = process.resourcesPath;
  const appPath = electronApp.getAppPath();
  const unpacked = path.join(path.dirname(appPath), "app.asar.unpacked");
  const candidates = [
    path.join(resources, "app"),
    unpacked,
    resources,
    root,
  ];
  let best = root;
  let bestMtime = 0;
  for (const base of candidates) {
    const idx = path.join(base, "dist", "index.html");
    if (!fs.existsSync(idx)) continue;
    try {
      const m = fs.statSync(idx).mtimeMs;
      if (m >= bestMtime) {
        bestMtime = m;
        best = base;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

function boot() {
  const root = resolveUiRoot();
  process.env.XAU_DESK_ROOT = root;
  startGateway();
  return new Promise((resolve, reject) => {
    const server = startUiServer(root);
    server.listen(UI_PORT, "127.0.0.1", () => {
      console.log(`[XauDesk] UI http://127.0.0.1:${UI_PORT}  root=${root}`);
      resolve({ server, root });
    });
    server.on("error", reject);
  });
}

function shutdown() {
  if (gatewayChild) gatewayChild.kill();
}

module.exports = { boot, shutdown, UI_PORT, GATEWAY_PORT };
