const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ---------------------------------------------------------------------------
// Paths & defaults
// ---------------------------------------------------------------------------
let dataPath, configPath;

const DEFAULT_CONFIG = {
  globalShortcut: 'CmdOrCtrl+Alt+N',
  accentColor: '#5D100A',
  alwaysOnTop: false,
  windowBounds: { width: 380, height: 480 },
  shortcuts: {
    newNote: 'CmdOrCtrl+N',
    newTodo: 'CmdOrCtrl+T',
    pinWindow: 'CmdOrCtrl+Shift+P',
    callout: 'CmdOrCtrl+/',
    newFollowup: 'CmdOrCtrl+U',
  },
  sectionOrder: ['todos', 'followups', 'notes'],
};

let config = { ...DEFAULT_CONFIG };
let win = null;
let tray = null;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function initPaths() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dataPath = path.join(dir, 'data.json');
  configPath = path.join(dir, 'config.json');
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = {
        ...DEFAULT_CONFIG,
        ...saved,
        shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...(saved.shortcuts || {}) },
      };
    }
  } catch { /* use defaults */ }
}

function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); }
  catch (e) { console.error('config write error', e); }
}

// ---------------------------------------------------------------------------
// Data helpers  (simple JSON file)
// ---------------------------------------------------------------------------
function loadData() {
  try {
    if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

function saveData(data) {
  try { fs.writeFileSync(dataPath, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('data write error', e); }
}

// ---------------------------------------------------------------------------
// Tiny PNG generator (so we don't need any icon files)
// ---------------------------------------------------------------------------
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function generateIcon(hex, size = 16) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const p = row + 1 + x * 4;
      const edge = x === 0 || x === size - 1 || y === 0 || y === size - 1;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
      raw[p + 3] = edge ? 180 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const { width, height } = config.windowBounds || DEFAULT_CONFIG.windowBounds;

  win = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 360,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: config.alwaysOnTop,
    show: false,
    skipTaskbar: false,
    icon: nativeImage.createFromBuffer(generateIcon(config.accentColor, 32)),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'win32') {
    try { win.setBackgroundMaterial('acrylic'); } catch { /* older OS */ }
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send('config-loaded', config);
  });

  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });

  let resizeTimer;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const [w, h] = win.getSize();
        config.windowBounds = { width: w, height: h };
        saveConfig();
      }
    }, 400);
  });
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromBuffer(generateIcon(config.accentColor, 16));
  tray = new Tray(icon);
  updateTrayMenu();
  tray.setToolTip('Glyph');
  tray.on('click', () => toggleWindow());
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { label: 'Always on Top', type: 'checkbox', checked: config.alwaysOnTop, click: (item) => {
      config.alwaysOnTop = item.checked;
      if (win) win.setAlwaysOnTop(item.checked);
      saveConfig();
      if (win) win.webContents.send('config-loaded', config);
    }},
    { type: 'separator' },
    { label: 'Quit Glyph', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) { win.hide(); }
  else { win.show(); win.focus(); }
}

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------
function registerGlobalShortcut() {
  globalShortcut.unregisterAll();
  try {
    const sc = config.globalShortcut || DEFAULT_CONFIG.globalShortcut;
    const ok = globalShortcut.register(sc, () => toggleWindow());
    if (!ok) console.warn('Global shortcut registration failed for', sc);
  } catch (e) { console.error('Global shortcut error:', e); }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function setupIPC() {
  ipcMain.handle('load-day', (_, dateStr) => {
    const data = loadData();
    return data[dateStr] || { notes: [], todos: [], followups: [] };
  });

  ipcMain.handle('save-day', (_, dateStr, dayData) => {
    const data = loadData();
    data[dateStr] = dayData;
    saveData(data);
    return true;
  });

  ipcMain.handle('get-config', () => config);

  ipcMain.handle('save-config', (_, incoming) => {
    const oldShortcut = config.globalShortcut;
    config = {
      ...config,
      ...incoming,
      shortcuts: { ...config.shortcuts, ...(incoming.shortcuts || {}) },
    };
    saveConfig();

    if (incoming.globalShortcut && incoming.globalShortcut !== oldShortcut) {
      registerGlobalShortcut();
    }
    if (incoming.alwaysOnTop !== undefined && win) {
      win.setAlwaysOnTop(incoming.alwaysOnTop);
      updateTrayMenu();
    }
    if (incoming.accentColor && tray) {
      tray.setImage(nativeImage.createFromBuffer(generateIcon(incoming.accentColor, 16)));
    }
    return config;
  });

  ipcMain.handle('toggle-always-on-top', () => {
    config.alwaysOnTop = !config.alwaysOnTop;
    if (win) win.setAlwaysOnTop(config.alwaysOnTop);
    saveConfig();
    updateTrayMenu();
    return config.alwaysOnTop;
  });

  ipcMain.on('minimize-window', () => { if (win) win.hide(); });
  ipcMain.on('close-window', () => { if (win) win.hide(); });

  ipcMain.handle('get-all-dates', () => Object.keys(loadData()).sort());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
if (gotLock) {
  app.on('second-instance', () => {
    if (win) { if (!win.isVisible()) win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    initPaths();
    loadConfig();
    createWindow();
    createTray();
    registerGlobalShortcut();
    setupIPC();
  });

  app.on('window-all-closed', () => { /* keep running in tray */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => { app.isQuitting = true; });
}
