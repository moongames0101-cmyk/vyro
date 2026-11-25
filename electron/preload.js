const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vyroDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('vyro:win-min'),
  maximize: () => ipcRenderer.send('vyro:win-max'),
  close: () => ipcRenderer.send('vyro:win-close'),
  checkForUpdates: () => ipcRenderer.send('vyro:check-updates'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('vyro:update-status', (_event, payload) => cb(payload));
  }
});
