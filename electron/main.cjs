const { app, BrowserWindow } = require("electron");

const APP_URL = "http://127.0.0.1:5190/";
const LOAD_RETRY_MS = 800;
const LOAD_MAX_TRIES = 120;

let mainWindow = null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "XauDesk · XAUUSD",
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
