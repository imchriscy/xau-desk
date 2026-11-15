/** @file 启动 Mac 网关 + 静态 UI 服务（打包后无 Vite） */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
  const env = {
    ...process.env,
    XAU_EXECUTOR: "mt5-ea",
    XAU_GATEWAY_PORT: String(GATEWAY_PORT),
    ELECTRON_RUN_AS_NODE: "1",
  };
  gatewayChild = spawn(process.execPath, [script], {
    cwd,
    env,
    stdio: "inherit",
  });
  gatewayChild.on("exit", (code) => {
    console.log("[XauDesk] gateway exited", code);
  });
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
      file = path.join(dist, "index.html");
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end("dist not built");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
}

function boot() {
  const root = repoRoot();
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
