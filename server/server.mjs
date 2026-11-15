// Serveur du jeu : fichiers statiques de dist/ et API du classement. Modules standard de Node seulement.
//   PORT          port d'écoute (8080)
//   HOST          adresse d'écoute (0.0.0.0)
//   DIST_DIR      dossier servi (dist/ à côté de ce dossier)
//   SCORES_FILE   fichier du classement (data/scores.json dans le dossier courant)
//   SCORES_API    « off » : pas d'API, site statique seul (le jeu retombe sur le classement local du navigateur)
//   TRUST_PROXY   « 1 » : derrière un mandataire inverse, lire l'adresse du joueur dans X-Forwarded-For
//   SCORES_PER_MINUTE  inscriptions permises par adresse et par minute (6)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as Z, createBrotliCompress, createGzip } from 'node:zlib';
import { createScoresApi } from './scores-api.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DIST = resolve(process.env.DIST_DIR || join(HERE, '..', 'dist'));
const SCORES_FILE = resolve(process.env.SCORES_FILE || join('data', 'scores.json'));
const API_ON = !/^(off|0|false|non)$/i.test(process.env.SCORES_API ?? '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
};
/** types qui gagnent à être compressés à la volée (le relief en .bin se compresse bien) */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map', '.bin', '.gltf', '.wasm']);

// En-têtes de sécurité : pas de script ni de style venus d'ailleurs, pas d'inclusion dans une autre page.
// Le jeu pose des styles en ligne (attributs style) et charge ses textures par blob: et data:.
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'",
};

const api = API_ON ? createScoresApi({ file: SCORES_FILE, trustProxy: process.env.TRUST_PROXY === '1', postsPerMinute: Number(process.env.SCORES_PER_MINUTE) || 6 }) : null;

function plain(res, status, text, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text + '\n');
}

/** chemin demandé → fichier sous DIST, ou null s'il en sort (.., octet nul, encodage cassé) */
function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0')) return null;
  const file = normalize(join(DIST, p));
  if (file !== DIST && !file.startsWith(DIST + sep)) return null;
  // fichiers cachés (.env, .git…) jamais servis
  if (file.slice(DIST.length).split(sep).some((s) => s.startsWith('.'))) return null;
  return file;
}

async function serveStatic(req, res, urlPath, versioned = false) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Méthode non permise', { Allow: 'GET, HEAD' });
  let file = resolveFile(urlPath);
  if (!file) return plain(res, 400, 'Chemin refusé');
  let st = await stat(file).catch(() => null);
  if (st?.isDirectory()) { file = join(file, 'index.html'); st = await stat(file).catch(() => null); }
  if (!st?.isFile()) return plain(res, 404, 'Introuvable');
  const ext = extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  // cache long pour ce qui ne peut pas changer sous la même adresse : fichiers de assets/ dont le nom porte une
  // empreinte (Vite), et fichiers demandés avec ?v=<empreinte des assets> (src/core/assets.ts) ; le reste est revalidé
  const hashed = (versioned && ext !== '.html') || /[\\/]assets[\\/][^\\/]*-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(file);
  const head = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
  const accept = String(req.headers['accept-encoding'] ?? '');
  // version compressée à l'avance (server/precompress.mjs), plus récente que l'original : envoyée telle quelle
  if (/\bbr\b/.test(accept)) {
    const pre = await stat(file + '.br').catch(() => null);
    if (pre?.isFile() && pre.mtimeMs >= st.mtimeMs) {
      head['Content-Encoding'] = 'br';
      head['Content-Length'] = pre.size;
      res.writeHead(200, head);
      if (req.method === 'HEAD') return res.end();
      const pres = createReadStream(file + '.br');
      pres.on('error', () => res.destroy());
      return pres.pipe(res);
    }
  }
  const zip = COMPRESSIBLE.has(ext) && st.size > 1024 ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '') : '';
  if (zip) head['Content-Encoding'] = zip; else head['Content-Length'] = st.size;
  res.writeHead(200, head);
  if (req.method === 'HEAD') return res.end();
  const src = createReadStream(file);
  src.on('error', () => res.destroy());
  if (zip === 'br') src.pipe(createBrotliCompress({ params: { [Z.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
  else if (zip === 'gzip') src.pipe(createGzip({ level: 6 })).pipe(res);
  else src.pipe(res);
}

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  try {
    let path, versioned;
    try { const u = new URL(req.url ?? '/', 'http://x'); path = u.pathname; versioned = /^[0-9a-f]{8,40}$/.test(u.searchParams.get('v') ?? ''); } catch { return plain(res, 400, 'Requête invalide'); }
    if (path === '/healthz') return plain(res, 200, 'ok');
    if (api && (await api.handle(req, res))) return;
    if (path.startsWith('/api/')) return plain(res, 404, 'Introuvable');
    await serveStatic(req, res, path, versioned);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) plain(res, 500, 'Erreur du serveur'); else res.destroy();
  }
});
// connexions lentes ou abandonnées : on ne les garde pas indéfiniment
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => {
  console.log(`Pigeon perché : http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/  (fichiers : ${DIST})`);
  console.log(API_ON ? `Classement : ${SCORES_FILE}` : 'Classement : API désactivée (SCORES_API=off)');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
