const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// sql.js is SQLite compiled to WebAssembly: pure JavaScript + a .wasm file, no native binary to
// compile. That matters here specifically because it means no C++ build toolchain and no admin
// rights are ever needed to install it — unlike a native module (e.g. better-sqlite3), which can
// require compiling C++ code on install if no prebuilt binary matches the machine exactly.
//
// The trade-off: sql.js runs entirely in memory. We load the whole file into memory once at
// startup, and explicitly re-export and rewrite the whole file to disk after every change. That's
// completely fine at this app's scale — attached files live as real files in Documents/, never in
// the database, so the database itself stays small (text and metadata only).

let SQL = null;
let rawDb = null;
let dbFilePath = null;

function toBindParams(args) {
  // ipc.js calls things like .run({ id, name, ... }) for the big upsert, and .all(entryId) for
  // simple positional lookups. sql.js needs named params' object keys to include the same sigil
  // (@name) used in the SQL text, so a plain-object single argument gets converted here; a
  // positional argument list is passed straight through as an array for the `?` placeholders.
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const out = {};
    for (const k in args[0]) out['@' + k] = args[0][k];
    return out;
  }
  return args;
}

// A single logical action (e.g. discarding a draft, or setting an entry's tags) can involve
// several SQL statements in a row. Persisting synchronously after every single one meant several
// full-database export-and-write cycles for one user action — on a machine where antivirus scans
// each file write (the likely explanation for the ~20s first launch), that compounds into a real,
// noticeable stall. This debounces writes into one, a short moment after the last statement in a
// batch, while still guaranteeing a final flush happens when the app closes (see db.close below).
let persistTimer = null;
function persistNow() {
  const data = rawDb.export();
  fs.writeFileSync(dbFilePath, Buffer.from(data));
}
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 150);
}

// A small compatibility layer so the rest of the app (ipc.js) can keep using the familiar
// db.prepare(sql).get()/.all()/.run() pattern regardless of which SQLite engine is underneath.
function prepareCompat(sql) {
  return {
    get(...params) {
      const stmt = rawDb.prepare(sql);
      stmt.bind(toBindParams(params));
      let row = null;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row;
    },
    all(...params) {
      const stmt = rawDb.prepare(sql);
      stmt.bind(toBindParams(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    run(...params) {
      const stmt = rawDb.prepare(sql);
      stmt.bind(toBindParams(params));
      stmt.step();
      stmt.free();
      schedulePersist();
      return true;
    }
  };
}

async function openDatabase(dbPath) {
  dbFilePath = dbPath;
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file)
    });
  }
  const fileBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  rawDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('SOP','Note')),
      category TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      body_html TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      date_created TEXT NOT NULL,
      date_updated TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE
    );
    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (entry_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS platforms (
      name TEXT PRIMARY KEY
    );
  `);

  const db = {
    prepare: prepareCompat,
    exec: (sql) => rawDb.exec(sql),
    // Called on app quit: flush immediately rather than waiting for the debounce timer, so a quick
    // close right after an edit can't lose that last change.
    close: () => {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      persistNow();
    }
  };

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const insert = db.prepare('INSERT INTO categories (name) VALUES (?)');
    ['QC', 'Production'].forEach((c) => insert.run(c));
  }
  const platCount = db.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
  if (platCount === 0) {
    const insert = db.prepare('INSERT INTO platforms (name) VALUES (?)');
    ['Relativity', 'Nebula', 'EDR', 'Producer'].forEach((p) => insert.run(p));
  }

  persistNow(); // make sure a real database file exists on disk immediately, even before the first edit

  return db;
}

module.exports = { openDatabase };
