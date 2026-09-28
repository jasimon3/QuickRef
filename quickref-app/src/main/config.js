const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// electron-builder's Windows "portable" target self-extracts to a temp folder on each launch,
// so app.getPath('exe') does NOT point at the real, stable location of the portable .exe.
// electron-builder sets PORTABLE_EXECUTABLE_DIR specifically to work around this — that's the
// folder the config file and data folder should actually live next to.
function baseDir() {
  if (!app.isPackaged) return app.getAppPath(); // dev mode: project root
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
}

function configPath() {
  return path.join(baseDir(), 'quickref.config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function getDataDir() {
  return readConfig().dataDir || null;
}

function setDataDir(dir) {
  const cfg = readConfig();
  cfg.dataDir = dir;
  writeConfig(cfg);
}

function defaultDataDir() {
  return path.join(baseDir(), 'QuickRefData');
}

module.exports = { getDataDir, setDataDir, defaultDataDir, configPath };
