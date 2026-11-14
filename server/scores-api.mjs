// API JSON du classement : GET /api/scores (les trois classements), POST /api/scores (inscrire un score).
// Le même gestionnaire sert au serveur de production (server.mjs) et au greffon Vite (vite.config.ts).
import { BOARD_SIZE, SCORES_VERSION, validateSubmission } from '../src/shared/scores-core.mjs';
import { createScoreStore } from './score-store.mjs';

export const API_PATH = '/api/scores';
/** taille maximale du corps d'une inscription, octets */
const BODY_MAX = 2048;

/** Limitation de débit par adresse : `max` requêtes par fenêtre glissante de `windowMs`. */
export function createRateLimiter(max, windowMs, now = () => Date.now()) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t);
    hits.set(key, list);
    // la table ne grossit pas sans fin : les adresses silencieuses sont oubliées
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return true;
  };
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('corps trop long'), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {{ file: string, trustProxy?: boolean, postsPerMinute?: number, readsPerMinute?: number, log?: (m: string) => void }} opt
 * `trustProxy` : derrière un mandataire inverse, l'adresse du joueur est lue dans X-Forwarded-For.
 */
export function createScoresApi({ file, trustProxy = false, postsPerMinute = 6, readsPerMinute = 120, log = (m) => console.warn(m) }) {
  const store = createScoreStore(file, { log });
  const allowPost = createRateLimiter(postsPerMinute, 60_000);
  const allowRead = createRateLimiter(readsPerMinute, 60_000);
  const clientOf = (req) => {
    const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    return fwd || req.socket?.remoteAddress || 'inconnu';
  };
  const send = (res, status, body, extra = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(text);
  };

  /** Traite la requête si elle vise l'API ; renvoie faux sinon (le serveur passe alors aux fichiers statiques). */
  async function handle(req, res) {
    let path;
    try { path = new URL(req.url ?? '/', 'http://x').pathname; } catch { return false; }
    if (path !== API_PATH) return false;
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!allowRead(clientOf(req))) { send(res, 429, { error: 'trop de requêtes' }, { 'Retry-After': '60' }); return true; }
        send(res, 200, { v: SCORES_VERSION, size: BOARD_SIZE, levels: await store.read() });
      } else if (req.method === 'POST') {
        if (!allowPost(clientOf(req))) { send(res, 429, { error: 'trop d’inscriptions, réessayez dans une minute' }, { 'Retry-After': '60' }); return true; }
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) { send(res, 415, { error: 'JSON attendu' }); return true; }
        if (Number(req.headers['content-length'] ?? 0) > BODY_MAX) { send(res, 413, { error: 'corps trop long' }); return true; }
        let body;
        try { body = JSON.parse(await readBody(req, BODY_MAX)); } catch (e) { send(res, e.status ?? 400, { error: e.status ? e.message : 'JSON invalide' }); return true; }
        const v = validateSubmission(body);
        if (!v.ok) { send(res, 400, { error: v.error }); return true; }
        const r = await store.submit(v.level, v.entry);
        send(res, r.rank > 0 ? 201 : 200, { v: SCORES_VERSION, level: v.level, rank: r.rank, board: r.board });
      } else send(res, 405, { error: 'méthode non permise' }, { Allow: 'GET, HEAD, POST' });
    } catch (e) {
      log(`[scores] ${e?.stack ?? e}`);
      if (!res.headersSent) send(res, 500, { error: 'erreur du serveur' });
      else res.end();
    }
    return true;
  }
  return { handle, store };
}
