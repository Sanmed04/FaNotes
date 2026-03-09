/**
 * Notas — Editor de notas con bloques, dibujo, export PDF y resúmenes
 * Resúmenes generados con Gemini API.
 */

// Debug: en consola hacer window.DEBUG_FA_NOTES = true y recargar, o asignar y llamar a las funciones de nuevo
function _faNotesDebug() { return typeof window !== 'undefined' && window.DEBUG_FA_NOTES; }

const STORAGE_KEY = 'notas-app';
const STORAGE_NOTES = 'notas-data';
const STORAGE_FOLDERS = 'notas-folders';
const STORAGE_SUMMARIES = 'notas-summaries';
const AUTH_TOKEN_KEY = 'notas-token';
const THEME_STORAGE_KEY = 'notas-theme';
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
const themeToggle = document.getElementById('themeToggle');

// ——— Modo día/noche ———
function getTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
}
function setTheme(theme) {
  theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.body.setAttribute('data-theme', theme);
  if (themeToggle) {
    themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
    themeToggle.setAttribute('title', theme === 'light' ? 'Cambiar a modo noche' : 'Cambiar a modo día');
  }
}
if (themeToggle) {
  setTheme(getTheme());
  themeToggle.addEventListener('click', () => setTheme(getTheme() === 'light' ? 'dark' : 'light'));
}

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
  state.notes = [];
  state.folders = [];
  state.summaries = [];
  state.currentNoteId = null;
  state.currentFolderId = null;
  localStorage.removeItem(STORAGE_NOTES);
  localStorage.removeItem(STORAGE_FOLDERS);
  localStorage.removeItem(STORAGE_SUMMARIES);
  setToken(null);
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
  if (getToken()) syncToApi();
  else localStorage.setItem(STORAGE_NOTES, JSON.stringify(state.notes));
}

function saveFolders() {
  if (getToken()) syncToApi();
  else localStorage.setItem(STORAGE_FOLDERS, JSON.stringify(state.folders));
}

function saveSummaries() {
  if (getToken()) syncToApi();
  else localStorage.setItem(STORAGE_SUMMARIES, JSON.stringify(state.summaries));
}

// ——— Editor (toolbar) ———
function execCommand(cmd, value = null) {
  if (cmd === 'formatHeading') {
    applyHeadingToSelection();
    return;
  }
  document.execCommand(cmd, false, value);
}

function unwrapHeading(span) {
  if (!span || !span.classList.contains('doc-heading')) return;
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  span.remove();
}

function applyHeadingToSelection() {
  const sel = window.getSelection();
  const body = document.querySelector('.page-body:focus') || getCurrentPage()?.querySelector('.page-body');
  if (!body) return;
  let range;
  if (sel.rangeCount) {
    range = sel.getRangeAt(0);
    if (range.collapsed || !body.contains(range.commonAncestorContainer)) {
      range = null;
    }
  }
  if (!range && savedSelection && savedSelection.body === body) {
    try {
      range = document.createRange();
      range.setStart(savedSelection.startContainer, savedSelection.startOffset);
      range.setEnd(savedSelection.endContainer, savedSelection.endOffset);
      if (!body.contains(range.commonAncestorContainer)) range = null;
      else sel.removeAllRanges(), sel.addRange(range);
    } catch (_) {
      range = null;
    }
  }
  if (!range || range.collapsed) return;
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const headingSpan = ancestor.closest ? ancestor.closest('.doc-heading') : null;
  if (headingSpan && body.contains(headingSpan)) {
    const rangeInside = range.cloneRange();
    rangeInside.selectNodeContents(headingSpan);
    if (rangeInside.compareBoundaryPoints(Range.START_TO_START, range) <= 0 &&
        rangeInside.compareBoundaryPoints(Range.END_TO_END, range) >= 0) {
      unwrapHeading(headingSpan);
      savedSelection = null;
      updateOutlinePanel();
      return;
    }
  }
  const span = document.createElement('span');
  span.className = 'doc-heading';
  span.contentEditable = 'true';
  const fragment = range.extractContents();
  span.appendChild(fragment);
  range.insertNode(span);
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(span);
  r.collapse(true);
  sel.addRange(r);
  savedSelection = null;
  updateOutlinePanel();
}

let savedSelection = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const body = getCurrentPage()?.querySelector('.page-body');
  if (body && body.contains(range.startContainer) && !range.collapsed) {
    try {
      savedSelection = { body, startContainer: range.startContainer, startOffset: range.startOffset, endContainer: range.endContainer, endOffset: range.endOffset };
    } catch (_) {
      savedSelection = null;
    }
  }
});

document.querySelectorAll('.btn-tool[data-cmd]').forEach(btn => {
  const cmd = btn.dataset.cmd;
  if (cmd === 'formatHeading') {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  }
  btn.addEventListener('click', () => {
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
  if (_faNotesDebug()) console.log('[FaNotes] createNewPage', pageIndex, '(no se añade ningún cuadro de texto aquí)');
  const sheet = document.createElement('div');
  sheet.className = 'sheet page';
  sheet.dataset.pageIndex = String(pageIndex);
  sheet.innerHTML = '<div class="page-body" contenteditable="true" data-placeholder="Escribe en la hoja..."></div><canvas class="page-drawing-canvas" aria-label="Dibujo sobre la hoja"></canvas>';
  const pages = getAllPages();
  const insertAfter = pageIndex > 0 ? pages[pageIndex - 1] : null;
  pagesContainer.insertBefore(sheet, insertAfter ? insertAfter.nextSibling : pagesContainer.firstChild);
  const body = sheet.querySelector('.page-body');
  attachPageBodyReflow(body);
  setupBodyImagePaste(body);
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
  const bodyStyle = window.getComputedStyle(body);
  wrap.style.cssText = `width:${body.offsetWidth}px;padding:${bodyStyle.padding};font:${bodyStyle.font};line-height:${bodyStyle.lineHeight};overflow:hidden;visibility:hidden;position:absolute;left:-9999px;top:0;box-sizing:border-box;contain:layout`;
  document.body.appendChild(wrap);

  const source = document.createElement('div');
  source.innerHTML = body.innerHTML;
  const overflow = document.createElement('div');
  while (source.lastChild) {
    wrap.textContent = '';
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

function getTextLengthFromHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').length;
}

function getCursorOffsetInBody(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  if (!body.contains(range.startContainer)) return 0;
  try {
    const r = document.createRange();
    r.selectNodeContents(body);
    r.setEnd(range.startContainer, range.startOffset);
    return r.toString().length;
  } catch (_) {
    return 0;
  }
}

function placeCursorAtEnd(el) {
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCursorAtStart(el) {
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function isCursorInLastLine(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!body.contains(range.startContainer)) return false;
  const bodyRect = body.getBoundingClientRect();
  const lineHeight = parseFloat(window.getComputedStyle(body).lineHeight) || 24;
  const rects = range.getClientRects();
  if (rects.length) {
    const caretBottom = rects[rects.length - 1].bottom;
    const threshold = bodyRect.bottom - lineHeight;
    if (caretBottom >= threshold - 2) return true;
  }
  if (range.collapsed) {
    const endRange = document.createRange();
    endRange.selectNodeContents(body);
    endRange.collapse(false);
    try {
      if (range.compareBoundaryPoints(Range.END_TO_END, endRange) >= 0) return true;
    } catch (_) {}
    const bodyText = (body.textContent || '').replace(/\s/g, '');
    if (bodyText.length === 0) return true;
  }
  return false;
}

function reflowPage(sheet) {
  const body = sheet.querySelector('.page-body');
  if (!body) return;
  const maxH = getBodyMaxHeightPx();
  if (body.scrollHeight <= maxH) return;
  const hadFocus = document.activeElement === body;
  const cursorOffset = hadFocus ? getCursorOffsetInBody(body) : -1;
  const { fitHtml, overflowHtml } = splitBodyContent(body, maxH);
  if (!overflowHtml.trim()) return;
  const fitTextLen = getTextLengthFromHtml(fitHtml);
  const cursorWasInOverflow = hadFocus && cursorOffset >= fitTextLen;
  if (_faNotesDebug()) console.log('[FaNotes] reflowPage: moviendo overflow a hoja siguiente (ningún cuadro de texto en body)');
  body.innerHTML = fitHtml;
  const pages = getAllPages();
  const idx = pages.indexOf(sheet);
  let nextSheet = pages[idx + 1];
  if (!nextSheet) nextSheet = createNewPage(idx + 1);
  const nextBody = nextSheet.querySelector('.page-body');
  if (nextBody) {
    nextBody.innerHTML = overflowHtml + (nextBody.innerHTML.trim() ? '<br>' + nextBody.innerHTML : '');
    if (nextBody.scrollHeight > getBodyMaxHeightPx()) reflowPage(nextSheet);
    if (cursorWasInOverflow) {
      nextBody.focus();
      requestAnimationFrame(() => {
        placeCursorAtStart(nextBody);
        nextSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else if (hadFocus) {
      placeCursorAtEnd(body);
    }
  } else if (hadFocus) {
    placeCursorAtEnd(body);
  }
}

let reflowTimer = null;
let outlineTimer = null;
function attachPageBodyReflow(body) {
  if (!body) return;
  body.addEventListener('keydown', (e) => {
    const sheet = body.closest('.sheet.page');
    if (!sheet) return;
    if (e.key === 'Backspace') {
      const pages = getAllPages();
      const idx = pages.indexOf(sheet);
      if (idx > 0) {
        const isEmpty = !body.textContent || body.textContent.replace(/\s/g, '').length === 0;
        const noBoxes = !sheet.querySelectorAll('.text-box').length;
        if (isEmpty && noBoxes) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const prevSheet = pages[idx - 1];
          const prevBody = prevSheet.querySelector('.page-body');
          sheet.remove();
          if (prevBody) {
            prevBody.focus();
            placeCursorAtEnd(prevBody);
            prevSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          saveCurrentNote();
          updateOutlinePanel();
        }
      }
      return;
    }
    if (e.key !== 'Enter') return;
    if (!isCursorInLastLine(body)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const pages = getAllPages();
    const idx = pages.indexOf(sheet);
    let nextSheet = pages[idx + 1];
    if (!nextSheet) nextSheet = createNewPage(idx + 1);
    const nextBody = nextSheet.querySelector('.page-body');
    if (nextBody) {
      if (!nextBody.innerHTML.trim()) nextBody.innerHTML = '<br>';
      nextSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        nextBody.focus();
        placeCursorAtStart(nextBody);
      }, 350);
    }
  }, true);
  body.addEventListener('input', () => {
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(() => {
      const sheet = body.closest('.sheet.page');
      if (sheet) {
        requestAnimationFrame(() => reflowPage(sheet));
      }
    }, 450);
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(updateOutlinePanel, 200);
  });
  setupBodyImagePaste(body);
}

// ——— Imágenes movibles y opciones tipo Word (delante/detrás, enviar atrás, traer al frente) ———
function createImageWrapper(src, left, top) {
  const wrap = document.createElement('span');
  wrap.className = 'doc-image wrap-front';
  wrap.contentEditable = 'false';
  wrap.dataset.imageId = id();
  wrap.style.left = (left || 20) + 'px';
  wrap.style.top = (top || 20) + 'px';
  wrap.style.width = '200px';
  const img = document.createElement('img');
  img.src = src;
  img.onload = () => {
    const w = Math.min(280, img.naturalWidth);
    wrap.style.width = w + 'px';
  };
  wrap.appendChild(img);
  return wrap;
}

function setupImageElements(container) {
  if (!container) return;
  container.querySelectorAll('.doc-image').forEach(wrap => {
    if (wrap.dataset.setup === '1') return;
    wrap.dataset.setup = '1';
    setupImageDrag(wrap);
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showImageContextMenu(e.clientX, e.clientY, wrap);
    });
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      container.querySelectorAll('.doc-image.selected').forEach(el => el.classList.remove('selected'));
      wrap.classList.add('selected');
    });
  });
}

function setupImageDrag(wrap) {
  const sheet = wrap.closest('.sheet.page');
  if (!sheet) return;
  let startX, startY, startLeft, startTop;
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!e.target.closest('.doc-image')) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(wrap.style.left) || 0;
    startTop = parseFloat(wrap.style.top) || 0;
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      wrap.style.left = (startLeft + dx) + 'px';
      wrap.style.top = (startTop + dy) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function setupBodyImagePaste(body) {
  if (!body || body.dataset.imagePaste === '1') return;
  body.dataset.imagePaste = '1';
  body.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          const wrap = createImageWrapper(reader.result, 40, 40);
          body.appendChild(wrap);
          setupImageElements(body);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  });
}

let imageContextMenuTarget = null;
function showImageContextMenu(x, y, wrap) {
  imageContextMenuTarget = wrap;
  const menu = document.getElementById('imageContextMenu');
  if (!menu) return;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('show');
}

function hideImageContextMenu() {
  document.getElementById('imageContextMenu')?.classList.remove('show');
  imageContextMenuTarget = null;
}

document.getElementById('imageContextMenu')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-wrap], button[data-order]');
  if (!btn || !imageContextMenuTarget) return;
  const w = imageContextMenuTarget;
  if (btn.dataset.wrap === 'behind') {
    w.classList.remove('wrap-front');
    w.classList.add('wrap-behind');
  } else if (btn.dataset.wrap === 'front') {
    w.classList.remove('wrap-behind');
    w.classList.add('wrap-front');
  } else if (btn.dataset.order === 'back') {
    const all = w.closest('.page-body')?.querySelectorAll('.doc-image') || [];
    let minZ = 999;
    all.forEach(el => {
      const z = parseInt(el.style.zIndex, 10) || 0;
      if (z < minZ) minZ = z;
    });
    w.style.zIndex = String(minZ - 1);
  } else if (btn.dataset.order === 'front') {
    const all = w.closest('.page-body')?.querySelectorAll('.doc-image') || [];
    let maxZ = 0;
    all.forEach(el => {
      const z = parseInt(el.style.zIndex, 10) || 0;
      if (z > maxZ) maxZ = z;
    });
    w.style.zIndex = String(maxZ + 1);
  }
  hideImageContextMenu();
});

document.addEventListener('click', () => hideImageContextMenu());

document.getElementById('addImageBtn')?.addEventListener('click', () => {
  document.getElementById('imageFileInput')?.click();
});
document.getElementById('imageFileInput')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  e.target.value = '';
  const body = getCurrentPage()?.querySelector('.page-body');
  if (!body) return;
  const reader = new FileReader();
  reader.onload = () => {
    const wrap = createImageWrapper(reader.result, 40, 40);
    body.appendChild(wrap);
    setupImageElements(body);
  };
  reader.readAsDataURL(file);
});

// ——— Panel Títulos a la derecha: todas las hojas, siempre visible (sticky) ———
function updateOutlinePanel() {
  const listEl = document.getElementById('outlineList');
  if (!listEl) return;
  const pages = getAllPages();
  const items = [];
  pages.forEach((sheet, pageIdx) => {
    const body = sheet.querySelector('.page-body');
    if (!body) return;
    body.querySelectorAll('.doc-heading, h2, h3').forEach(el => {
      items.push({ sheet, body, el, text: (el.textContent || '').trim().slice(0, 50) });
    });
  });
  listEl.innerHTML = items.length ? items.map((item, i) => {
    return `<li data-outline-index="${i}">${escapeHtml(item.text) || '(Título)'}</li>`;
  }).join('') : '<li class="outline-empty">Sin títulos</li>';
  listEl.querySelectorAll('li[data-outline-index]').forEach(li => {
    li.addEventListener('click', () => {
      const idx = parseInt(li.dataset.outlineIndex, 10);
      const item = items[idx];
      if (item) {
        item.sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        requestAnimationFrame(() => {
          item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (item.el.focus) item.el.focus();
        });
      }
    });
  });
}

pagesContainer.addEventListener('click', () => {
  setTimeout(updateOutlinePanel, 0);
});

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

// ——— Dibujo sobre la hoja (misma página) + detección de formas (línea, círculo, rectángulo, flecha) ———
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
      canvas._baseImage = img;
      canvas._paths = canvas._paths || [];
    }
    redrawDrawingCanvas(canvas);
  }
}

function drawPath(ctx, path) {
  ctx.strokeStyle = path.color || '#000000';
  ctx.lineWidth = path.width || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (path.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(path.x1, path.y1);
    ctx.lineTo(path.x2, path.y2);
    ctx.stroke();
  } else if (path.type === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(path.x1, path.y1);
    ctx.lineTo(path.x2, path.y2);
    ctx.stroke();
    const dx = path.x2 - path.x1, dy = path.y2 - path.y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = (path.width || 3) * 5;
    ctx.beginPath();
    ctx.moveTo(path.x2, path.y2);
    ctx.lineTo(path.x2 - ux * head - uy * head * 0.6, path.y2 - uy * head + ux * head * 0.6);
    ctx.moveTo(path.x2, path.y2);
    ctx.lineTo(path.x2 - ux * head + uy * head * 0.6, path.y2 - uy * head - ux * head * 0.6);
    ctx.stroke();
  } else if (path.type === 'circle') {
    ctx.beginPath();
    ctx.arc(path.cx, path.cy, path.r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (path.type === 'rect') {
    ctx.strokeRect(path.x, path.y, path.w, path.h);
  } else if (path.type === 'triangle' && path.corners && path.corners.length === 3) {
    ctx.beginPath();
    ctx.moveTo(path.corners[0].x, path.corners[0].y);
    ctx.lineTo(path.corners[1].x, path.corners[1].y);
    ctx.lineTo(path.corners[2].x, path.corners[2].y);
    ctx.closePath();
    ctx.stroke();
  } else if (path.type === 'freehand' && path.points && path.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
    ctx.stroke();
  }
}

function redrawDrawingCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (canvas._baseImage) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      (canvas._paths || []).forEach(p => drawPath(ctx, p));
    };
    img.src = canvas._baseImage;
  } else {
    (canvas._paths || []).forEach(p => drawPath(ctx, p));
  }
}

function detectShape(points, strokeWidth) {
  if (!points || points.length < 2) return null;
  const first = points[0], last = points[points.length - 1];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pathLen = points.reduce((acc, p, i) => i ? acc + dist(points[i - 1], p) : 0, 0);
  const len = dist(first, last);
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  points.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  const w = maxX - minX, h = maxY - minY;
  const rectPerimeter = 2 * (w + h);
  const closed = len < Math.max(35, strokeWidth * 6, pathLen * 0.12);

  // 1) Rectángulo/cuadrado: trazo cerrado que recorre el perímetro del bbox (prioridad sobre círculo)
  if (closed && points.length >= 5 && w > 18 && h > 18 && pathLen > rectPerimeter * 0.72) {
    return { type: 'rect', x: minX, y: minY, w, h };
  }

  // 2) Triángulo: trazo cerrado con exactamente 3 esquinas claras
  if (closed && points.length >= 5) {
    const angleAt = (i) => {
      const prev = points[i === 0 ? points.length - 1 : i - 1];
      const curr = points[i];
      const next = points[(i + 1) % points.length];
      const a = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const b = Math.atan2(next.y - curr.y, next.x - curr.x);
      let angle = Math.abs(b - a);
      if (angle > Math.PI) angle = 2 * Math.PI - angle;
      return angle;
    };
    const corners = [];
    for (let i = 0; i < points.length; i++) {
      const angle = angleAt(i);
      if (angle < Math.PI * 0.7) corners.push({ i, angle, ...points[i] });
    }
    if (corners.length >= 3) {
      corners.sort((a, b) => a.angle - b.angle);
      const take = corners.slice(0, 3).sort((a, b) => a.i - b.i);
      const tri = take.map(c => ({ x: c.x, y: c.y }));
      const area = Math.abs(
        (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) -
        (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y)
      ) / 2;
      if (area > 80) return { type: 'triangle', corners: tri };
    }
  }

  // 3) Círculo: solo si es redondo (pathLen ~ pi*d) y puntos a distancia similar del centro
  if (closed && points.length >= 8 && w > 15 && h > 15) {
    const circleLike = pathLen >= 2.4 * Math.min(w, h) && pathLen <= 3.6 * Math.min(w, h);
    if (circleLike) {
      let cx = 0, cy = 0;
      points.forEach(p => { cx += p.x; cy += p.y; });
      cx /= points.length; cy /= points.length;
      let r = 0;
      points.forEach(p => { r += dist(p, { x: cx, y: cy }); });
      r /= points.length;
      if (r > 6) {
        let err = 0;
        points.forEach(p => { err += Math.abs(dist(p, { x: cx, y: cy }) - r); });
        err /= points.length;
        if (err < Math.max(22, r * 0.18)) return { type: 'circle', cx, cy, r };
      }
    }
  }

  // 4) Línea / Flecha
  let maxD = 0;
  for (let i = 0; i < points.length; i++) {
    const t = i / Math.max(1, points.length - 1);
    const px = first.x + t * (last.x - first.x);
    const py = first.y + t * (last.y - first.y);
    const d = dist(points[i], { x: px, y: py });
    if (d > maxD) maxD = d;
  }
  const tol = Math.max(24, strokeWidth * 5);
  if (len > 12 && maxD < tol) {
    if (len > 20) return { type: 'arrow', x1: first.x, y1: first.y, x2: last.x, y2: last.y };
    return { type: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y };
  }

  return null;
}

function initPageDrawingCanvas(canvas, sheet) {
  if (!canvas || !sheet) return;
  canvas._paths = canvas._paths || [];
  canvas._baseImage = canvas._baseImage || null;
  resizeDrawingCanvas(canvas, sheet);
  const drawColorEl = document.getElementById('drawColor');
  const drawSizeEl = document.getElementById('drawSize');
  let drawing = false;
  let currentPoints = [];

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
    const pos = getPos(e);
    currentPoints = [{ x: pos.x, y: pos.y }];
  }

  function move(e) {
    if (!drawing || !state.drawMode) return;
    e.preventDefault();
    const pos = getPos(e);
    currentPoints.push({ x: pos.x, y: pos.y });
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = (drawColorEl && drawColorEl.value) || '#000000';
    ctx.lineWidth = (drawSizeEl && parseInt(drawSizeEl.value, 10)) || 3;
    ctx.lineCap = 'round';
    if (currentPoints.length >= 2) {
      const p = currentPoints[currentPoints.length - 2];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  }

  function end() {
    if (!drawing) return;
    drawing = false;
    const color = (drawColorEl && drawColorEl.value) || '#000000';
    const width = (drawSizeEl && parseInt(drawSizeEl.value, 10)) || 3;
    const shape = detectShape(currentPoints, width);
    const path = shape
      ? { ...shape, color, width }
      : { type: 'freehand', points: currentPoints.slice(), color, width };
    canvas._paths.push(path);
    redrawDrawingCanvas(canvas);
    currentPoints = [];
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
    const container = box.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
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
      const pageW = container.offsetWidth;
      const pageH = container.offsetHeight;
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
  const pageBody = sheet.querySelector('.page-body');
  const container = pageBody || sheet;
  const w = container.offsetWidth || PAGE_WIDTH;
  const h = container.offsetHeight || PAGE_HEIGHT;
  const boxW = 260;
  const boxH = 140;
  const left = Math.max(20, (w - boxW) / 2);
  const top = Math.max(20, (h - boxH) / 2);
  const div = document.createElement('div');
  div.innerHTML = getBoxHTML('text', { left, top, width: boxW, height: boxH }).trim();
  const box = div.firstElementChild;
  container.appendChild(box);
  setupBoxDrag(box);
});

document.getElementById('toggleDrawMode').addEventListener('click', () => setDrawMode(!state.drawMode));
document.getElementById('undoDrawingStroke')?.addEventListener('click', () => {
  const sheet = getCurrentPage();
  const canvas = sheet?.querySelector('.page-drawing-canvas');
  if (!canvas || !canvas._paths || canvas._paths.length === 0) return;
  canvas._paths.pop();
  redrawDrawingCanvas(canvas);
});

document.getElementById('clearPageDrawing').addEventListener('click', () => {
  const sheet = getCurrentPage();
  const canvas = sheet && sheet.querySelector('.page-drawing-canvas');
  if (canvas) {
    canvas._paths = [];
    canvas._baseImage = null;
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
    pages: [{ boxes: [] }],
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
      if (_faNotesDebug()) console.log('[FaNotes] saveCurrentNote: guardando cuadro en hoja', i, 'boxId', box.dataset.boxId || box.dataset.blockId);
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
        setupImageElements(body);
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
        canvas._baseImage = note.pageDrawingData[0];
        canvas._paths = canvas._paths || [];
        resizeDrawingCanvas(canvas, sheet);
        redrawDrawingCanvas(canvas);
      }
      sheet.querySelectorAll('.text-box').forEach(b => b.remove());
      (pagesData[0].boxes || []).filter(b => b.type === 'text').forEach(b => addBoxToSheet(sheet, b, note));
    } else sheet.remove();
  });
  for (let i = 1; i < pagesData.length; i++) {
    const sheet = createNewPage(i);
    const body = sheet.querySelector('.page-body');
    if (body) {
      body.innerHTML = pagesData[i].bodyHtml || '';
      setupBodyImagePaste(body);
      setupImageElements(body);
    }
    (pagesData[i].boxes || []).filter(b => b.type === 'text').forEach(b => addBoxToSheet(sheet, b, note));
    const canvas = sheet.querySelector('.page-drawing-canvas');
    if (canvas && note.pageDrawingData && note.pageDrawingData[i]) {
      canvas._baseImage = note.pageDrawingData[i];
      canvas._paths = canvas._paths || [];
      resizeDrawingCanvas(canvas, sheet);
      redrawDrawingCanvas(canvas);
    }
  }
}

function addBoxToSheet(sheet, b, note) {
  if (b.type !== 'text') return;
  if (_faNotesDebug()) {
    const pageIdx = getAllPages().indexOf(sheet);
    console.log('[FaNotes] addBoxToSheet', { pageIndex: pageIdx, noteId: note?.id, boxId: b.boxId }, 'origen: carga de nota (pagesData[].boxes)');
  }
  const pageBody = sheet.querySelector('.page-body');
  const container = pageBody || sheet;
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
  container.appendChild(box);
  setupBoxDrag(box);
}

function openNote(noteId) {
  saveCurrentNote();
  const note = getNote(noteId);
  if (!note) return;
  state.currentNoteId = noteId;
  loadNoteIntoEditor(note);
  updateOutlinePanel();
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
        } else sheet.remove();
      });
    }
  }
  renderNoteList();
  renderSummaryList();
}

function renderNoteList(filterFolderId = null) {
  const filter = filterFolderId === undefined ? state.currentFolderId : filterFolderId;
  let notes = state.notes;
  if (filter) notes = notes.filter(n => n.folderId === filter);
  noteList.innerHTML = notes.map(n => `
    <li data-id="${n.id}" data-folder="${n.folderId || ''}" draggable="true" class="note-list-item">
      <span class="note-name">${escapeHtml(n.title)}</span>
      <div class="note-item-actions">
        <button type="button" class="btn-move-note" data-id="${n.id}" title="Mover a carpeta">📁</button>
        <button type="button" class="btn-delete-note" data-id="${n.id}" title="Eliminar nota">🗑</button>
      </div>
    </li>
  `).join('');
  noteList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-note') || e.target.closest('.btn-move-note')) return;
      openNote(li.dataset.id);
    });
    const delBtn = li.querySelector('.btn-delete-note');
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      if (id) deleteNote(id, e);
    });
    const moveBtn = li.querySelector('.btn-move-note');
    if (moveBtn) moveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMoveNoteMenu(e.currentTarget, moveBtn.getAttribute('data-id'));
    });
    setupNoteDrag(li);
  });
}

function showMoveNoteMenu(anchor, noteId) {
  const note = getNote(noteId);
  if (!note) return;
  const existing = document.getElementById('moveNoteMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'moveNoteMenu';
  menu.className = 'move-note-menu';
  menu.innerHTML = '<div class="move-note-menu-title">Mover a</div>' +
    '<button type="button" data-folder-id="">Sin carpeta</button>' +
    state.folders.map(f => `<button type="button" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`).join('');
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.querySelectorAll('button[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const folderId = btn.dataset.folderId || null;
      note.folderId = folderId;
      saveNotes();
      if (getToken()) syncToApi();
      renderNoteList();
      renderFolderOptions();
      if (state.currentNoteId === note.id) noteFolder.value = folderId || '';
      menu.remove();
    });
  });
  const close = () => {
    menu.remove();
    document.removeEventListener('click', close);
  };
  menu.addEventListener('click', (e) => e.stopPropagation());
  setTimeout(() => document.addEventListener('click', close), 0);
}

function setupNoteDrag(li) {
  const noteId = li.dataset.id;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', noteId);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
}

function moveNoteToFolder(noteId, folderId) {
  const note = getNote(noteId);
  if (!note) return;
  note.folderId = folderId || null;
  saveNotes();
  if (getToken()) syncToApi();
  renderNoteList();
  renderFolderOptions();
  if (state.currentNoteId === noteId) noteFolder.value = folderId || '';
}

function renderFolderList() {
  folderList.innerHTML =
    '<li data-id="" class="folder-item-all">Todas</li>' +
    state.folders.map(f => `
      <li data-id="${f.id}" class="folder-drop-target">${escapeHtml(f.name)}</li>
    `).join('');
  folderList.querySelectorAll('li').forEach(li => {
    const folderId = li.dataset.id || null;
    const isAll = li.classList.contains('folder-item-all');
    if (state.currentFolderId === folderId || (isAll && state.currentFolderId === null))
      li.classList.add('active');
    else
      li.classList.remove('active');
    li.addEventListener('click', () => {
      state.currentFolderId = isAll ? null : folderId;
      document.querySelectorAll('.folder-list li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      renderNoteList(state.currentFolderId);
    });
    if (!isAll) setupFolderDropTarget(li);
  });
}

function setupFolderDropTarget(folderLi) {
  const folderId = folderLi.dataset.id;
  folderLi.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    folderLi.classList.add('drop-over');
  });
  folderLi.addEventListener('dragleave', () => folderLi.classList.remove('drop-over'));
  folderLi.addEventListener('drop', (e) => {
    e.preventDefault();
    folderLi.classList.remove('drop-over');
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId) moveNoteToFolder(noteId, folderId);
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

if (!getToken()) loadState();
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
