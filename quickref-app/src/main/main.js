const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

// A common, well-established fix for Electron taking unusually long to show any window at all on
// virtualized/locked-down machines, where GPU acceleration can be broken, intercepted by security
// software, or simply unavailable — costs nothing if that's not what's happening here.
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const { getDataDir, setDataDir, defaultDataDir } = require('./config');
const { openDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc');

let mainWindow;
let db;

// Polled by the renderer (see preload's getStartupStatus / app.js's waitForReady) so the loading
// screen can show real progress. Polling — rather than only a one-way push event — means there's
// no race where the renderer finishes loading a moment after the "ready" event already fired and
// misses it forever; the very first poll always reflects the true current state.
let startupState = { ready: false, message: 'Starting QuickRef…', percent: 5 };
function setStartupState(message, percent) {
  startupState = { ready: false, message, percent };
  if (mainWindow) mainWindow.webContents.send('startup:progress', startupState);
}

async function ensureDataDir(parentWindow) {
  let dataDir = getDataDir();
  if (!dataDir) {
    const defaultDir = defaultDataDir();
    const choice = await dialog.showMessageBox(parentWindow, {
      type: 'question',
      buttons: ['Use default folder', 'Choose a folder…'],
      defaultId: 0,
      cancelId: 0,
      title: 'Set up your QuickRef data folder',
      message: 'Where should QuickRef store your notes and documents?',
      detail: 'Default location:\n' + defaultDir
    });
    if (choice.response === 1) {
      const res = await dialog.showOpenDialog(parentWindow, { properties: ['openDirectory', 'createDirectory'] });
      dataDir = !res.canceled && res.filePaths.length ? res.filePaths[0] : defaultDir;
    } else {
      dataDir = defaultDir;
    }
    setDataDir(dataDir);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'Documents'), { recursive: true });
  return dataDir;
}

function createWindow() {
  // Reverted the earlier show:false/ready-to-show pattern: it's the likely cause of the app
  // appearing minimized/backgrounded after a long wait — Windows has an anti-focus-stealing
  // protection that backgrounds a window if it takes too long to appear after launch, and that
  // pattern delays the actual .show() call. Back to the simple, predictable default.
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: '#14161A',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Guarantees DevTools are reachable regardless of the default menu (frame:false hides it anyway):
  // press F12 or Ctrl+Shift+I any time to see the real console error behind an "app looks frozen"
  // report — the single fastest way to turn a guess into an actual fix.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isDevToolsShortcut =
      input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I');
    if (isDevToolsShortcut) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(async () => {
  // Registered before the window even loads, so the renderer's very first poll (whenever it
  // happens to run) always gets a real answer instead of "handler not found yet".
  ipcMain.handle('startup:status', () => startupState);
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:close', () => mainWindow && mainWindow.close());

  // The window (and its loading screen) now appears immediately — the slow setup work below used
  // to run before this line, which is why nothing appeared on screen for the whole wait.
  createWindow();

  setStartupState('Setting up your data folder…', 20);
  const dataDir = await ensureDataDir(mainWindow);
  ipcMain.handle('app:dataDir', () => dataDir); // shown in Preferences so the actual storage location is always visible, not just assumed

  setStartupState('Loading your notes…', 55);
  db = await openDatabase(path.join(dataDir, 'quickref.db'));

  setStartupState('Finishing up…', 85);
  registerIpcHandlers({ ipcMain, dialog, shell, db, dataDir });

  startupState = { ready: true, message: 'Ready', percent: 100 };
  if (mainWindow) mainWindow.webContents.send('startup:progress', startupState);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});
