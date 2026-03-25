const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDay:          (dateStr)           => ipcRenderer.invoke('load-day', dateStr),
  saveDay:          (dateStr, dayData)  => ipcRenderer.invoke('save-day', dateStr, dayData),
  getConfig:        ()                  => ipcRenderer.invoke('get-config'),
  saveConfig:       (cfg)               => ipcRenderer.invoke('save-config', cfg),
  toggleAlwaysOnTop:()                  => ipcRenderer.invoke('toggle-always-on-top'),
  getAllDates:       ()                  => ipcRenderer.invoke('get-all-dates'),
  minimizeWindow:   ()                  => ipcRenderer.send('minimize-window'),
  closeWindow:      ()                  => ipcRenderer.send('close-window'),
  onConfigLoaded:   (cb)                => ipcRenderer.on('config-loaded', (_, c) => cb(c)),
});
