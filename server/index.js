const express = require('express');
const cors = require('cors');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-en-produccion-notas-secret';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-2.0-flash-lite'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const NODE_ENV = process.env.NODE_ENV || 'development';

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'notas.db');
const dbDir = path.dirname(dbPath);
let db;

function saveDb() {
  try {
    const data = db.export();
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error('Error guardando DB:', e);
  }
}

function dbRun(sql, ...params) {
  if (params.length) db.run(sql, params);
  else db.run(sql);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

function dbGet(sql, ...params) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, ...params) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      folder_id TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT,
      note_title TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_summaries_user ON summaries(user_id)`);
  saveDb();
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email y contraseña (mín. 6 caracteres) requeridos' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const id = require('crypto').randomUUID();
    try {
      dbRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', id, email.trim().toLowerCase(), password_hash);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese email ya está registrado' });
      throw e;
    }
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email: email.trim().toLowerCase() } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const user = dbGet('SELECT id, email, password_hash FROM users WHERE email = ?', email.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = dbGet('SELECT id, email FROM users WHERE id = ?', req.userId);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/folders', authMiddleware, (req, res) => {
  try {
    const rows = dbAll('SELECT id, name FROM folders WHERE user_id = ? ORDER BY name', req.userId);
    res.json(rows.map(f => ({ id: f.id, name: f.name })));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/folders', authMiddleware, (req, res) => {
  try {
    const { id, name } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id y name requeridos' });
    dbRun('INSERT INTO folders (id, user_id, name) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = ?', id, req.userId, name, name);
    res.json({ id, name });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/notes', authMiddleware, (req, res) => {
  try {
    const rows = dbAll('SELECT id, title, folder_id, data, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC', req.userId);
    res.json(rows.map(n => {
      const data = typeof n.data === 'string' ? JSON.parse(n.data || '{}') : n.data;
      return { id: n.id, title: n.title, folderId: n.folder_id, ...data, updatedAt: n.updated_at };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/notes', authMiddleware, (req, res) => {
  try {
    const { id, title, folderId, pages, pageDrawingData } = req.body || {};
    if (!id || title === undefined) return res.status(400).json({ error: 'id y title requeridos' });
    const data = JSON.stringify({ pages: pages || [], pageDrawingData: pageDrawingData || {} });
    dbRun(
      `INSERT INTO notes (id, user_id, title, folder_id, data, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (id) DO UPDATE SET title = ?, folder_id = ?, data = ?, updated_at = datetime('now')`,
      id, req.userId, title, folderId || null, data, title, folderId || null, data
    );
    res.json({ id, title, folderId: folderId || null });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.delete('/api/notes/:id', authMiddleware, (req, res) => {
  try {
    const r = dbRun('DELETE FROM notes WHERE id = ? AND user_id = ?', req.params.id, req.userId);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/summaries', authMiddleware, (req, res) => {
  try {
    const rows = dbAll('SELECT id, note_id, note_title, data, created_at FROM summaries WHERE user_id = ? ORDER BY created_at DESC', req.userId);
    res.json(rows.map(s => {
      const data = typeof s.data === 'string' ? JSON.parse(s.data || '{}') : s.data;
      return { id: s.id, noteId: s.note_id, noteTitle: s.note_title, ...data, createdAt: s.created_at };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/summaries', authMiddleware, (req, res) => {
  try {
    const { id, noteId, noteTitle, sections } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const data = JSON.stringify({ sections: sections || [] });
    dbRun(
      `INSERT INTO summaries (id, user_id, note_id, note_title, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET note_id = ?, note_title = ?, data = ?`,
      id, req.userId, noteId || null, noteTitle || '', data, noteId || null, noteTitle || '', data
    );
    res.json({ id, noteId, noteTitle });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.delete('/api/summaries/:id', authMiddleware, (req, res) => {
  try {
    const r = dbRun('DELETE FROM summaries WHERE id = ? AND user_id = ?', req.params.id, req.userId);
    if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');
  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      });
      if (!res.ok) {
        lastError = await res.text();
        continue;
      }
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) continue;
      const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      if (parsed?.sections && Array.isArray(parsed.sections)) {
        return parsed.sections.map(s => ({
          title: s.title || 'Resumen',
          points: Array.isArray(s.points) ? s.points : [String(s.points || '')]
        }));
      }
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || 'Gemini no respondió');
}

app.post('/api/summarize', authMiddleware, async (req, res) => {
  try {
    const { text, existingSections } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text requerido' });
    let prompt;
    if (existingSections && existingSections.length > 0) {
      const existingStr = existingSections.map(sec =>
        `**${sec.title}**: ${(sec.points || []).join('; ')}`
      ).join('\n');
      prompt = `Eres un asistente que resume notas. Ya tenemos este resumen parcial (NO lo repitas):

---
${existingStr}
---

Del siguiente texto de la nota, genera SOLO información NUEVA que aún no esté en el resumen anterior. No repitas ningún punto ni sección ya listados. Añade nuevas secciones o nuevos bullets con información importante que falte.

Responde ÚNICAMENTE con un JSON válido, sin markdown. Estructura: {"sections":[{"title":"Título","points":["Punto 1",...]}]}

Texto de la nota:
${String(text).slice(0, 28000)}`;
    } else {
      prompt = `Eres un asistente que resume notas. Resume el siguiente texto en bullet points.

Reglas:
- Extrae la información más importante.
- Agrupa por temas si tiene sentido (máximo 4 secciones).
- Cada bullet debe ser claro y contener la idea principal.
- Responde ÚNICAMENTE con un JSON válido, sin markdown ni \`\`\`json. Estructura exacta:
{"sections":[{"title":"Título de la sección","points":["Punto 1","Punto 2",...]}]}

Texto a resumir:

${String(text).slice(0, 28000)}`;
    }
    const sections = await callGemini(prompt);
    res.json({ sections });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Error al resumir' });
  }
});

app.put('/api/sync', authMiddleware, (req, res) => {
  try {
    const { folders, notes, summaries } = req.body || {};
    const userId = req.userId;
    if (folders && Array.isArray(folders)) {
      for (const f of folders) {
        if (f.id && f.name) dbRun('INSERT INTO folders (id, user_id, name) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = ?', f.id, userId, f.name, f.name);
      }
    }
    if (notes && Array.isArray(notes)) {
      for (const n of notes) {
        const data = JSON.stringify({ pages: n.pages || [], pageDrawingData: n.pageDrawingData || {} });
        dbRun(
          `INSERT INTO notes (id, user_id, title, folder_id, data, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT (id) DO UPDATE SET title = ?, folder_id = ?, data = ?, updated_at = datetime('now')`,
          n.id, userId, n.title || 'Sin título', n.folderId || null, data, n.title || 'Sin título', n.folderId || null, data
        );
      }
    }
    if (summaries && Array.isArray(summaries)) {
      for (const s of summaries) {
        const data = JSON.stringify({ sections: s.sections || [] });
        dbRun(
          `INSERT INTO summaries (id, user_id, note_id, note_title, data) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET note_id = ?, note_title = ?, data = ?`,
          s.id, userId, s.noteId || null, s.noteTitle || '', data, s.noteId || null, s.noteTitle || '', data
        );
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al sincronizar' });
  }
});

if (NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return res.status(404).end();
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });
}

async function start() {
  const SQL = await initSqlJs();
  let data = null;
  try {
    if (fs.existsSync(dbPath)) data = fs.readFileSync(dbPath);
  } catch (_) {}
  db = new SQL.Database(data);
  initDb();
  app.listen(PORT, () => console.log('Notas API en puerto', PORT));
}

start().catch(e => {
  console.error('Error iniciando DB:', e);
  process.exit(1);
});
