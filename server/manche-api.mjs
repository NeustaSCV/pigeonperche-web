// Transport de la manche multijoueur, avec les seuls modules standard de Node : un flux d'événements du serveur vers
// chaque joueur (text/event-stream) et de petites requêtes POST dans l'autre sens. Même code en production
// (server/server.mjs) et en développement (vite.config.ts).
//   GET  /api/manche/etat             résumé pour le menu et le salon d'attente (connectés, manche, classements)
//   GET  /api/manche/flux?pseudo=…   flux du joueur ; il est dans la salle tant que la connexion reste ouverte
//   GET  /api/manche/flux?role=spectateur   flux d'un spectateur (refusé sans joueur humain dans la salle)
//   POST /api/manche/tir             { id, jeton, cible?, dist?, tof? }
//   POST /api/manche/vise            { id, jeton, cible }   qui le joueur tient dans sa lunette (null : personne)
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createManche } from './manche.mjs';
import { ROBOTS } from './robots.mjs';

const TAILLE_MAX = 600;                 // octets : un tir tient en bien moins

/**
 * @param {{ fichier: string, records?: string }} opt  `fichier` : emplacements.json de la carte (public/ville ou
 *   dist/ville) ; `records` : fichier JSON des meilleurs et pires scores de toujours (absent : gardés en mémoire)
 */
export function createMancheApi({ fichier, records }) {
  let manche = null; const jetons = new Map();
  const salle = () => {
    if (!manche) {
      const carte = JSON.parse(readFileSync(fichier, 'utf8'));
      const E = carte.emplacements.map((e) => ({ nom: e.nom, x: e.x, y: e.y, z: e.z }));
      // lignes de visée calculées avec la carte : un robot ne tire que sur ce qu'il peut voir
      const rang = new Map(carte.emplacements.map((e, i) => [e.nom, i])), vues = (carte.visibles ?? []).map((l) => new Set(l));
      const voit = (a, b) => { const v = vues[rang.get(a)]; return !v || v.has(carte.emplacements[rang.get(b)]?.n); };
      let anciens = {}; if (records) { try { anciens = JSON.parse(readFileSync(records, 'utf8')); } catch { /* premier lancement */ } }
      const garde = (r) => { if (!records) return; try { mkdirSync(dirname(records), { recursive: true }); writeFileSync(records, JSON.stringify(r)); } catch (e) { console.error('records de la manche :', e.message); } };
      manche = createManche({ emplacements: E, records: anciens, onRecords: garde, robots: ROBOTS, voit });
    }
    return manche;
  };
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  return {
    /** Traite la requête si elle concerne la manche ; renvoie vrai dans ce cas. */
    async handle(req, res) {
      let u; try { u = new URL(req.url ?? '/', 'http://x'); } catch { return false; }
      if (!u.pathname.startsWith('/api/manche/')) return false;
      if (u.pathname === '/api/manche/etat' && req.method === 'GET') {
        try { json(res, 200, salle().resume()); } catch { json(res, 503, { erreur: 'carte absente' }); }
        return true;
      }
      if (u.pathname === '/api/manche/flux' && req.method === 'GET') {
        let m; try { m = salle(); } catch { json(res, 503, { erreur: 'carte absente' }); return true; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const send = (msg) => { res.write(`data: ${JSON.stringify(msg)}\n\n`); };
        const jeton = randomBytes(12).toString('hex');
        const id = u.searchParams.get('role') === 'spectateur' ? m.watch(send) : m.join(u.searchParams.get('pseudo') ?? '', (msg) => send(msg.t === 'bienvenue' ? { ...msg, jeton } : msg));
        if (id == null) { res.end(); return true; }
        if (id > 0) jetons.set(id, jeton);
        const battement = setInterval(() => res.write(': .\n\n'), 15000);
        req.on('close', () => { clearInterval(battement); jetons.delete(id); m.leave(id); });
        return true;
      }
      if ((u.pathname === '/api/manche/tir' || u.pathname === '/api/manche/vise') && req.method === 'POST') {
        let corps = '';
        for await (const c of req) { corps += c; if (corps.length > TAILLE_MAX) { json(res, 413, { erreur: 'trop long' }); return true; } }
        let a; try { a = JSON.parse(corps); } catch { json(res, 400, { erreur: 'requête illisible' }); return true; }
        const id = Number(a?.id);
        if (!manche || jetons.get(id) !== a?.jeton) { json(res, 403, { erreur: 'joueur inconnu' }); return true; }
        json(res, 200, { r: u.pathname.endsWith('/vise') ? manche.aim(id, a.cible ?? null) : manche.shot(id, { cible: a.cible, dist: a.dist, tof: a.tof }) });
        return true;
      }
      json(res, 404, { erreur: 'introuvable' });
      return true;
    },
  };
}
