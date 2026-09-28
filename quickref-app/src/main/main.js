const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getDataDir, setDataDir, defaultDataDir } = require('./config');
const { openDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc');

let mainWindow;
let db;

async function ensureDataDir() {
  let dataDir = getDataDir();
  if (!dataDir) {
    const defaultDir = defaultDataDir();
    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Use default folder', 'Choose a folder…'],
      defaultId: 0,
      cancelId: 0,
      title: 'Set up your QuickRef data folder',
      message: 'Where should QuickRef store your notes and documents?',
      detail: 'Default location:\n' + defaultDir
    });
    if (choice.response === 1) {
      const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
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
}

app.whenReady().then(async () => {
  const dataDir = await ensureDataDir();
  db = await openDatabase(path.join(dataDir, 'quickref.db'));
  registerIpcHandlers({ ipcMain, dialog, shell, db, dataDir });

  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:close', () => mainWindow && mainWindow.close());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});
