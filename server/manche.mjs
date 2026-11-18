// Manche multijoueur de la Ville nouvelle : état de la salle unique et arbitrage. Sans dépendance, sans réseau :
// le transport (server/manche-api.mjs) appelle `join`, `leave` et `shot`, et reçoit les messages par `send`.
//
// Version minimale : le client calcule le vol de sa balle (il a les bâtiments et la balistique) et annonce sa touche ;
// le serveur tient l'état (qui est où, qui est debout, les points), refuse ce qui est impossible (tireur ou cible
// couchés, cadence, distance ou temps de vol incohérents) et applique la touche à l'arrivée de la balle.

export const MAX_JOUEURS = 10;
export const RETOUR_MS = 5000;          // délai avant de reparaître sur un autre emplacement
export const CADENCE_MS = 1200;         // temps minimal entre deux tirs (la culasse)
const V_MAX = 1000;                     // m/s : aucune balle du jeu ne va plus vite
const TOL_DIST = 40;                    // m : écart admis entre la distance annoncée et celle des emplacements

/** Points d'une touche : un point par tranche de 10 m. */
export const pointsPour = (dist) => Math.max(1, Math.round(dist / 10));

const propre = (s) => String(s ?? '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 16);

/**
 * @param {{ emplacements: { nom: string, x: number, y: number, z: number }[], now?: () => number,
 *           later?: (fn: () => void, ms: number) => unknown, rand?: () => number }} opt
 */
export function createManche({ emplacements, now = Date.now, later = (fn, ms) => setTimeout(fn, ms), rand = Math.random }) {
  const joueurs = new Map();            // id → { id, pseudo, emp, vivant, points, touches, tirs, subies, dernierTir, send }
  let suivant = 1;

  const libres = (sauf) => { const pris = new Set([...joueurs.values()].map((j) => j.emp)); return emplacements.filter((e) => !pris.has(e.nom) && e.nom !== sauf); };
  const tirage = (sauf) => { const l = libres(sauf); return l.length ? l[Math.floor(rand() * l.length)].nom : null; };
  const lieu = (nom) => emplacements.find((e) => e.nom === nom);
  const vue = (j) => ({ id: j.id, pseudo: j.pseudo, emp: j.emp, vivant: j.vivant, points: j.points, touches: j.touches, tirs: j.tirs, subies: j.subies });
  const diffuse = (msg, sauf) => { for (const j of joueurs.values()) if (j.id !== sauf) j.send(msg); };

  return {
    /** Entrée d'un joueur. Renvoie son identifiant, ou null si la salle est pleine. */
    join(pseudo, send) {
      if (joueurs.size >= MAX_JOUEURS) { send({ t: 'complet' }); return null; }
      const emp = tirage(); if (!emp) { send({ t: 'complet' }); return null; }
      const id = suivant++;
      const j = { id, pseudo: propre(pseudo) || `Tireur ${id}`, emp, vivant: true, points: 0, touches: 0, tirs: 0, subies: 0, dernierTir: -1e9, send };
      joueurs.set(id, j);
      send({ t: 'bienvenue', id, joueurs: [...joueurs.values()].map(vue) });
      diffuse({ t: 'arrive', joueur: vue(j) }, id);
      return id;
    },
    leave(id) { if (joueurs.delete(id)) diffuse({ t: 'part', id }); },
    /**
     * Un tir. `annonce` : { cible?: id du joueur que la balle atteint, dist?: m, tof?: s }.
     * Renvoie 'ok', ou la raison du refus.
     */
    shot(id, annonce = {}) {
      const j = joueurs.get(id); if (!j) return 'inconnu';
      if (!j.vivant) return 'couché';
      const t = now(); if (t - j.dernierTir < CADENCE_MS) return 'cadence';
      j.dernierTir = t; j.tirs++;
      diffuse({ t: 'tir', id }, id);
      if (annonce.cible == null) return 'ok';
      const c = joueurs.get(Number(annonce.cible)); if (!c || c.id === id) return 'cible inconnue';
      if (!c.vivant) return 'cible couchée';
      const a = lieu(j.emp), b = lieu(c.emp), d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const dist = Number(annonce.dist), tof = Number(annonce.tof);
      if (!(Math.abs(dist - d) <= TOL_DIST)) return 'distance';
      if (!(tof >= d / V_MAX && tof <= 12)) return 'temps de vol';
      const empTireur = j.emp, empCible = c.emp;
      later(() => {
        // à l'arrivée de la balle : la cible doit être encore là, debout, et le tireur toujours dans la salle
        const tireur = joueurs.get(id), cible = joueurs.get(c.id);
        if (!tireur || !cible || !cible.vivant || cible.emp !== empCible) return;
        cible.vivant = false; cible.subies++; tireur.touches++; const pts = pointsPour(d); tireur.points += pts;
        diffuse({ t: 'touche', tireur: id, cible: cible.id, emp: empCible, de: empTireur, dist: Math.round(d), points: pts, scores: [...joueurs.values()].map(vue) });
        later(() => {
          const k = joueurs.get(cible.id); if (!k) return;
          k.emp = tirage(k.emp) ?? k.emp; k.vivant = true;
          diffuse({ t: 'retour', id: k.id, emp: k.emp });
        }, RETOUR_MS);
      }, tof * 1000);
      return 'ok';
    },
    etat: () => [...joueurs.values()].map(vue),
    nombre: () => joueurs.size,
  };
}
