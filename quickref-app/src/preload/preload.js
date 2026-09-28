const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('quickref', {
  // A quick, unambiguous way to confirm you're actually running a freshly built version, rather
  // than guessing from behavior alone — shown in the titlebar and loading screen.
  getVersion: () => ipcRenderer.invoke('app:version'),
  getDataDir: () => ipcRenderer.invoke('app:dataDir'),
  getStartupStatus: () => ipcRenderer.invoke('startup:status'),
  onStartupProgress: (callback) => ipcRenderer.on('startup:progress', (event, data) => callback(data)),

  listEntries: () => ipcRenderer.invoke('entries:list'),
  saveEntry: (entry) => ipcRenderer.invoke('entries:save', entry),
  deleteEntry: (id) => ipcRenderer.invoke('entries:delete', id),
  discardDraft: (id) => ipcRenderer.invoke('entries:discardDraft', id),
  reorderEntries: (ids) => ipcRenderer.invoke('entries:reorder', ids),

  listTags: () => ipcRenderer.invoke('tags:list'),

  listCategories: () => ipcRenderer.invoke('categories:list'),
  addCategory: (name) => ipcRenderer.invoke('categories:add', name),
  removeCategory: (name) => ipcRenderer.invoke('categories:remove', name),

  listPlatforms: () => ipcRenderer.invoke('platforms:list'),
  addPlatform: (name) => ipcRenderer.invoke('platforms:add', name),
  removePlatform: (name) => ipcRenderer.invoke('platforms:remove', name),

  // `file` is a native drag-dropped File object; webUtils.getPathForFile resolves its real path
  // on disk (the modern, documented replacement for the old, now-discouraged file.path).
  attachFile: (entryId, file) => {
    const sourcePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('files:attach', { entryId, sourcePath, originalName: file.name });
  },
  removeFile: (fileId) => ipcRenderer.invoke('files:remove', fileId),
  openFile: (fileId) => ipcRenderer.invoke('files:open', fileId),
  revealFile: (fileId) => ipcRenderer.invoke('files:reveal', fileId),

  pickDataFolder: () => ipcRenderer.invoke('dialog:pickDataFolder'),

  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
