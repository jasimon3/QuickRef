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
let draftKind = 'SOP'; // only meaningful while mode==='edit' && isNewDraft
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
  const nameNow = el('dtitle').value;
  const catSel = el('catSel');
  const platSel = el('platSel');
  const catNow = catSel ? catSel.value : '';
  const platNow = platSel ? platSel.value : '';
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
  render();
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
  draftKind = kind;
  mode = 'edit';
  originalSnapshot = { name: '', category: '', platform: '', bodyHtml: '', tagsJson: '[]' };
  draftTags = [];
  renderList();
  render();
}

async function enterEditMode() {
  await loadAll();
  const e = currentEntry();
  if (!e) return;
  mode = 'edit';
  isNewDraft = false;
  originalSnapshot = {
    name: e.name,
    category: e.category,
    platform: e.platform,
    bodyHtml: e.body_html,
    tagsJson: JSON.stringify(e.tags || [])
  };
  draftTags = [...(e.tags || [])];
  render();
}

async function cancelEdit() {
  if (isNewDraft) {
    await api.discardDraft(selectedId);
    await loadAll();
    selectedId = entries.length ? entries[0].id : null;
    isNewDraft = false;
    mode = 'view';
    renderList();
    render();
    return;
  }
  // Reload before returning to view: this picks up any attachments added or removed during the
  // edit session (those commit immediately and are meant to survive Cancel), while the text/
  // metadata fields themselves are simply never written, since Save was never clicked.
  await loadAll();
  mode = 'view';
  renderList();
  render();
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
  render();
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
  render();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await api.deleteEntry(id);
  await loadAll();
  selectedId = entries.length ? entries[0].id : null;
  mode = 'view';
  renderList();
  render();
}

// ---- tag input widget (wired once; only the displayed chips change) ----
function refreshTagChips() {
  const wrap = el('tagInputWrap');
  wrap.querySelectorAll('.tagchip').forEach((n) => n.remove());
  draftTags.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'tagchip';
    chip.innerHTML = '#' + escapeHtml(t) + ' <span class="tagx">✕</span>';
    chip.querySelector('.tagx').addEventListener('click', () => {
      draftTags = draftTags.filter((x) => x !== t);
      refreshTagChips();
    });
    wrap.insertBefore(chip, el('tagInputField'));
  });
}

function wireTagInputOnce() {
  const input = el('tagInputField');
  function addTag(raw) {
    const t = raw.trim().replace(/^#/, '');
    if (!t || draftTags.includes(t)) return;
    draftTags.push(t);
    refreshTagChips();
    input.value = '';
  }
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      addTag(input.value);
    }
  });
  input.addEventListener('focus', () => {
    el('tagSuggestions').innerHTML = allTags.map((t) => '<option value="' + escapeHtml(t) + '">').join('');
  });
}

// ---- attachments ----
// Renders whatever is currently in `currentFiles`. Deliberately does not touch anything else on
// the page — attaching/removing a file must never re-render the title, editor, or tags, both
// because that would discard unsaved edits and because a brand-new entry has no saved row to
// re-render from yet.
function renderFiles(editable) {
  const container = el('fileList');
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
        renderFiles(editable);
      });
    }
    container.appendChild(row);
  });
}

function wireDropzoneOnce() {
  const zone = el('dz');
  zone.addEventListener('click', () => showToast('Use drag-and-drop to attach a file here.'));
  zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    zone.classList.remove('drag');
    const files = [...ev.dataTransfer.files];
    for (const file of files) {
      const saved = await api.attachFile(selectedId, file); // selectedId read fresh at drop time, always current
      currentFiles.push(saved);
    }
    renderFiles(true);
  });
}

// Any error thrown while updating the detail pane is at least made visible here, rather than
// silently leaving whatever was already on screen half-updated and unresponsive.
function safeRender(fn) {
  try {
    fn();
  } catch (err) {
    console.error('Render failed:', err);
    el('detailEmpty').style.display = '';
    el('entryPane').style.display = 'none';
    el('detailEmpty').innerHTML =
      '<p style="color:var(--danger)">Something went wrong showing this entry.</p>' +
      '<p style="font-family:var(--mono);font-size:11px">' + escapeHtml(err.message || String(err)) + '</p>';
  }
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

function wireTypeSegment() {
  el('segSop').addEventListener('click', () => { el('segSop').className = 'on'; el('segNote').className = ''; });
  el('segNote').addEventListener('click', () => { el('segNote').className = 'on warm'; el('segSop').className = ''; });
}

// ---- toolbar (wired once at startup; see initDetailPaneOnce) ----
function toolbarHtml() {
  return (
    '<select data-heading title="Paragraph style">' +
    '<option value="p">Normal</option><option value="1">Heading 1</option>' +
    '<option value="2">Heading 2</option><option value="3">Heading 3</option>' +
    '</select>' +
    '<select data-size title="Font size">' +
    '<option value="">Size</option><option value="12px">Small</option>' +
    '<option value="18px">Medium</option><option value="24px">Large</option>' +
    '<option value="32px">X-Large</option>' +
    '</select>' +
    '<input type="color" data-color title="Text color" value="#ececec">' +
    '<span class="tsep"></span>' +
    '<button data-cmd="bold" title="Bold"><b>B</b></button>' +
    '<button data-cmd="italic" title="Italic"><i>I</i></button>' +
    '<button data-cmd="underline" title="Underline" style="text-decoration:underline">U</button>' +
    '<button data-cmd="strike" title="Strikethrough" style="text-decoration:line-through">S</button>' +
    '<span class="tsep"></span>' +
    '<button data-cmd="bulletList" title="Bulleted list">•</button>' +
    '<button data-cmd="orderedList" title="Numbered list">1.</button>' +
    '<button data-cmd="blockquote" title="Quote">"</button>' +
    '<button data-cmd="codeBlock" title="Code block">&lt;/&gt;</button>' +
    '<button data-cmd="horizontalRule" title="Divider">—</button>' +
    '<span class="tsep"></span>' +
    '<button data-cmd="undo" title="Undo">↶</button>' +
    '<button data-cmd="redo" title="Redo">↷</button>'
  );
}

function wireToolbarOnce(container) {
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
        case 'blockquote': c.toggleBlockquote().run(); break;
        case 'codeBlock': c.toggleCodeBlock().run(); break;
        case 'horizontalRule': c.setHorizontalRule().run(); break;
        case 'undo': c.undo().run(); break;
        case 'redo': c.redo().run(); break;
      }
    });
  });
  const headingSel = container.querySelector('select[data-heading]');
  headingSel.addEventListener('change', () => {
    const v = headingSel.value;
    const c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run();
    else c.toggleHeading({ level: Number(v) }).run();
  });
  const sizeSel = container.querySelector('select[data-size]');
  sizeSel.addEventListener('change', () => {
    const c = editor.chain().focus();
    if (sizeSel.value) c.setFontSize(sizeSel.value).run();
    else c.unsetFontSize().run();
  });
  const colorInput = container.querySelector('input[data-color]');
  colorInput.addEventListener('input', () => {
    editor.chain().focus().setColor(colorInput.value).run();
  });
}

// ---- detail pane: set up ONCE at startup ----
// Previously, every switch between entries (or into/out of edit mode) destroyed the TipTap editor
// and rebuilt the ENTIRE pane's HTML from a string, including the title input, toolbar, and save/
// cancel buttons. Doing that twice in quick succession (e.g. starting a new SOP, then immediately
// starting a new Note without saving) is exactly the kind of rapid destroy-and-rebuild cycle that
// can leave a freshly created editor or a freshly rebuilt button not fully wired up — consistent
// with title/editor/Save/Cancel all going unresponsive at once. The editor and all of the detail
// pane's controls are now created exactly once, right here, and every subsequent "render" only
// updates their content/visibility/values — never recreates them.
function initDetailPaneOnce() {
  editor = createEditor(el('editorMount'), { content: '', editable: false });

  el('toolbar').innerHTML = toolbarHtml();
  wireToolbarOnce(el('toolbar'));

  el('pinBtn').addEventListener('click', () => {
    const e = currentEntry();
    if (e) togglePin(e);
  });
  el('modifyBtn').addEventListener('click', enterEditMode);
  el('deleteBtn').addEventListener('click', () => {
    const e = currentEntry();
    if (e) deleteEntry(e.id);
  });
  el('saveBtn').addEventListener('click', saveEdit);
  el('cancelBtn').addEventListener('click', cancelEdit);

  wireTagInputOnce();
  wireDropzoneOnce();
}

function showEmptyState() {
  el('detailEmpty').style.display = '';
  el('entryPane').style.display = 'none';
}
function showEntryPane() {
  el('detailEmpty').style.display = 'none';
  el('entryPane').style.display = 'flex';
}

function render() {
  safeRender(renderInner);
}
function renderInner() {
  const e = currentEntry();
  if (mode !== 'edit' && !e) {
    showEmptyState();
    return;
  }
  showEntryPane();
  if (mode === 'edit') renderEditMode(e);
  else renderViewMode(e);
}

function renderViewMode(e) {
  el('dtitleStatic').textContent = e.name;
  el('dtitleStatic').style.display = '';
  el('dtitle').style.display = 'none';

  el('pinBtn').style.display = '';
  el('pinBtn').classList.toggle('pinned', !!e.pinned);

  el('dmetarow').innerHTML =
    '<span class="metatag big">' + e.type + '</span>' +
    (e.category ? '<span class="metatag big">' + escapeHtml(e.category) + '</span>' : '') +
    (e.platform ? '<span class="metatag big">' + escapeHtml(e.platform) + '</span>' : '') +
    (e.tags || []).map((t) => '<span class="metatag big tag">#' + escapeHtml(t) + '</span>').join('');

  el('tagInputWrap').style.display = 'none';
  el('toolbar').style.display = 'none';

  editor.setEditable(false);
  editor.commands.setContent(e.body_html || '');

  currentFiles = e.files.slice();
  renderFiles(false);
  el('dz').style.display = 'none';

  el('modifyBtn').style.display = '';
  el('deleteBtn').style.display = '';
  el('saveBtn').style.display = 'none';
  el('cancelBtn').style.display = 'none';
  el('savedHint').textContent = 'Last updated ' + e.date_updated;
}

function renderEditMode(e) {
  const isDraft = !e;
  const type = isDraft ? draftKind : e.type;
  const name = isDraft ? '' : e.name;
  const category = isDraft ? (categories[0] || '') : e.category;
  const platform = isDraft ? (platforms[0] || '') : e.platform;
  const bodyHtml = isDraft ? '' : e.body_html;

  el('dtitleStatic').style.display = 'none';
  el('dtitle').style.display = '';
  el('dtitle').value = name;
  el('dtitle').placeholder = isDraft ? ('Untitled ' + type) : '';

  el('pinBtn').style.display = isDraft ? 'none' : '';
  if (!isDraft) el('pinBtn').classList.toggle('pinned', !!e.pinned);

  el('dmetarow').innerHTML = metaControlsHtml(type, category, platform);
  wireTypeSegment();

  el('tagInputWrap').style.display = '';
  el('toolbar').style.display = '';

  editor.setEditable(true);
  editor.commands.setContent(bodyHtml || '');

  currentFiles = isDraft ? [] : JSON.parse(JSON.stringify(e.files || []));
  renderFiles(true);
  el('dz').style.display = '';

  el('modifyBtn').style.display = 'none';
  el('deleteBtn').style.display = 'none';
  el('saveBtn').style.display = '';
  el('saveBtn').textContent = isDraft ? '＋ Add entry' : '💾 Save changes';
  el('cancelBtn').style.display = '';
  el('savedHint').textContent = '';

  refreshTagChips();
  if (isDraft) el('dtitle').focus();
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

// ---- All Linked Documents ----
let allDocsSearch = '';
function getAllDocs() {
  const list = [];
  entries.forEach((e) => {
    (e.files || []).forEach((f) => list.push({ entryId: e.id, entryName: e.name, entryType: e.type, fileId: f.id, fileName: f.name }));
  });
  return list;
}
function matchesDocSearch(d, term) {
  if (!term) return true;
  const hay = (d.fileName + ' ' + d.entryName).toLowerCase();
  return term.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}
function renderAllDocs() {
  const all = getAllDocs();
  const rows = all.filter((d) => matchesDocSearch(d, allDocsSearch));
  const box = el('allDocsRows');
  box.innerHTML = '';
  el('allDocsEmpty').style.display = rows.length ? 'none' : '';
  el('allDocsEmpty').textContent = all.length && !rows.length ? 'No documents match your search.' : 'No attachments yet.';
  rows.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'adRow';
    row.innerHTML =
      '<span class="adIcon">' + fileIconFor(d.fileName) + '</span>' +
      '<span class="adName">' + escapeHtml(d.fileName) + '</span>' +
      '<span class="pill' + (d.entryType === 'Note' ? ' note' : '') + '">' + d.entryType + '</span>' +
      '<span class="adEntry">' + escapeHtml(d.entryName) + '</span>';
    row.addEventListener('click', () => api.openFile(d.fileId));
    box.appendChild(row);
  });
}
async function toggleAllDocsOverlay() {
  const overlay = el('allDocsOverlay');
  const show = overlay.style.display === 'none';
  if (show) {
    await loadAll();
    allDocsSearch = '';
    el('allDocsSearch').value = '';
    renderAllDocs();
  }
  overlay.style.display = show ? 'flex' : 'none';
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---- wiring ----
function updateChipRowVisibility() {
  el('chipRow').style.display = activeFilter === 'all' ? '' : 'none';
}

function wireGlobal() {
  document.querySelectorAll('.rail button[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.rail button[data-filter]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      activeFilter = b.dataset.filter;
      // The chip row (All/SOP/Note) only makes sense within the "All entries" rail section — in
      // the SOP/Notes/Pinned sections it was still clickable but silently did nothing, since the
      // rail filter already took precedence. Hiding it there removes that dead-end control
      // entirely, and resetting it back to "All" means it starts predictably next time you're
      // back in the "All entries" section.
      if (activeFilter !== 'all') {
        activeChip = 'all';
        document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.chip === 'all'));
      }
      updateChipRowVisibility();
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

  el('allDocsRailBtn').addEventListener('click', toggleAllDocsOverlay);
  el('allDocsClose').addEventListener('click', () => { el('allDocsOverlay').style.display = 'none'; });
  el('allDocsSearch').addEventListener('input', () => {
    allDocsSearch = el('allDocsSearch').value.trim().toLowerCase();
    renderAllDocs();
  });

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
  initDetailPaneOnce();
  showBuildInfo();
  await waitForReady();
  el('loadingOverlay').classList.add('hide');
  await showBuildInfo(); // dataDir isn't known until startup finishes; refresh once it's ready
  await loadAll();
  selectedId = entries.length ? entries[0].id : null;
  renderList();
  render();
}

init();
