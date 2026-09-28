import { createEditor } from './editor.js';

const api = window.quickref;

const ICONS = {
  pin: '<svg class="pin" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 17v5l1-1v-4z"/><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3z"/></svg>',
  clip: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.4 11.5 12.2 20.7a5 5 0 0 1-7.1-7.1l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg>'
};

const FILE_ICON_MAP = {
  pdf: '📕', doc: '📘', docx: '📘', xls: '📊', xlsx: '📊', csv: '📊',
  ppt: '📙', pptx: '📙', zip: '🗜️', rar: '🗜️',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️',
  mp4: '🎞️', mov: '🎞️', mp3: '🎵', wav: '🎵', txt: '📃'
};
function fileIconFor(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return FILE_ICON_MAP[ext] || '📄';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function el(id) {
  return document.getElementById(id);
}

// ---- state ----
let entries = [];
let categories = [];
let platforms = [];
let allTags = [];
let selectedId = null;
let mode = 'view'; // 'view' | 'edit'
let isNewDraft = false;
let editor = null;
let draftTags = [];
let originalSnapshot = null;
let activeFilter = 'all';
let activeChip = 'all';
let searchTerm = '';
let dragEntryId = null;
// The file list for whatever is currently shown/edited. Kept separate from `entries` so that
// attaching or removing a file only ever needs to redraw the attachment list itself — never the
// whole pane — which matters most for a brand-new, not-yet-saved entry (it has no row in
// `entries` yet, so re-deriving the view from `entries` after a drop would find nothing).
let currentFiles = [];

async function loadAll() {
  [entries, categories, platforms, allTags] = await Promise.all([
    api.listEntries(),
    api.listCategories(),
    api.listPlatforms(),
    api.listTags()
  ]);
}

function currentEntry() {
  return entries.find((e) => e.id === selectedId) || null;
}

// ---- list ----
function passesFilter(e) {
  if (activeFilter === 'pinned') return e.pinned;
  if (activeFilter === 'sop') return e.type === 'SOP';
  if (activeFilter === 'note') return e.type === 'Note';
  if (activeChip === 'sop') return e.type === 'SOP';
  if (activeChip === 'note') return e.type === 'Note';
  return true;
}
function passesSearch(e) {
  if (!searchTerm) return true;
  const hay = [e.name, e.category, e.platform, stripHtml(e.body_html), (e.tags || []).join(' ')]
    .join(' ')
    .toLowerCase();
  return searchTerm.split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function renderList() {
  const box = el('list');
  const rows = entries.filter((e) => passesFilter(e) && passesSearch(e));
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML =
      '<div style="padding:24px 12px;color:var(--muted-2);font-size:12.5px;text-align:center">No entries match. Try a different search or filter.</div>';
    return;
  }
  rows.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'row' + (e.id === selectedId ? ' active' : '');
    row.draggable = true;
    row.innerHTML =
      '<span class="kind-dot ' + (e.type === 'SOP' ? 'sop' : 'note') + '"></span>' +
      '<div class="rowmain">' +
      '<div class="rowtitle"><span class="name">' + escapeHtml(e.name || 'Untitled') + '</span>' + (e.pinned ? ICONS.pin : '') + '</div>' +
      '<div class="rowmeta">' +
      (e.category ? '<span class="metatag">' + escapeHtml(e.category) + '</span>' : '') +
      (e.platform ? '<span class="metatag">' + escapeHtml(e.platform) + '</span>' : '') +
      (e.tags || []).map((t) => '<span class="metatag tag">#' + escapeHtml(t) + '</span>').join('') +
      '</div>' +
      '<div class="rowdate">Updated ' + e.date_updated +
      (e.files.length ? ' &nbsp; <span class="clipcount">' + ICONS.clip + ' ' + e.files.length + '</span>' : '') +
      '</div></div>';
    row.addEventListener('click', () => selectEntry(e.id));
    row.addEventListener('dragstart', () => { dragEntryId = e.id; });
    row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drag-over');
      if (dragEntryId && dragEntryId !== e.id) reorderEntries(dragEntryId, e.id);
    });
    box.appendChild(row);
  });
}

async function reorderEntries(fromId, toId) {
  const fromIdx = entries.findIndex((e) => e.id === fromId);
  const toIdx = entries.findIndex((e) => e.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = entries.splice(fromIdx, 1);
  entries.splice(toIdx, 0, moved);
  dragEntryId = null;
  renderList();
  await api.reorderEntries(entries.map((e) => e.id));
}

// ---- selection / mode switches ----
function isDirty() {
  if (!originalSnapshot) return false;
  const nameNow = el('dtitle') ? el('dtitle').value : '';
  const catNow = el('catSel') ? el('catSel').value : '';
  const platNow = el('platSel') ? el('platSel').value : '';
  const htmlNow = editor ? editor.getHTML() : '';
  const tagsNow = JSON.stringify(draftTags);
  return (
    nameNow !== originalSnapshot.name ||
    catNow !== originalSnapshot.category ||
    platNow !== originalSnapshot.platform ||
    htmlNow !== originalSnapshot.bodyHtml ||
    tagsNow !== originalSnapshot.tagsJson
  );
}

async function selectEntry(id) {
  if (mode === 'edit' && isDirty() && !confirm('Discard unsaved changes?')) return;
  if (mode === 'edit' && isNewDraft) await api.discardDraft(selectedId);
  await loadAll(); // picks up any attachment changes made during a just-left edit session
  selectedId = id;
  mode = 'view';
  isNewDraft = false;
  renderList();
  renderDetail();
}

async function startNewDraft(kind) {
  if (mode === 'edit' && isDirty() && !confirm('Discard unsaved changes?')) return;
  if (mode === 'edit' && isNewDraft) {
    try {
      await api.discardDraft(selectedId);
    } catch (err) {
      console.error('Failed to discard previous draft:', err);
      // Not fatal to starting the new draft — the abandoned draft's files just linger on disk
      // rather than blocking you from continuing.
    }
  }
  selectedId = uid(); // generated up front so drag-and-dropped files have somewhere to land immediately
  isNewDraft = true;
  mode = 'edit';
  renderList();
  renderDetailForDraft(kind);
}

async function enterEditMode() {
  await loadAll();
  const e = currentEntry();
  if (!e) return;
  mode = 'edit';
  draftTags = [...(e.tags || [])];
  renderDetail();
}

async function cancelEdit() {
  if (isNewDraft) {
    await api.discardDraft(selectedId);
    await loadAll();
    selectedId = entries.length ? entries[0].id : null;
    isNewDraft = false;
    mode = 'view';
    renderList();
    renderDetail();
    return;
  }
  // Reload before returning to view: this picks up any attachments added or removed during the
  // edit session (those commit immediately and are meant to survive Cancel), while the text/
  // metadata fields themselves are simply never written, since Save was never clicked.
  await loadAll();
  mode = 'view';
  renderList();
  renderDetail();
}

async function saveEdit() {
  const name = el('dtitle').value.trim();
  if (!name) {
    el('dtitle').focus();
    return;
  }
  const type = el('segSop').classList.contains('on') ? 'SOP' : 'Note';
  const category = el('catSel').value;
  const platform = el('platSel').value;
  const bodyHtml = editor.getHTML();
  const pinned = currentEntry() ? currentEntry().pinned : false;

  await api.saveEntry({
    id: selectedId,
    name,
    type,
    category,
    platform,
    bodyHtml,
    pinned,
    tags: draftTags
  });
  await loadAll();
  isNewDraft = false;
  mode = 'view';
  renderList();
  renderDetail();
}

async function togglePin(e) {
  await api.saveEntry({
    id: e.id,
    name: e.name,
    type: e.type,
    category: e.category,
    platform: e.platform,
    bodyHtml: e.body_html,
    pinned: !e.pinned,
    tags: e.tags
  });
  await loadAll();
  renderList();
  renderDetail();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await api.deleteEntry(id);
  await loadAll();
  selectedId = entries.length ? entries[0].id : null;
  mode = 'view';
  renderList();
  renderDetail();
}

// ---- tag input widget ----
function renderTagChips(container, tags, onRemove) {
  container.querySelectorAll('.tagchip').forEach((n) => n.remove());
  tags.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'tagchip';
    chip.innerHTML = '#' + escapeHtml(t) + ' <span class="tagx">✕</span>';
    chip.querySelector('.tagx').addEventListener('click', () => onRemove(t));
    container.insertBefore(chip, container.querySelector('.tagInputField'));
  });
}

function wireTagInput() {
  const wrap = el('tagInputWrap');
  const input = el('tagInputField');
  const datalist = el('tagSuggestions');
  datalist.innerHTML = allTags.map((t) => '<option value="' + escapeHtml(t) + '">').join('');

  function removeTag(t) {
    draftTags = draftTags.filter((x) => x !== t);
    renderTagChips(wrap, draftTags, removeTag);
  }
  function addTag(raw) {
    const t = raw.trim().replace(/^#/, '');
    if (!t || draftTags.includes(t)) return;
    draftTags.push(t);
    renderTagChips(wrap, draftTags, removeTag);
    input.value = '';
  }
  renderTagChips(wrap, draftTags, removeTag);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      addTag(input.value);
    }
  });
}

// ---- attachments ----
// Renders whatever is currently in `currentFiles`. Deliberately does not touch anything else on
// the page — attaching/removing a file must never re-render the title, editor, or tags, both
// because that would discard unsaved edits and because a brand-new entry has no saved row to
// re-render from yet.
function renderFiles(container, editable) {
  container.innerHTML = currentFiles.length
    ? ''
    : '<div style="color:var(--muted-2);font-size:11.5px">No files attached yet.</div>';
  currentFiles.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'filerow';
    row.innerHTML =
      '<span class="ficon">' + fileIconFor(f.name) + '</span><span class="fname">' + escapeHtml(f.name) + '</span>' +
      (editable ? '<span class="fx" title="Remove">✕</span>' : '');
    row.querySelector('.fname').addEventListener('click', () => api.openFile(f.id));
    row.querySelector('.ficon').addEventListener('click', () => api.openFile(f.id));
    if (editable) {
      row.querySelector('.fx').addEventListener('click', async () => {
        await api.removeFile(f.id);
        currentFiles = currentFiles.filter((x) => x.id !== f.id);
        renderFiles(container, editable);
      });
    }
    container.appendChild(row);
  });
}

function wireDropzone(zone, entryId) {
  zone.addEventListener('click', () => showToast('Use drag-and-drop to attach a file here.'));
  zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    zone.classList.remove('drag');
    const files = [...ev.dataTransfer.files];
    for (const file of files) {
      const saved = await api.attachFile(entryId, file);
      currentFiles.push(saved);
    }
    renderFiles(el('fileList'), true);
  });
}

// Any error thrown while building the detail pane used to leave whatever was already in
// box.innerHTML on screen, fully un-wired (no click handlers attached) — which looks exactly like
// a frozen app: visible, but nothing responds. This wraps every render entry point so an error is
// at least visible and the pane recovers to a known state instead of silently breaking.
function safeRender(fn) {
  try {
    fn();
  } catch (err) {
    console.error('Render failed:', err);
    el('detail').innerHTML =
      '<div class="empty"><p style="color:var(--danger)">Something went wrong showing this entry.</p>' +
      '<p style="font-family:var(--mono);font-size:11px">' + escapeHtml(err.message || String(err)) + '</p></div>';
  }
}

function destroyEditor() {
  // Destroy the old editor while its DOM node is still live, BEFORE replacing box.innerHTML —
  // doing it after (the previous order) tears the node out from under it first.
  if (editor) { editor.destroy(); editor = null; }
}

// ---- detail: view mode ----
function renderDetail() {
  safeRender(renderDetailInner);
}
function renderDetailInner() {
  const box = el('detail');
  const e = currentEntry();
  if (!e) {
    destroyEditor();
    box.innerHTML =
      '<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h13l3 3v13H4z"/><path d="M4 4v13h13"/></svg>' +
      '<p>Nothing selected. Choose an entry on the left, or create a new SOP or note to get started.</p></div>';
    return;
  }
  if (mode === 'edit') return renderDetailEdit(e);

  destroyEditor();
  box.innerHTML =
    '<div class="dheader">' +
    '<div class="dtitlerow"><span class="dtitle-static">' + escapeHtml(e.name) + '</span>' +
    '<button class="pinbtn' + (e.pinned ? ' pinned' : '') + '" id="pinBtn">' + ICONS.pin + '</button></div>' +
    '<div class="dmetarow">' +
    '<span class="metatag big">' + e.type + '</span>' +
    (e.category ? '<span class="metatag big">' + escapeHtml(e.category) + '</span>' : '') +
    (e.platform ? '<span class="metatag big">' + escapeHtml(e.platform) + '</span>' : '') +
    (e.tags || []).map((t) => '<span class="metatag big tag">#' + escapeHtml(t) + '</span>').join('') +
    '</div></div>' +
    '<div class="body-row"><div class="editor readonly" id="editorMount"></div>' +
    '<div class="attach"><h4>Attachments</h4><div id="fileList"></div></div></div>' +
    '<div class="dfooter"><button class="btn primary" id="modifyBtn">Modify</button>' +
    '<button class="btn ghost" id="deleteBtn">Delete</button>' +
    '<span class="savedhint">Last updated ' + e.date_updated + '</span></div>';

  editor = createEditor(el('editorMount'), { content: e.body_html, editable: false });

  currentFiles = e.files.slice();
  renderFiles(el('fileList'), false);
  el('pinBtn').addEventListener('click', () => togglePin(e));
  el('modifyBtn').addEventListener('click', enterEditMode);
  el('deleteBtn').addEventListener('click', () => deleteEntry(e.id));
}

function metaControlsHtml(type, category, platform) {
  return (
    '<div class="seg"><button id="segSop" class="' + (type === 'SOP' ? 'on' : '') + '">SOP</button>' +
    '<button id="segNote" class="' + (type === 'Note' ? 'on warm' : '') + '">Note</button></div>' +
    '<select id="catSel" class="msel">' +
    categories.map((c) => '<option' + (c === category ? ' selected' : '') + '>' + escapeHtml(c) + '</option>').join('') +
    '</select>' +
    '<select id="platSel" class="msel">' +
    platforms.map((p) => '<option' + (p === platform ? ' selected' : '') + '>' + escapeHtml(p) + '</option>').join('') +
    '</select>'
  );
}

function toolbarHtml() {
  return (
    '<button data-cmd="bold" title="Bold"><b>B</b></button>' +
    '<button data-cmd="italic" title="Italic"><i>I</i></button>' +
    '<button data-cmd="underline" title="Underline" style="text-decoration:underline">U</button>' +
    '<button data-cmd="strike" title="Strikethrough" style="text-decoration:line-through">S</button>' +
    '<span class="tsep"></span>' +
    '<button data-cmd="bulletList" title="Bulleted list">•</button>' +
    '<button data-cmd="orderedList" title="Numbered list">1.</button>'
  );
}

function wireToolbar(container) {
  container.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = editor.chain().focus();
      switch (b.dataset.cmd) {
        case 'bold': c.toggleBold().run(); break;
        case 'italic': c.toggleItalic().run(); break;
        case 'underline': c.toggleUnderline().run(); break;
        case 'strike': c.toggleStrike().run(); break;
        case 'bulletList': c.toggleBulletList().run(); break;
        case 'orderedList': c.toggleOrderedList().run(); break;
      }
    });
  });
}

function wireTypeSegment() {
  el('segSop').addEventListener('click', () => { el('segSop').className = 'on'; el('segNote').className = ''; });
  el('segNote').addEventListener('click', () => { el('segNote').className = 'on warm'; el('segSop').className = ''; });
}

function renderDetailEdit(e) {
  const box = el('detail');
  originalSnapshot = {
    name: e.name,
    category: e.category,
    platform: e.platform,
    bodyHtml: e.body_html,
    tagsJson: JSON.stringify(e.tags || [])
  };
  draftTags = [...(e.tags || [])];

  destroyEditor();
  box.innerHTML =
    '<div class="dheader">' +
    '<div class="dtitlerow"><input class="dtitle" id="dtitle" value="' + escapeHtml(e.name) + '"></div>' +
    '<div class="dmetarow">' + metaControlsHtml(e.type, e.category, e.platform) + '</div>' +
    '<div class="tagInputWrap" id="tagInputWrap"><input class="tagInputField" id="tagInputField" list="tagSuggestions" placeholder="Add a tag and press Enter"><datalist id="tagSuggestions"></datalist></div>' +
    '</div>' +
    '<div class="toolbar">' + toolbarHtml() + '</div>' +
    '<div class="body-row"><div class="editor" id="editorMount"></div>' +
    '<div class="attach"><h4>Attachments</h4><div class="dropzone" id="dz">Drag a file here to attach</div><div id="fileList"></div></div></div>' +
    '<div class="dfooter"><button class="btn primary" id="saveBtn">Save changes</button>' +
    '<button class="btn ghost" id="cancelBtn">Cancel</button></div>';

  editor = createEditor(el('editorMount'), { content: e.body_html, editable: true });

  wireToolbar(document.querySelector('.toolbar'));
  wireTypeSegment();
  wireTagInput();
  currentFiles = JSON.parse(JSON.stringify(e.files || []));
  renderFiles(el('fileList'), true);
  wireDropzone(el('dz'), e.id);

  el('saveBtn').addEventListener('click', saveEdit);
  el('cancelBtn').addEventListener('click', cancelEdit);
}

function renderDetailForDraft(kind) {
  safeRender(() => renderDetailForDraftInner(kind));
}
function renderDetailForDraftInner(kind) {
  const box = el('detail');
  originalSnapshot = { name: '', category: '', platform: '', bodyHtml: '', tagsJson: '[]' };
  draftTags = [];

  destroyEditor();
  box.innerHTML =
    '<div class="dheader">' +
    '<div class="dtitlerow"><input class="dtitle" id="dtitle" placeholder="Untitled ' + kind + '" autofocus></div>' +
    '<div class="dmetarow">' + metaControlsHtml(kind, categories[0] || '', platforms[0] || '') + '</div>' +
    '<div class="tagInputWrap" id="tagInputWrap"><input class="tagInputField" id="tagInputField" list="tagSuggestions" placeholder="Add a tag and press Enter"><datalist id="tagSuggestions"></datalist></div>' +
    '</div>' +
    '<div class="toolbar">' + toolbarHtml() + '</div>' +
    '<div class="body-row"><div class="editor" id="editorMount"></div>' +
    '<div class="attach"><h4>Attachments</h4><div class="dropzone" id="dz">Drag a file here to attach</div><div id="fileList"></div></div></div>' +
    '<div class="dfooter"><button class="btn primary" id="saveBtn">Add entry</button>' +
    '<button class="btn ghost" id="cancelBtn">Cancel</button></div>';

  editor = createEditor(el('editorMount'), { content: '', editable: true });

  wireToolbar(document.querySelector('.toolbar'));
  wireTypeSegment();
  wireTagInput();
  currentFiles = [];
  renderFiles(el('fileList'), true);
  wireDropzone(el('dz'), selectedId);

  el('saveBtn').addEventListener('click', saveEdit);
  el('cancelBtn').addEventListener('click', cancelEdit);
  el('dtitle').focus();
}

// ---- preferences panel ----
function renderPrefLists() {
  const catBox = el('catList');
  catBox.innerHTML = '';
  categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'prefitem';
    row.innerHTML = '<span>' + escapeHtml(c) + '</span><span class="px">✕</span>';
    row.querySelector('.px').addEventListener('click', async () => {
      await api.removeCategory(c);
      await loadAll();
      renderPrefLists();
    });
    catBox.appendChild(row);
  });
  const platBox = el('platList');
  platBox.innerHTML = '';
  platforms.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'prefitem';
    row.innerHTML = '<span>' + escapeHtml(p) + '</span><span class="px">✕</span>';
    row.querySelector('.px').addEventListener('click', async () => {
      await api.removePlatform(p);
      await loadAll();
      renderPrefLists();
    });
    platBox.appendChild(row);
  });
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---- wiring ----
function wireGlobal() {
  document.querySelectorAll('.rail button[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.rail button[data-filter]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      activeFilter = b.dataset.filter;
      renderList();
    })
  );
  document.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      activeChip = b.dataset.chip;
      renderList();
    })
  );
  el('search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderList();
  });
  el('newSop').addEventListener('click', () => startNewDraft('SOP'));
  el('newNote').addEventListener('click', () => startNewDraft('Note'));
  el('themeBtn').addEventListener('click', () => document.body.classList.toggle('light'));
  el('winMin').addEventListener('click', () => api.minimize());
  el('winClose').addEventListener('click', () => api.close());

  el('prefsRailBtn').addEventListener('click', () => {
    el('prefsOverlay').style.display = 'flex';
    renderPrefLists();
  });
  el('prefsClose').addEventListener('click', () => { el('prefsOverlay').style.display = 'none'; });
  el('catAdd').addEventListener('click', async () => {
    const v = el('catNew').value.trim();
    if (!v) return;
    await api.addCategory(v);
    el('catNew').value = '';
    await loadAll();
    renderPrefLists();
  });
  el('platAdd').addEventListener('click', async () => {
    const v = el('platNew').value.trim();
    if (!v) return;
    await api.addPlatform(v);
    el('platNew').value = '';
    await loadAll();
    renderPrefLists();
  });
}

function updateLoadingUI(status) {
  el('loadingMsg').textContent = status.message || 'Loading…';
  el('loadingBarFill').style.width = Math.max(5, status.percent || 5) + '%';
}

// Polling is the reliable choice here over only listening for a one-shot "ready" push event: if
// the main process finished its setup a moment before this code even started running, a pure push
// event would already be gone and never received. The first poll always reflects the true current
// state, so there's no window where this can hang waiting for something that already happened.
async function waitForReady() {
  api.onStartupProgress((status) => updateLoadingUI(status));
  while (true) {
    const status = await api.getStartupStatus();
    updateLoadingUI(status);
    if (status.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function showBuildInfo() {
  // Answers "am I actually running the new build?" at a glance, and "where is my data really
  // going?" without digging through folders — both shown immediately, not tucked away.
  try {
    const version = await api.getVersion();
    el('titlebarName').textContent = 'QuickRef · v' + version;
    el('loadingVersion').textContent = 'v' + version;
    el('prefVersion').textContent = version;
  } catch (err) { /* non-critical */ }
  try {
    const dataDir = await api.getDataDir();
    el('prefDataDir').textContent = dataDir || '—';
  } catch (err) { /* non-critical */ }
}

async function init() {
  wireGlobal();
  showBuildInfo();
  await waitForReady();
  el('loadingOverlay').classList.add('hide');
  await showBuildInfo(); // dataDir isn't known until startup finishes; refresh once it's ready
  await loadAll();
  selectedId = entries.length ? entries[0].id : null;
  renderList();
  renderDetail();
}

init();
