const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function uid() {
  return crypto.randomBytes(6).toString('hex');
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function registerIpcHandlers({ ipcMain, dialog, shell, db, dataDir }) {
  const docsDir = path.join(dataDir, 'Documents');

  function getTagsForEntry(entryId) {
    return db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN entry_tags et ON et.tag_id = t.id
         WHERE et.entry_id = ? ORDER BY t.name COLLATE NOCASE`
      )
      .all(entryId)
      .map((r) => r.name);
  }
  function getFilesForEntry(entryId) {
    return db
      .prepare('SELECT id, filename, original_name AS name, size FROM files WHERE entry_id = ?')
      .all(entryId);
  }
  function setTagsForEntry(entryId, tagNames) {
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
    const findOrCreate = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getId = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
    const link = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
    (tagNames || []).forEach((raw) => {
      const name = String(raw).trim();
      if (!name) return;
      findOrCreate.run(name);
      const row = getId.get(name);
      if (row) link.run(entryId, row.id);
    });
  }

  ipcMain.handle('entries:list', () => {
    const rows = db.prepare('SELECT * FROM entries ORDER BY sort_order ASC, date_updated DESC').all();
    return rows.map((e) => ({
      ...e,
      pinned: !!e.pinned,
      tags: getTagsForEntry(e.id),
      files: getFilesForEntry(e.id)
    }));
  });

  ipcMain.handle('entries:save', (evt, entry) => {
    const now = today();
    const id = entry.id || uid(); // renderer supplies an id up front so drafts can hold attachments before the first save
    const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    const nextOrder = existing
      ? existing.sort_order
      : db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM entries').get().n;

    db.prepare(
      `INSERT INTO entries (id, name, type, category, platform, body_html, pinned, date_created, date_updated, sort_order)
       VALUES (@id, @name, @type, @category, @platform, @body_html, @pinned, @date_created, @date_updated, @sort_order)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, type=excluded.type, category=excluded.category, platform=excluded.platform,
         body_html=excluded.body_html, pinned=excluded.pinned, date_updated=excluded.date_updated`
    ).run({
      id,
      name: entry.name,
      type: entry.type,
      category: entry.category || '',
      platform: entry.platform || '',
      body_html: entry.bodyHtml || '',
      pinned: entry.pinned ? 1 : 0,
      date_created: existing ? existing.date_created : now,
      date_updated: now,
      sort_order: nextOrder
    });
    setTagsForEntry(id, entry.tags || []);
    return id;
  });

  ipcMain.handle('entries:delete', (evt, id) => {
    const entryDir = path.join(docsDir, id);
    if (fs.existsSync(entryDir)) fs.rmSync(entryDir, { recursive: true, force: true });
    db.prepare('DELETE FROM files WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    return true;
  });

  // Cleans up a never-saved draft (including any files already dropped onto it) when Cancel is
  // pressed on a brand-new entry.
  ipcMain.handle('entries:discardDraft', (evt, id) => {
    const entryDir = path.join(docsDir, id);
    if (fs.existsSync(entryDir)) fs.rmSync(entryDir, { recursive: true, force: true });
    db.prepare('DELETE FROM files WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('entries:reorder', (evt, orderedIds) => {
    const stmt = db.prepare('UPDATE entries SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((id, i) => stmt.run(i, id));
    return true;
  });

  ipcMain.handle('tags:list', () =>
    db.prepare('SELECT name FROM tags ORDER BY name COLLATE NOCASE').all().map((r) => r.name)
  );

  ipcMain.handle('categories:list', () =>
    db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all().map((r) => r.name)
  );
  ipcMain.handle('categories:add', (evt, name) => {
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(String(name).trim());
    return true;
  });
  ipcMain.handle('categories:remove', (evt, name) => {
    db.prepare('DELETE FROM categories WHERE name = ?').run(name);
    return true;
  });

  ipcMain.handle('platforms:list', () =>
    db.prepare('SELECT name FROM platforms ORDER BY name COLLATE NOCASE').all().map((r) => r.name)
  );
  ipcMain.handle('platforms:add', (evt, name) => {
    db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(String(name).trim());
    return true;
  });
  ipcMain.handle('platforms:remove', (evt, name) => {
    db.prepare('DELETE FROM platforms WHERE name = ?').run(name);
    return true;
  });

  // Attachments commit to disk immediately when dropped (they are not part of the Save/Cancel
  // draft state) — same behavior as the browser version this replaces.
  ipcMain.handle('files:attach', (evt, { entryId, sourcePath, originalName }) => {
    const entryDir = path.join(docsDir, entryId);
    fs.mkdirSync(entryDir, { recursive: true });
    const fileId = uid();
    const safeName = fileId + '_' + path.basename(originalName);
    fs.copyFileSync(sourcePath, path.join(entryDir, safeName));
    const size = fs.statSync(path.join(entryDir, safeName)).size;
    db.prepare('INSERT INTO files (id, entry_id, filename, original_name, size) VALUES (?,?,?,?,?)').run(
      fileId,
      entryId,
      safeName,
      originalName,
      size
    );
    return { id: fileId, name: originalName, size };
  });

  ipcMain.handle('files:remove', (evt, fileId) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (f) {
      const p = path.join(docsDir, f.entry_id, f.filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    }
    return true;
  });

  // Opens the file with whatever application the OS has associated with it — the thing the
  // browser version could never fully do.
  ipcMain.handle('files:open', (evt, fileId) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!f) return { ok: false, error: 'File not found' };
    const p = path.join(docsDir, f.entry_id, f.filename);
    if (!fs.existsSync(p)) return { ok: false, error: 'File missing from disk' };
    const err = shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('files:reveal', (evt, fileId) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!f) return false;
    shell.showItemInFolder(path.join(docsDir, f.entry_id, f.filename));
    return true;
  });

  ipcMain.handle('dialog:pickDataFolder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });
}

module.exports = { registerIpcHandlers };
