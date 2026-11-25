const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vyroDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('vyro:win-min'),
  maximize: () => ipcRenderer.send('vyro:win-max'),
  fullscreen: () => ipcRenderer.send('vyro:win-fullscreen'),
  close: () => ipcRenderer.send('vyro:win-close'),
  checkForUpdates: () => ipcRenderer.send('vyro:check-updates'),
  installUpdateNow: () => ipcRenderer.send('vyro:install-update'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('vyro:update-status', (_event, payload) => cb(payload));
  }
});
