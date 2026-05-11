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
  
  googleLogin:      ()                  => ipcRenderer.invoke('google-login'),
  googleLogout:     ()                  => ipcRenderer.invoke('google-logout'),
  isGoogleAuth:     ()                  => ipcRenderer.invoke('is-google-authenticated'),
  getGoogleEmail:   ()                  => ipcRenderer.invoke('get-google-email'),
  onDataUpdatedFromSync: (cb)           => ipcRenderer.on('data-updated-from-sync', () => cb()),
  onGoogleSyncUpdatedIds: (cb)          => ipcRenderer.on('google-sync-updated-ids', (_, dateStr) => cb(dateStr)),
});
