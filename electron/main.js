const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session, shell, dialog, screen } = require('electron');
const path = require('node:path');
const { createVyroServer } = require('../server');

// Pin persistent userData across Portable, Installer, and GitHub auto-updated versions
const persistentUserData = path.join(app.getPath('appData'), 'VYRO');
app.setName('VYRO');
app.setPath('userData', persistentUserData);

let mainWindow = null;
let tray = null;
let vyroServer = null;
let serverUrl = '';
let isQuitting = false;
let userUnmaximized = false;
let programmaticChange = false;
let autoUpdater = null;

try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
const trayPngPath = path.join(__dirname, '..', 'assets', 'icon-192.png');

function sendUpdateStatus(payload) {
  const data = typeof payload === 'string' ? { message: payload, kind: 'info' } : payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vyro:update-status', data);
  }
}

async function startEmbeddedServer() {
  const dataDir = path.join(persistentUserData, 'vyro-data');
  const rootDir = path.resolve(__dirname, '..');
  try {
    vyroServer = createVyroServer({ port: 3847, host: '0.0.0.0', dataDir, rootDir });
    const info = await vyroServer.start();
    serverUrl = `http://localhost:${info.port}`;
  } catch {
    vyroServer = createVyroServer({ port: 0, host: '0.0.0.0', dataDir, rootDir });
    const info = await vyroServer.start();
    serverUrl = `http://localhost:${info.port}`;
  }
}

function getActiveDisplay() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return screen.getDisplayMatching(mainWindow.getBounds());
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

function ensureWindowExpanded() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (userUnmaximized || mainWindow.isFullScreen()) return;

  mainWindow.maximize();

  // Verify shortly after DWM transition in case frameless maximize was clipped or skipped
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || userUnmaximized || mainWindow.isFullScreen()) return;
    if (!mainWindow.isMaximized()) {
      mainWindow.maximize();
    }
    const wa = getActiveDisplay().workArea;
    const content = mainWindow.getContentBounds();
    if (Math.abs(content.width - wa.width) > 4 || Math.abs(content.height - wa.height) > 4) {
      programmaticChange = true;
      mainWindow.setBounds(wa);
      mainWindow.maximize();
      setTimeout(() => { programmaticChange = false; }, 150);
    }
  }, 120);
}

function createWindow() {
  const display = getActiveDisplay();
  const wa = display.workArea;
  const normW = Math.min(wa.width, 1280, Math.max(960, Math.round(wa.width * 0.85)));
  const normH = Math.min(wa.height, 820, Math.max(640, Math.round(wa.height * 0.85)));
  const normX = Math.round(wa.x + (wa.width - normW) / 2);
  const normY = Math.round(wa.y + (wa.height - normH) / 2);

  mainWindow = new BrowserWindow({
    x: normX,
    y: normY,
    width: normW,
    height: normH,
    minWidth: 390,
    minHeight: 620,
    title: 'VYRO',
    icon: iconPath,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#04040A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.maximize();
    mainWindow.show();
    ensureWindowExpanded();
  });

  mainWindow.on('maximize', () => {
    userUnmaximized = false;
  });

  mainWindow.on('unmaximize', () => {
    if (!programmaticChange && !mainWindow.isFullScreen()) {
      userUnmaximized = true;
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (!userUnmaximized) {
      ensureWindowExpanded();
    }
  });

  mainWindow.loadURL(serverUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(trayPngPath).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('VYRO — Where Servers Meet Streaks');
    const restoreMainWindow = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      if (!userUnmaximized) ensureWindowExpanded();
      mainWindow.focus();
    };
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open VYRO',
        click: restoreMainWindow
      },
      {
        label: 'Check for GitHub Updates',
        click: () => triggerUpdateCheck(true)
      },
      { type: 'separator' },
      {
        label: 'Quit VYRO',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', restoreMainWindow);
  } catch {
    // Tray optional
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ stage: 'checking', message: 'Checking for VYRO updates...', kind: 'info' });
  });
  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({ stage: 'downloading', version: info.version, percent: 0, message: `Downloading VYRO v${info.version}...`, kind: 'snap' });
  });
  autoUpdater.on('download-progress', (prog) => {
    sendUpdateStatus({ stage: 'downloading', percent: Math.round(prog.percent || 0) });
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ stage: 'up-to-date', message: 'VYRO is up to date!', kind: 'success' });
  });
  autoUpdater.on('error', (err) => {
    sendUpdateStatus({ stage: 'error', message: `Update check skipped: ${err?.message || 'offline'}`, kind: 'info' });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdateStatus({ stage: 'ready', version: info.version, percent: 100, message: `VYRO v${info.version} is ready! Restart to update.`, kind: 'success' });
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart & Update Now', 'Later'],
      defaultId: 0,
      title: 'VYRO Update Ready',
      message: `VYRO v${info.version} has been downloaded.`,
      detail: 'Restart VYRO now to finish updating?'
    });
    if (res.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

function triggerUpdateCheck(manual = false) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) {
      sendUpdateStatus({ stage: 'dev', message: 'Checked GitHub Releases!', kind: 'info' });
    }
    return;
  }
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      if (!userUnmaximized) ensureWindowExpanded();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Grant camera/mic permissions for Snap Studio & Voice Lounges inside localhost VYRO
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (['media', 'audioCapture', 'videoCapture', 'notifications'].includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });

    await startEmbeddedServer();
    createWindow();
    createTray();
    setupAutoUpdater();

    const refitMaximizedWindow = () => {
      if (mainWindow && !mainWindow.isDestroyed() && !userUnmaximized && !mainWindow.isFullScreen()) {
        ensureWindowExpanded();
      }
    };
    screen.on('display-metrics-changed', refitMaximizedWindow);
    screen.on('display-added', refitMaximizedWindow);
    screen.on('display-removed', refitMaximizedWindow);

    setTimeout(() => triggerUpdateCheck(false), 3500);
  });
}

ipcMain.on('vyro:win-min', () => mainWindow?.minimize());
ipcMain.on('vyro:win-max', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    userUnmaximized = false;
    ensureWindowExpanded();
    return;
  }
  if (mainWindow.isMaximized()) {
    userUnmaximized = true;
    mainWindow.unmaximize();
  } else {
    userUnmaximized = false;
    ensureWindowExpanded();
  }
});
ipcMain.on('vyro:win-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
ipcMain.on('vyro:win-close', () => mainWindow?.close());
ipcMain.on('vyro:check-updates', () => triggerUpdateCheck(true));
ipcMain.on('vyro:install-update', () => {
  if (autoUpdater && app.isPackaged) {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (vyroServer) {
    await vyroServer.stop().catch(() => {});
  }
});
