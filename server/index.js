const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-en-produccion-notas-secret';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-2.0-flash-lite'];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const NODE_ENV = process.env.NODE_ENV || 'development';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        folder_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT,
        note_title TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
      CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_user ON summaries(user_id);
    `);
  } finally {
    client.release();
  }
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

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email y contraseña (mín. 6 caracteres) requeridos' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email.trim().toLowerCase(), password_hash]
    );
    const user = r.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ese email ya está registrado' });
    console.error(e);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const r = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const user = r.rows[0];
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
    const r = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });
    res.json({ user: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/folders', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM folders WHERE user_id = $1 ORDER BY name', [req.userId]);
    res.json(r.rows.map(f => ({ id: f.id, name: f.name })));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/folders', authMiddleware, async (req, res) => {
  try {
    const { id, name } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id y name requeridos' });
    await pool.query('INSERT INTO folders (id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $3', [id, req.userId, name]);
    res.json({ id, name });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, title, folder_id, data, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC', [req.userId]);
    res.json(r.rows.map(n => ({ id: n.id, title: n.title, folderId: n.folder_id, ...n.data, updatedAt: n.updated_at })));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/notes', authMiddleware, async (req, res) => {
  try {
    const { id, title, folderId, pages, pageDrawingData } = req.body || {};
    if (!id || title === undefined) return res.status(400).json({ error: 'id y title requeridos' });
    const data = { pages: pages || [], pageDrawingData: pageDrawingData || {} };
    await pool.query(
      'INSERT INTO notes (id, user_id, title, folder_id, data, updated_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (id) DO UPDATE SET title = $3, folder_id = $4, data = $5, updated_at = NOW()',
      [id, req.userId, title, folderId || null, JSON.stringify(data)]
    );
    res.json({ id, title, folderId: folderId || null });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.delete('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/summaries', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, note_id, note_title, data, created_at FROM summaries WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
    res.json(r.rows.map(s => ({ id: s.id, noteId: s.note_id, noteTitle: s.note_title, ...s.data, createdAt: s.created_at })));
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/summaries', authMiddleware, async (req, res) => {
  try {
    const { id, noteId, noteTitle, sections } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const data = { sections: sections || [] };
    await pool.query(
      'INSERT INTO summaries (id, user_id, note_id, note_title, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET note_id = $3, note_title = $4, data = $5',
      [id, req.userId, noteId || null, noteTitle || '', JSON.stringify(data)]
    );
    res.json({ id, noteId, noteTitle });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

app.delete('/api/summaries/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM summaries WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
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

app.put('/api/sync', authMiddleware, async (req, res) => {
  try {
    const { folders, notes, summaries } = req.body || {};
    const userId = req.userId;
    if (folders && Array.isArray(folders)) {
      for (const f of folders) {
        if (f.id && f.name) await pool.query('INSERT INTO folders (id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $3', [f.id, userId, f.name]);
      }
    }
    if (notes && Array.isArray(notes)) {
      for (const n of notes) {
        const data = { pages: n.pages || [], pageDrawingData: n.pageDrawingData || {} };
        await pool.query('INSERT INTO notes (id, user_id, title, folder_id, data, updated_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (id) DO UPDATE SET title = $3, folder_id = $4, data = $5, updated_at = NOW()', [n.id, userId, n.title || 'Sin título', n.folderId || null, JSON.stringify(data)]);
      }
    }
    if (summaries && Array.isArray(summaries)) {
      for (const s of summaries) {
        const data = { sections: s.sections || [] };
        await pool.query('INSERT INTO summaries (id, user_id, note_id, note_title, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET note_id = $3, note_title = $4, data = $5', [s.id, userId, s.noteId || null, s.noteTitle || '', JSON.stringify(data)]);
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

initDb()
  .then(() => {
    app.listen(PORT, () => console.log('Notas API en puerto', PORT));
  })
  .catch((e) => {
    console.error('Error iniciando DB:', e);
    process.exit(1);
  });
