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
let autoUpdater = null;

try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
const trayPngPath = path.join(__dirname, '..', 'assets', 'icon-192.png');

function sendUpdateStatus(message, kind = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vyro:update-status', { message, kind });
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

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: workArea.width || 1440,
    height: workArea.height || 900,
    minWidth: 390,
    minHeight: 620,
    title: 'VYRO',
    icon: iconPath,
    frame: false,
    show: false,
    backgroundColor: '#06060C',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
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
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open VYRO',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
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
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch {
    // Tray optional
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('Checking GitHub Releases for VYRO updates...', 'info');
  });
  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus(`Downloading VYRO v${info.version} from GitHub...`, 'snap');
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('VYRO is up to date!', 'success');
  });
  autoUpdater.on('error', (err) => {
    sendUpdateStatus(`Update check skipped: ${err?.message || 'offline'}`, 'info');
  });
  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdateStatus(`VYRO v${info.version} ready! Restart to apply.`, 'success');
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart & Update Now', 'Later'],
      defaultId: 0,
      title: 'VYRO Update Ready',
      message: `VYRO v${info.version} has been downloaded from GitHub.`,
      detail: 'Restart VYRO now to install the update?'
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
      sendUpdateStatus('Auto-updater activates in packaged GitHub .exe releases.', 'info');
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isMaximized()) mainWindow.maximize();
      mainWindow.show();
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

    setTimeout(() => triggerUpdateCheck(false), 3500);
  });
}

ipcMain.on('vyro:win-min', () => mainWindow?.minimize());
ipcMain.on('vyro:win-max', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('vyro:win-close', () => mainWindow?.close());
ipcMain.on('vyro:check-updates', () => triggerUpdateCheck(true));

app.on('before-quit', async () => {
  isQuitting = true;
  if (vyroServer) {
    await vyroServer.stop().catch(() => {});
  }
});
