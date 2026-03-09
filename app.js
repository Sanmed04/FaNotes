/**
 * Notas — Editor de notas con bloques, dibujo, export PDF y resúmenes
 * Resúmenes generados con Gemini API.
 */

const STORAGE_KEY = 'notas-app';
const STORAGE_NOTES = 'notas-data';
const STORAGE_FOLDERS = 'notas-folders';
const STORAGE_SUMMARIES = 'notas-summaries';
const AUTH_TOKEN_KEY = 'notas-token';
const API_BASE = ''; // mismo origen en Railway (front y API en el mismo servidor)

// Estado
let state = {
  notes: [],
  folders: [],
  summaries: [],
  currentNoteId: null,
  currentFolderId: null,
  drawMode: false
};

// DOM
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const noteList = document.getElementById('noteList');
const folderList = document.getElementById('folderList');
const summaryList = document.getElementById('summaryList');
const pagesContainer = document.getElementById('pagesContainer');
const openMenuBtn = document.getElementById('openMenuBtn');
const noteTitle = document.getElementById('noteTitle');
const noteFolder = document.getElementById('noteFolder');
const fontSizeSelect = document.getElementById('fontSize');
const textColorInput = document.getElementById('textColor');
const highlightColorInput = document.getElementById('highlightColor');
const summaryModal = document.getElementById('summaryModal');
const summaryContent = document.getElementById('summaryContent');
const closeSummaryModal = document.getElementById('closeSummaryModal');
const authScreen = document.getElementById('authScreen');
const appMain = document.getElementById('appMain');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const authSwitch = document.getElementById('authSwitch');
const userEmailEl = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');

// ——— API y auth ———
function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}
function setToken(t) {
  if (t) localStorage.setItem(AUTH_TOKEN_KEY, t);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch((API_BASE || '') + path, { ...options, headers });
  return res;
}
async function loadUserAndData() {
  const r = await apiFetch('/api/me');
  if (!r.ok) {
    setToken(null);
    return false;
  }
  const { user } = await r.json();
  if (userEmailEl) userEmailEl.textContent = user.email;
  const [notesRes, foldersRes, summariesRes] = await Promise.all([
    apiFetch('/api/notes'),
    apiFetch('/api/folders'),
    apiFetch('/api/summaries')
  ]);
  if (notesRes.ok) {
    const list = await notesRes.json();
    state.notes = list.map(n => ({
      id: n.id,
      title: n.title,
      folderId: n.folderId || null,
      pages: n.pages || [{ boxes: [], bodyHtml: '' }],
      pageDrawingData: n.pageDrawingData || {}
    }));
  }
  if (foldersRes.ok) state.folders = await foldersRes.json();
  if (summariesRes.ok) {
    const list = await summariesRes.json();
    state.summaries = list.map(s => ({
      id: s.id,
      noteId: s.noteId,
      noteTitle: s.noteTitle,
      sections: s.sections || []
    }));
  }
  return true;
}
function showApp() {
  if (authScreen) authScreen.classList.add('hidden');
  if (appMain) appMain.style.display = 'flex';
  const hasToken = !!getToken();
  if (userEmailEl) userEmailEl.style.display = hasToken ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = hasToken ? '' : 'none';
}
function showAuth() {
  if (authScreen) authScreen.classList.remove('hidden');
  if (appMain) appMain.style.display = 'none';
}

let authMode = 'login';
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const email = (authEmail && authEmail.value) || '';
  const password = (authPassword && authPassword.value) || '';
  if (!email || !password) {
    authError.textContent = 'Email y contraseña requeridos';
    return;
  }
  authSubmit.disabled = true;
  try {
    const path = authMode === 'login' ? '/auth/login' : '/auth/register';
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ email, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authError.textContent = data.error || 'Error';
      return;
    }
    setToken(data.token);
    const ok = await loadUserAndData();
    if (ok) {
      showApp();
      renderFolderList();
      renderNoteList();
      renderSummaryList();
      renderFolderOptions();
      if (state.notes.length > 0) openNote(state.notes[0].id);
      else createNote();
    }
  } finally {
    authSubmit.disabled = false;
  }
});
authSwitch.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  authSubmit.textContent = authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  authSwitch.textContent = authMode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta';
  authError.textContent = '';
});
if (logoutBtn) logoutBtn.addEventListener('click', () => {
  setToken(null);
  loadState();
  showAuth();
  authMode = 'login';
  authSubmit.textContent = 'Iniciar sesión';
  authSwitch.textContent = 'Crear cuenta';
});
const authSkip = document.getElementById('authSkip');
if (authSkip) authSkip.addEventListener('click', () => {
  loadState();
  showApp();
  initApp();
});

// ——— Utilidades ———
function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadState() {
  try {
    const notes = localStorage.getItem(STORAGE_NOTES);
    const folders = localStorage.getItem(STORAGE_FOLDERS);
    const summaries = localStorage.getItem(STORAGE_SUMMARIES);
    if (notes) state.notes = JSON.parse(notes);
    if (folders) state.folders = JSON.parse(folders);
    if (summaries) state.summaries = JSON.parse(summaries);
    state.notes.forEach(note => {
      if (note.blocks && !note.pages) {
        let y = 40;
        note.pages = [{
          boxes: (note.blocks || []).map((b, i) => {
            if (b.type === 'text') {
              const box = { type: 'text', boxId: b.boxId || id(), left: 40, top: y, width: 260, height: 140, content: b.content || '' };
              y += 160;
              return box;
            }
            const box = { type: 'drawing', boxId: b.blockId || id(), left: 40, top: y, width: 400, height: 200 };
            y += 220;
            return box;
          })
        }];
      }
      if (!note.pages) note.pages = [{ boxes: [{ type: 'text', boxId: id(), left: 40, top: 40, width: 260, height: 140, content: '' }] }];
    });
  } catch (e) {
    console.warn('Error loading state', e);
  }
}

async function syncToApi() {
  const token = getToken();
  if (!token) return;
  try {
    await apiFetch('/api/sync', {
      method: 'PUT',
      body: JSON.stringify({
        folders: state.folders,
        notes: state.notes.map(n => ({
          id: n.id,
          title: n.title,
          folderId: n.folderId,
          pages: n.pages,
          pageDrawingData: n.pageDrawingData || {}
        })),
        summaries: state.summaries.map(s => ({
          id: s.id,
          noteId: s.noteId,
          noteTitle: s.noteTitle,
          sections: s.sections || []
        }))
      })
    });
  } catch (e) {
    console.warn('Sync API:', e);
  }
}

function saveNotes() {
  localStorage.setItem(STORAGE_NOTES, JSON.stringify(state.notes));
  syncToApi();
}

function saveFolders() {
  localStorage.setItem(STORAGE_FOLDERS, JSON.stringify(state.folders));
  syncToApi();
}

function saveSummaries() {
  localStorage.setItem(STORAGE_SUMMARIES, JSON.stringify(state.summaries));
  syncToApi();
}

// ——— Editor (toolbar) ———
function execCommand(cmd, value = null) {
  document.execCommand(cmd, false, value);
}

document.querySelectorAll('.btn-tool[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    const valueInput = btn.dataset.value;
    if (valueInput) {
      const input = document.getElementById(valueInput);
      execCommand(cmd, input ? input.value : null);
    } else {
      execCommand(cmd);
    }
  });
});

fontSizeSelect.addEventListener('change', () => {
  const size = fontSizeSelect.value;
  const sizes = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' };
  document.execCommand('fontSize', false, sizes[size] || '2');
});

// Delegación para botones dentro de cuadros
pagesContainer.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-tool[data-cmd]');
  if (!btn) return;
  const block = btn.closest('.block');
  const content = block && block.querySelector('.block-content');
  if (!content) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(content);
  sel.addRange(range);
  const cmd = btn.dataset.cmd;
  const colorInput = block.querySelector('.block-color');
  if (cmd === 'foreColor' && colorInput) execCommand('foreColor', colorInput.value);
  else execCommand(cmd);
});

// Dimensiones hoja A4 en px (para posiciones)
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const PAGE_BODY_MAX_HEIGHT_PX = 1040;

function getAllPages() {
  return [...pagesContainer.querySelectorAll('.sheet.page')];
}

function getCurrentPage() {
  return document.getElementById('currentPage') || pagesContainer.querySelector('.sheet.page');
}

function createNewPage(pageIndex) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet page';
  sheet.dataset.pageIndex = String(pageIndex);
  sheet.innerHTML = '<div class="page-body" contenteditable="true" data-placeholder="Escribe en la hoja..."></div><canvas class="page-drawing-canvas" aria-label="Dibujo sobre la hoja"></canvas>';
  pagesContainer.appendChild(sheet);
  attachPageBodyReflow(sheet.querySelector('.page-body'));
  initPageDrawingCanvas(sheet.querySelector('.page-drawing-canvas'), sheet);
  return sheet;
}

function getBodyMaxHeightPx() {
  const first = pagesContainer.querySelector('.page-body');
  if (!first) return PAGE_BODY_MAX_HEIGHT_PX;
  const style = window.getComputedStyle(first);
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
  return first.clientHeight || PAGE_BODY_MAX_HEIGHT_PX;
}

function splitBodyContent(body, maxHeightPx) {
  const wrap = document.createElement('div');
  wrap.style.width = body.offsetWidth + 'px';
  wrap.style.padding = window.getComputedStyle(body).padding;
  wrap.style.font = window.getComputedStyle(body).font;
  wrap.style.lineHeight = window.getComputedStyle(body).lineHeight;
  wrap.style.overflow = 'hidden';
  wrap.style.visibility = 'hidden';
  wrap.style.position = 'absolute';
  wrap.style.left = '-9999px';
  wrap.style.top = '0';
  wrap.style.boxSizing = 'border-box';
  document.body.appendChild(wrap);

  const source = document.createElement('div');
  source.innerHTML = body.innerHTML;
  const overflow = document.createElement('div');
  while (source.lastChild) {
    wrap.innerHTML = '';
    wrap.appendChild(source.cloneNode(true));
    if (wrap.offsetHeight <= maxHeightPx) break;
    const last = source.lastChild;
    source.removeChild(last);
    overflow.insertBefore(last, overflow.firstChild);
  }
  const fitHtml = source.innerHTML;
  const overflowHtml = overflow.innerHTML;
  document.body.removeChild(wrap);
  return { fitHtml, overflowHtml };
}

function reflowPage(sheet) {
  const body = sheet.querySelector('.page-body');
  if (!body) return;
  const maxH = getBodyMaxHeightPx();
  if (body.scrollHeight <= maxH) return;
  const { fitHtml, overflowHtml } = splitBodyContent(body, maxH);
  if (!overflowHtml.trim()) return;
  body.innerHTML = fitHtml;
  const pages = getAllPages();
  const idx = pages.indexOf(sheet);
  let nextSheet = pages[idx + 1];
  if (!nextSheet) nextSheet = createNewPage(idx + 1);
  const nextBody = nextSheet.querySelector('.page-body');
  if (nextBody) {
    nextBody.innerHTML = overflowHtml + (nextBody.innerHTML.trim() ? '<br>' + nextBody.innerHTML : '');
    if (nextBody.scrollHeight > getBodyMaxHeightPx()) reflowPage(nextSheet);
  }
}

let reflowTimer = null;
function attachPageBodyReflow(body) {
  if (!body) return;
  body.addEventListener('input', () => {
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(() => {
      const sheet = body.closest('.sheet.page');
      if (sheet) reflowPage(sheet);
    }, 300);
  });
}

// ——— Cuadros de texto y dibujo (posición libre en la hoja) ———
function getBoxHTML(type, opts = {}) {
  const { content = '', blockId = id(), left = 40, top = 40, width = 260, height = 140 } = opts;
  if (type === 'text') {
    return `
      <div class="text-box block block-text" data-type="text" data-box-id="${blockId}"
           style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;">
        <div class="box-handle" title="Arrastrar">⋮⋮</div>
        <button type="button" class="box-delete" title="Eliminar">×</button>
        <div class="block-toolbar">
          <button type="button" class="btn-tool small" data-cmd="bold">B</button>
          <button type="button" class="btn-tool small" data-cmd="italic">I</button>
          <button type="button" class="btn-tool small" data-cmd="underline">S</button>
          <input type="color" class="block-color" value="#000000">
        </div>
        <div class="block-content contenteditable-root" contenteditable="true" data-placeholder="Escribe aquí...">${content}</div>
      </div>`;
  }
  return '';
}

// ——— Dibujo sobre la hoja (misma página) ———
function resizeDrawingCanvas(canvas, sheet) {
  if (!canvas || !sheet) return;
  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  if (w && h && (canvas.width !== w || canvas.height !== h)) {
    const ctx = canvas.getContext('2d');
    const img = canvas.width ? canvas.toDataURL('image/png') : null;
    canvas.width = w;
    canvas.height = h;
    if (img) {
      const i = new Image();
      i.onload = () => { ctx.drawImage(i, 0, 0, w, h); };
      i.src = img;
    }
  }
}

function initPageDrawingCanvas(canvas, sheet) {
  if (!canvas || !sheet) return;
  resizeDrawingCanvas(canvas, sheet);
  const drawColorEl = document.getElementById('drawColor');
  const drawSizeEl = document.getElementById('drawSize');
  let drawing = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function start(e) {
    if (!state.drawMode) return;
    e.preventDefault();
    drawing = true;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function move(e) {
    if (!drawing || !state.drawMode) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    const pos = getPos(e);
    ctx.strokeStyle = (drawColorEl && drawColorEl.value) || '#000000';
    ctx.lineWidth = (drawSizeEl && parseInt(drawSizeEl.value, 10)) || 3;
    ctx.lineCap = 'round';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function end() {
    drawing = false;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function setDrawMode(on) {
  state.drawMode = on;
  const tools = document.getElementById('drawTools');
  const btn = document.getElementById('toggleDrawMode');
  if (tools) tools.style.display = on ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', on);
  getAllPages().forEach(sheet => {
    const canvas = sheet.querySelector('.page-drawing-canvas');
    if (canvas) canvas.classList.toggle('draw-mode', on);
  });
}

// ——— Arrastrar cuadros por la hoja (mover posición) ———
function setupBoxDrag(box) {
  const handle = box.querySelector('.box-handle');
  if (!handle) return;
  let startX, startY, startLeft, startTop;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const page = getCurrentPage();
    if (!page) return;
    const rect = page.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(box.style.left) || 0;
    startTop = parseFloat(box.style.top) || 0;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      const w = parseFloat(box.style.width) || 200;
      const h = parseFloat(box.style.height) || 120;
      const pageW = rect.width;
      const pageH = rect.height;
      newLeft = Math.max(0, Math.min(pageW - w, newLeft));
      newTop = Math.max(0, Math.min(pageH - h, newTop));
      box.style.left = newLeft + 'px';
      box.style.top = newTop + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  // Eliminar cuadro
  const delBtn = box.querySelector('.box-delete');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); });
}

document.getElementById('addTextBox').addEventListener('click', () => {
  const sheet = getCurrentPage();
  if (!sheet) return;
  const w = sheet.offsetWidth || PAGE_WIDTH;
  const h = sheet.offsetHeight || PAGE_HEIGHT;
  const boxW = 260;
  const boxH = 140;
  const left = Math.max(20, (w - boxW) / 2);
  const top = Math.max(20, (h - boxH) / 2);
  const div = document.createElement('div');
  div.innerHTML = getBoxHTML('text', { left, top, width: boxW, height: boxH }).trim();
  const box = div.firstElementChild;
  sheet.appendChild(box);
  setupBoxDrag(box);
});

document.getElementById('toggleDrawMode').addEventListener('click', () => setDrawMode(!state.drawMode));
document.getElementById('clearPageDrawing').addEventListener('click', () => {
  const sheet = getCurrentPage();
  const canvas = sheet && sheet.querySelector('.page-drawing-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

// ——— Notas (CRUD y UI) ———
function createNote(folderId = null) {
  const note = {
    id: id(),
    title: 'Sin título',
    folderId: folderId || null,
    pages: [{ boxes: [{ type: 'text', boxId: id(), left: 40, top: 40, width: 260, height: 140, content: '' }] }],
    drawingData: {}
  };
  state.notes.push(note);
  saveNotes();
  renderNoteList();
  renderFolderOptions();
  openNote(note.id);
  return note;
}

function getNote(id) {
  return state.notes.find(n => n.id === id);
}

function saveCurrentNote() {
  if (!state.currentNoteId) return;
  const note = getNote(state.currentNoteId);
  if (!note) return;
  note.title = noteTitle.value.trim() || 'Sin título';
  note.folderId = noteFolder.value || null;
  note.pages = [];
  note.pageDrawingData = note.pageDrawingData || {};
  getAllPages().forEach((sheet, i) => {
    const body = sheet.querySelector('.page-body');
    const bodyHtml = body ? body.innerHTML : '';
    const boxes = [];
    sheet.querySelectorAll('.text-box').forEach(box => {
      const boxId = box.dataset.boxId || box.dataset.blockId || id();
      box.dataset.boxId = boxId;
      const content = box.querySelector('.block-content');
      boxes.push({
        type: 'text',
        boxId,
        left: parseFloat(box.style.left) || 40,
        top: parseFloat(box.style.top) || 40,
        width: parseFloat(box.style.width) || 260,
        height: parseFloat(box.style.height) || 140,
        content: content ? content.innerHTML : ''
      });
    });
    const drawCanvas = sheet.querySelector('.page-drawing-canvas');
    if (drawCanvas && drawCanvas.width && drawCanvas.height) {
      note.pageDrawingData[i] = drawCanvas.toDataURL('image/png');
    }
    note.pages.push({ bodyHtml, boxes });
  });
  saveNotes();
  renderNoteList();
}

function loadNoteIntoEditor(note) {
  noteTitle.value = note.title;
  noteFolder.value = note.folderId || '';
  const pagesData = note.pages && note.pages.length ? note.pages : [{ bodyHtml: '', boxes: [] }];
  const existingPages = getAllPages();
  existingPages.forEach((sheet, i) => {
    if (i === 0) {
      const body = sheet.querySelector('.page-body');
      if (body) {
        body.innerHTML = pagesData[0].bodyHtml || '';
        attachPageBodyReflow(body);
      }
      let canvas = sheet.querySelector('.page-drawing-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'page-drawing-canvas';
        canvas.setAttribute('aria-label', 'Dibujo sobre la hoja');
        const pageBody = sheet.querySelector('.page-body');
        if (pageBody && pageBody.nextSibling) sheet.insertBefore(canvas, pageBody.nextSibling);
        else sheet.appendChild(canvas);
      }
      initPageDrawingCanvas(canvas, sheet);
      if (note.pageDrawingData && note.pageDrawingData[0]) {
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          resizeDrawingCanvas(canvas, sheet);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = note.pageDrawingData[0];
      }
      sheet.querySelectorAll('.text-box').forEach(b => b.remove());
      (pagesData[0].boxes || []).filter(b => b.type === 'text').forEach(b => addBoxToSheet(sheet, b, note));
    } else sheet.remove();
  });
  for (let i = 1; i < pagesData.length; i++) {
    const sheet = createNewPage(i);
    const body = sheet.querySelector('.page-body');
    if (body) body.innerHTML = pagesData[i].bodyHtml || '';
    (pagesData[i].boxes || []).filter(b => b.type === 'text').forEach(b => addBoxToSheet(sheet, b, note));
    const canvas = sheet.querySelector('.page-drawing-canvas');
    if (canvas && note.pageDrawingData && note.pageDrawingData[i]) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        resizeDrawingCanvas(canvas, sheet);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = note.pageDrawingData[i];
    }
  }
}

function addBoxToSheet(sheet, b, note) {
  if (b.type !== 'text') return;
  const div = document.createElement('div');
  div.innerHTML = getBoxHTML('text', {
    content: b.content || '',
    blockId: b.boxId,
    left: b.left,
    top: b.top,
    width: b.width,
    height: b.height
  }).trim();
  const box = div.firstElementChild;
  sheet.appendChild(box);
  setupBoxDrag(box);
}

function openNote(noteId) {
  saveCurrentNote();
  const note = getNote(noteId);
  if (!note) return;
  state.currentNoteId = noteId;
  loadNoteIntoEditor(note);
  document.querySelectorAll('.note-list li').forEach(el => el.classList.remove('active'));
  const li = document.querySelector(`.note-list li[data-id="${noteId}"]`);
  if (li) li.classList.add('active');
}

function deleteNote(noteId, e) {
  if (e) e.stopPropagation();
  if (!confirm('¿Eliminar esta nota?')) return;
  state.notes = state.notes.filter(n => n.id !== noteId);
  state.summaries = state.summaries.filter(s => s.noteId !== noteId);
  saveNotes();
  saveSummaries();
  if (getToken()) {
    apiFetch('/api/notes/' + encodeURIComponent(noteId), { method: 'DELETE' }).catch(() => {});
  }
  if (state.currentNoteId === noteId) {
    state.currentNoteId = state.notes[0] ? state.notes[0].id : null;
    if (state.currentNoteId) openNote(state.currentNoteId);
    else {
      noteTitle.value = '';
      noteFolder.value = '';
      const pages = getAllPages();
      pages.forEach((sheet, i) => {
        if (i === 0) {
          const body = sheet.querySelector('.page-body');
          if (body) body.innerHTML = '';
          sheet.querySelectorAll('.text-box, .drawing-box').forEach(b => b.remove());
          const div = document.createElement('div');
          div.innerHTML = getBoxHTML('text', { left: 40, top: 40, width: 260, height: 140 }).trim();
          sheet.appendChild(div.firstElementChild);
          setupBoxDrag(sheet.querySelector('.text-box'));
        } else sheet.remove();
      });
    }
  }
  renderNoteList();
  renderSummaryList();
}

function renderNoteList(filterFolderId = null) {
  let notes = state.notes;
  if (filterFolderId) notes = notes.filter(n => n.folderId === filterFolderId);
  noteList.innerHTML = notes.map(n => `
    <li data-id="${n.id}" data-folder="${n.folderId || ''}">
      <span class="note-name">${escapeHtml(n.title)}</span>
      <button type="button" class="btn-delete-note" data-id="${n.id}" title="Eliminar nota">🗑</button>
    </li>
  `).join('');
  noteList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-note')) return;
      openNote(li.dataset.id);
    });
    const delBtn = li.querySelector('.btn-delete-note');
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      if (id) deleteNote(id, e);
    });
  });
}

function renderFolderList() {
  folderList.innerHTML = state.folders.map(f => `
    <li data-id="${f.id}">${escapeHtml(f.name)}</li>
  `).join('');
  folderList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      state.currentFolderId = li.dataset.id;
      document.querySelectorAll('.folder-list li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      renderNoteList(state.currentFolderId);
    });
  });
}

function renderFolderOptions() {
  const current = noteFolder.value;
  noteFolder.innerHTML = '<option value="">Sin carpeta</option>' +
    state.folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
  noteFolder.value = current || '';
}

function deleteSummary(summaryId, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!confirm('¿Eliminar este resumen?')) return;
  state.summaries = state.summaries.filter(s => s.id !== summaryId);
  saveSummaries();
  if (getToken()) {
    apiFetch('/api/summaries/' + encodeURIComponent(summaryId), { method: 'DELETE' }).catch(() => {});
  }
  renderSummaryList();
  if (currentSummaryId === summaryId) {
    currentSummaryId = null;
    summaryModal.classList.remove('open');
  }
}

function renderSummaryList() {
  summaryList.innerHTML = state.summaries.map(s => {
    const note = getNote(s.noteId);
    const title = note ? note.title : 'Nota eliminada';
    return `<li data-summary-id="${s.id}">
      <span class="summary-name">${escapeHtml(title)} — Resumen</span>
      <button type="button" class="btn-delete-summary" data-summary-id="${s.id}" title="Eliminar resumen">🗑</button>
    </li>`;
  }).join('');
  summaryList.querySelectorAll('li').forEach(li => {
    const summaryId = li.dataset.summaryId;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-summary')) return;
      showSummary(summaryId);
    });
    const delBtn = li.querySelector('.btn-delete-summary');
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteSummary(delBtn.dataset.summaryId, e);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ——— Carpetas ———
function createFolder() {
  const name = prompt('Nombre de la carpeta:');
  if (!name || !name.trim()) return;
  state.folders.push({ id: id(), name: name.trim() });
  saveFolders();
  renderFolderList();
  renderFolderOptions();
}

document.getElementById('newFolder').addEventListener('click', createFolder);

// ——— Resúmenes ———
function getTextFromNote(note) {
  if (!note || !note.pages) return '';
  const parts = [];
  note.pages.forEach(p => {
    const div = document.createElement('div');
    div.innerHTML = p.bodyHtml || '';
    if (div.textContent && div.textContent.trim()) parts.push(div.textContent.trim());
    (p.boxes || []).filter(b => b.type === 'text').forEach(b => {
      const d = document.createElement('div');
      d.innerHTML = b.content || '';
      if (d.textContent && d.textContent.trim()) parts.push(d.textContent.trim());
    });
  });
  return parts.join('\n');
}

function generateSummaryFromText(text) {
  // Resumen por defecto si Gemini falla o no hay texto
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [{ title: 'Sin contenido', points: ['Añade texto a la nota y vuelve a generar el resumen.'] }];
  const section = { title: 'Puntos principales', points: lines.slice(0, 15).map(l => l.slice(0, 200)) };
  return [section];
}

async function generateSummaryWithGemini(text) {
  if (!text || !text.trim() || !getToken()) return null;
  try {
    const res = await apiFetch('/api/summarize', { method: 'POST', body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.sections || null;
  } catch (e) {
    throw e;
  }
}

async function generateSummaryWithGeminiContinue(noteText, existingSections) {
  if (!noteText || !noteText.trim() || !getToken()) return null;
  try {
    const res = await apiFetch('/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ text: noteText, existingSections: existingSections || [] })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.sections || null;
  } catch (e) {
    throw e;
  }
}

async function generateSummary() {
  saveCurrentNote();
  const note = getNote(state.currentNoteId);
  if (!note) {
    alert('Abre o crea una nota primero.');
    return;
  }
  const text = getTextFromNote(note);
  const summaryId = id();
  let sections = generateSummaryFromText(text);

  if (text.trim()) {
    const btn = document.getElementById('generateSummary');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generando…';
    try {
      const geminiSections = await generateSummaryWithGemini(text);
      if (geminiSections && geminiSections.length > 0) sections = geminiSections;
    } catch (e) {
      console.warn('Gemini no disponible, usando resumen local:', e);
      alert('No se pudo conectar con Gemini. Se usó un resumen automático. Comprueba tu API key o conexión.');
    }
    btn.disabled = false;
    btn.textContent = label;
  }

  state.summaries.push({
    id: summaryId,
    noteId: note.id,
    noteTitle: note.title,
    sections,
    createdAt: Date.now()
  });
  saveSummaries();
  renderSummaryList();
  showSummary(summaryId);
}

let currentSummaryId = null;

function showSummary(summaryId) {
  const s = state.summaries.find(x => x.id === summaryId);
  if (!s) return;
  currentSummaryId = summaryId;
  summaryContent.innerHTML = (s.sections || []).map(sec => `
    <div class="summary-section">
      <strong>${escapeHtml(sec.title)}</strong>
      <ul>
        ${(sec.points || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  summaryModal.classList.add('open');
}

async function continueSummary() {
  if (!currentSummaryId) return;
  const s = state.summaries.find(x => x.id === currentSummaryId);
  const note = s && getNote(s.noteId);
  if (!s || !note) {
    alert('No se puede continuar este resumen.');
    return;
  }
  const text = getTextFromNote(note);
  if (!text.trim()) {
    alert('La nota no tiene más texto para resumir.');
    return;
  }
  const btn = document.getElementById('continueSummaryBtn');
  const label = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generando…';
  }
  try {
    const newSections = await generateSummaryWithGeminiContinue(text, s.sections);
    if (newSections && newSections.length > 0) {
      s.sections = (s.sections || []).concat(newSections);
      saveSummaries();
      showSummary(currentSummaryId);
    } else {
      alert('No se encontró contenido nuevo para añadir al resumen.');
    }
  } catch (e) {
    console.warn(e);
    alert('No se pudo conectar con Gemini. Comprueba tu API key o conexión.');
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = label;
  }
}

closeSummaryModal.addEventListener('click', () => summaryModal.classList.remove('open'));
summaryModal.addEventListener('click', (e) => {
  if (e.target === summaryModal) summaryModal.classList.remove('open');
});

document.getElementById('generateSummary').addEventListener('click', generateSummary);
document.getElementById('continueSummaryBtn').addEventListener('click', continueSummary);

// ——— Export PDF ———
async function exportPdf() {
  saveCurrentNote();
  const title = noteTitle.value.trim() || 'Nota';
  const el = document.querySelector('.page-content');
  if (!el) return;
  try {
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#1a1a20'
    });
    const img = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = pdf.internal.pageSize.getHeight();
    const ratio = canvas.width / canvas.height;
    const imgH = w / ratio;
    pdf.addImage(img, 'PNG', 0, 0, w, imgH);
    if (imgH > h) {
      pdf.addPage();
      pdf.addImage(img, 'PNG', 0, -(imgH - h), w, imgH);
    }
    pdf.save(title + '.pdf');
  } catch (e) {
    console.error(e);
    alert('Error al exportar PDF. Comprueba la consola.');
  }
}

document.getElementById('exportPdf').addEventListener('click', exportPdf);

// ——— Nueva nota ———
document.getElementById('newNote').addEventListener('click', () => createNote(state.currentFolderId || null));

// ——— Sidebar toggle (siempre poder abrir/cerrar desde toolbar) ———
function toggleSidebarFn() {
  if (window.innerWidth <= 900) {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}
if (openMenuBtn) openMenuBtn.addEventListener('click', toggleSidebarFn);
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
});

function onResize() {
  if (window.innerWidth > 900) {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  }
}

window.addEventListener('resize', onResize);

// ——— Inicio ———
function initApp() {
  renderFolderList();
  renderNoteList();
  renderSummaryList();
  renderFolderOptions();
  document.querySelectorAll('.page-body').forEach(attachPageBodyReflow);
  getAllPages().forEach(sheet => {
    const canvas = sheet.querySelector('.page-drawing-canvas');
    if (canvas) initPageDrawingCanvas(canvas, sheet);
  });
  if (state.notes.length === 0) {
    createNote();
  } else if (!state.currentNoteId || !getNote(state.currentNoteId)) {
    openNote(state.notes[0].id);
  } else {
    openNote(state.currentNoteId);
  }
}

loadState();
if (appMain) appMain.style.display = 'none';

if (getToken()) {
  (async () => {
    const ok = await loadUserAndData();
    if (ok) {
      showApp();
      initApp();
    } else {
      setToken(null);
      showAuth();
    }
  })();
} else {
  showAuth();
}

noteTitle.addEventListener('blur', saveCurrentNote);
noteFolder.addEventListener('change', saveCurrentNote);
setInterval(saveCurrentNote, 8000);

window.addEventListener('resize', () => {
  getAllPages().forEach(sheet => {
    const canvas = sheet.querySelector('.page-drawing-canvas');
    if (canvas) resizeDrawingCanvas(canvas, sheet);
  });
});
