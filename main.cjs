const { app, BrowserWindow, nativeImage } = require("electron");
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
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  let tries = 0;
  const tryLoad = () => {
    if (!mainWindow) return;
    tries += 1;
    void mainWindow.loadURL(APP_URL);
  };
  mainWindow.webContents.on("did-fail-load", (_ev, _code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || !mainWindow) return;
    if (tries < LOAD_MAX_TRIES) {
      setTimeout(tryLoad, LOAD_RETRY_MS);
    }
  });
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  shutdown();
});

app.on("window-all-closed", () => {
  app.quit();
});
