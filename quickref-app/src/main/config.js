const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Previously this tried to store the config file "next to the portable .exe", using an
// electron-builder-specific environment variable (PORTABLE_EXECUTABLE_DIR) meant to work around
// portable .exe files self-extracting to a temp folder on every launch. That mechanism could never
// be verified in the sandboxed environment this app was written in, and is the leading suspect for
// data appearing to reset between launches — if it wasn't behaving as expected, the app would
// compute a different (temporary) location each time, find no existing config, and start fresh.
//
// Fix: use Electron's own built-in, always-reliable per-user data folder instead. app.getPath
// ('userData') resolves to a genuine OS-standard location (e.g. %APPDATA%\QuickRef on Windows)
// that has nothing to do with how the .exe was packaged or where it happens to run from — it's
// the same mechanism virtually every Electron app relies on for exactly this reason.
function configPath() {
  return path.join(app.getPath('userData'), 'quickref.config.json');
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

// Same reasoning for the suggested default data folder: app.getPath('documents') is Electron's
// standard, always-reliable path to the user's real Documents folder — stable regardless of
// packaging, and a sensible, easy-to-find default a user could also browse to manually.
function defaultDataDir() {
  return path.join(app.getPath('documents'), 'QuickRefData');
}

module.exports = { getDataDir, setDataDir, defaultDataDir, configPath };
