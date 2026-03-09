# Notas — Editor de notas

Sitio web responsive para tomar notas con formato tipo Word, bloques movibles, dibujo y exportación a PDF.

## Cómo usar

1. Abre `index.html` en el navegador (doble clic o desde un servidor local).
2. **Nueva nota**: botón «+ Nueva nota» en el menú lateral.
3. **Carpetas**: «+ Carpeta» para crear carpetas y organizar notas (asigna carpeta en el desplegable de la nota).
4. **Barra de herramientas**: negrita, cursiva, subrayado, color de texto, resaltado, alineación (izquierda, centro, derecha), listas.
5. **Bloques**: «+ Bloque» añade un bloque de texto; «✎ Dibujo» añade un lienzo. Arrastra el asa (⋮⋮) para reordenar bloques.
6. **Resumir**: con una nota abierta, «Resumir» genera un resumen con bullets (por defecto usa el texto de la nota; ver más abajo para usar IA).
7. **Resúmenes**: en el menú lateral, sección «Resúmenes»; clic en uno para verlo en un modal.
8. **Exportar PDF**: «Exportar PDF» guarda la nota actual como PDF.

## Resumen con IA (Gemini)

Los resúmenes con IA se generan con **Google Gemini API** desde el servidor. La API key se configura en el backend (variable de entorno `GEMINI_API_KEY` en `.env` o en Railway); no se expone en el frontend.

- Si no hay clave o Gemini falla, se usa un resumen automático a partir de las líneas de la nota.
- La función "Resumir" con IA solo está disponible cuando estás **logueado** (el servidor usa la clave de forma segura).

## Persistencia y sincronización

- **Sin cuenta**: todo se guarda en **localStorage** (solo este dispositivo).
- **Con cuenta**: inicia sesión o crea una para sincronizar notas, carpetas y resúmenes en la nube y verlos desde cualquier dispositivo.

## Despliegue en Railway

1. Crea un proyecto en [Railway](https://railway.app) y añade un servicio **PostgreSQL** (te dará `DATABASE_URL`).
2. Conecta este repositorio y configura:
   - **Root Directory**: deja vacío (raíz del repo).
   - **Build Command**: vacío o `cd server && npm install`.
   - **Start Command**: `cd server && node index.js` (o usa el Procfile).
3. Variables de entorno en Railway (o en un archivo `.env` en local; ver `.env.example`):
   - `DATABASE_URL`: la que te asigna PostgreSQL.
   - `JWT_SECRET`: una frase o string aleatorio largo (para firmar sesiones).
   - `GEMINI_API_KEY`: tu API key de Google Gemini (resúmenes con IA). Obtener en [Google AI Studio](https://aistudio.google.com/apikey).
   - `NODE_ENV`: `production`.
4. El servidor sirve la API (`/auth/*`, `/api/*`) y en producción también los estáticos (index.html, app.js, styles.css) desde la raíz.

## Estructura

- `index.html`, `styles.css`, `app.js` — Frontend (editor, login, sincronización).
- `server/` — Backend Node/Express: auth (registro/login JWT), API de notas, carpetas y resúmenes con PostgreSQL.

Dependencias (CDN): jsPDF y html2canvas para exportar a PDF.
