const { app, BrowserWindow, nativeImage } = require("electron");

// Wine/Mac 上部分 GPU 路径会导致 Chromium 窗口黑屏
if (process.platform === "darwin") {
  app.disableHardwareAcceleration();
}
const path = require("path");
const { boot, shutdown, UI_PORT } = require("./mac-bootstrap.cjs");

const APP_URL = `http://127.0.0.1:${UI_PORT}/`;
const LOAD_RETRY_MS = 800;
const LOAD_MAX_TRIES = 120;

let mainWindow = null;
let booted = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function setDockIcon() {
  if (process.platform !== "darwin") return;
  const candidates = [
    path.join(__dirname, "..", "build", "icon.icns"),
    path.join(process.resourcesPath || "", "icon.icns"),
  ];
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        app.dock.setIcon(img);
        return;
      }
    } catch {
      /* try next */
    }
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.icns");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "XauDesk · XAUUSD",
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#131722",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  let tries = 0;
  let shown = false;
  const showWhenReady = () => {
    if (!mainWindow || shown) return;
    shown = true;
    mainWindow.show();
  };

  const tryLoad = () => {
    if (!mainWindow) return;
    tries += 1;
    void mainWindow.loadURL(APP_URL);
  };

  mainWindow.webContents.on("did-finish-load", () => {
    showWhenReady();
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_ev, errorCode, errorDesc, _url, isMainFrame) => {
      if (!isMainFrame || !mainWindow) return;
      console.error("[XauDesk] load failed", errorCode, errorDesc, `(try ${tries})`);
      if (tries < LOAD_MAX_TRIES) {
        setTimeout(tryLoad, LOAD_RETRY_MS);
      } else {
        void mainWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            `<body style="background:#131722;color:#d1d4dc;font-family:system-ui;padding:24px">` +
              `<h2>XauDesk 界面加载失败</h2><p>${errorDesc || errorCode}</p>` +
              `<p>请完全退出 XauDesk（Cmd+Q）后重新打开；若仍黑屏，在终端执行：<code>npm run mac:install</code></p></body>`,
          )}`,
        );
        showWhenReady();
      }
    },
  );
  tryLoad();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!booted) {
    await boot();
    booted = true;
  }
  setDockIcon();
  createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!booted) {
        await boot();
        booted = true;
      }
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  shutdown();
});

app.on("window-all-closed", () => {
  app.quit();
});
