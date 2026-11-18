// Manche multijoueur de la Ville nouvelle : état de la salle unique et arbitrage. Sans dépendance, sans réseau :
// le transport (server/manche-api.mjs) appelle `join`, `watch`, `leave` et `shot`, et reçoit les messages par `send`.
//
// Version minimale de l'arbitrage : le client calcule le vol de sa balle (il a les bâtiments et la balistique) et
// annonce sa touche ; le serveur tient l'état (qui est où, qui est debout, les points), refuse ce qui est impossible
// (tireur ou cible couchés, cadence, distance ou temps de vol incohérents) et applique la touche à l'arrivée de la balle.
//
// Le temps est calé sur l'horloge : une manche de 4 minutes commence à chaque multiple de 5 minutes (xx:00, xx:05…),
// suivie d'une minute de salon. Le classement de la manche qui s'achève est gardé (« partie précédente ») et versé
// aux records de toujours (meilleurs et pires scores).

export const MAX_JOUEURS = 10;
export const RETOUR_MS = 5000;          // délai avant de reparaître sur un autre emplacement
export const CADENCE_MS = 1200;         // temps minimal entre deux tirs (la culasse)
export const MANCHE_MS = 240_000;       // durée d'une manche : 4 minutes
export const PAUSE_MS = 60_000;         // salon entre deux manches : 1 minute
export const CYCLE_MS = MANCHE_MS + PAUSE_MS;   // 5 minutes : les manches commencent à xx:00, xx:05, xx:10…
export const RECORDS_MAX = 20;          // lignes gardées dans chaque liste de records
const V_MAX = 1000;                     // m/s : aucune balle du jeu ne va plus vite
const TOL_DIST = 40;                    // m : écart admis entre la distance annoncée et celle des emplacements

/** Points d'une touche : un point par tranche de 10 m. */
export const pointsPour = (dist) => Math.max(1, Math.round(dist / 10));
/** Du meilleur au pire : les points, puis le moins de touches subies, puis le plus de touches réussies. */
export const parRang = (a, b) => b.points - a.points || a.subies - b.subies || b.touches - a.touches;

const propre = (s) => String(s ?? '').replace(/[\u0000-\u001f<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

/**
 * @param {{ emplacements: { nom: string, x: number, y: number, z: number }[], now?: () => number,
 *           later?: (fn: () => void, ms: number) => unknown, rand?: () => number,
 *           records?: { meilleurs?: object[], pires?: object[] }, onRecords?: (r: object) => void }} opt
 */
export function createManche({ emplacements, now = Date.now, later = (fn, ms) => setTimeout(fn, ms), rand = Math.random, records = {}, onRecords = () => {} }) {
  const joueurs = new Map();            // id → { id, pseudo, robot, emp, vivant, points, touches, tirs, subies, dernierTir, send }
  const spectateurs = new Map();        // id → send
  let suivant = 1, numero = 0, precedente = null;
  let meilleurs = [...(records.meilleurs ?? [])], pires = [...(records.pires ?? [])];

  const libres = (sauf) => { const pris = new Set([...joueurs.values()].map((j) => j.emp)); return emplacements.filter((e) => !pris.has(e.nom) && e.nom !== sauf); };
  const tirage = (sauf) => { const l = libres(sauf); return l.length ? l[Math.floor(rand() * l.length)].nom : null; };
  const lieu = (nom) => emplacements.find((e) => e.nom === nom);
  const vue = (j) => ({ id: j.id, pseudo: j.pseudo, robot: !!j.robot, emp: j.emp, vivant: j.vivant, points: j.points, touches: j.touches, tirs: j.tirs, subies: j.subies });
  const ligne = (j) => ({ pseudo: j.pseudo, robot: !!j.robot, points: j.points, touches: j.touches, tirs: j.tirs, subies: j.subies });
  const diffuse = (msg, sauf) => { for (const j of joueurs.values()) if (j.id !== sauf) j.send(msg); for (const s of spectateurs.values()) s(msg); };
  const humains = () => [...joueurs.values()].filter((j) => !j.robot).length;
  /** Où en est l'horloge : phase en cours et temps restant avant la suivante. */
  const temps = () => { const t = ((now() % CYCLE_MS) + CYCLE_MS) % CYCLE_MS; return t < MANCHE_MS ? { phase: 'jeu', reste: MANCHE_MS - t } : { phase: 'pause', reste: CYCLE_MS - t }; };
  let phase = temps().phase;
  const pseudoLibre = (p) => { let q = p, n = 2; const pris = new Set([...joueurs.values()].map((j) => j.pseudo.toLowerCase())); while (pris.has(q.toLowerCase())) q = `${p.slice(0, 13)} ${n++}`; return q; };

  const debut = () => {
    numero++; phase = 'jeu';
    for (const j of joueurs.values()) { j.points = 0; j.touches = 0; j.tirs = 0; j.subies = 0; j.vivant = true; }
    diffuse({ t: 'debut', ...temps(), joueurs: [...joueurs.values()].map(vue) });
  };
  const fin = () => {
    const classement = [...joueurs.values()].sort(parRang).map(ligne);
    phase = 'pause';
    if (classement.length) {
      precedente = { fin: now(), classement };
      // records de toujours : seuls ceux qui ont tiré au moins une fois comptent
      const actifs = classement.filter((l) => l.tirs > 0).map((l) => ({ ...l, date: now() }));
      if (actifs.length) {
        meilleurs = [...meilleurs, ...actifs].sort(parRang).slice(0, RECORDS_MAX);
        pires = [...pires, ...actifs].sort((a, b) => parRang(b, a)).slice(0, RECORDS_MAX);
        onRecords({ meilleurs, pires });
      }
    }
    diffuse({ t: 'fin', ...temps(), classement });
  };
  // l'horloge fait basculer la salle d'une phase à l'autre, qu'il y ait du monde ou non
  const planifie = () => later(() => { const p = temps().phase; if (p !== phase) { if (p === 'pause') fin(); else debut(); } planifie(); }, temps().reste + 20);
  planifie();

  return {
    /** Entrée d'un joueur. Renvoie son identifiant, ou null si la salle est pleine. `robot` : tireur automatique. */
    join(pseudo, send, { robot = false } = {}) {
      if (joueurs.size >= MAX_JOUEURS) { send({ t: 'complet' }); return null; }
      const emp = tirage(); if (!emp) { send({ t: 'complet' }); return null; }
      const id = suivant++;
      const j = { id, pseudo: pseudoLibre(propre(pseudo) || `Tireur ${id}`), robot, emp, vivant: true, points: 0, touches: 0, tirs: 0, subies: 0, dernierTir: -1e9, send };
      joueurs.set(id, j);
      send({ t: 'bienvenue', id, ...temps(), joueurs: [...joueurs.values()].map(vue) });
      diffuse({ t: 'arrive', joueur: vue(j) }, id);
      return id;
    },
    /** Entrée d'un spectateur : il reçoit tout, n'occupe aucun emplacement. Refusée s'il n'y a aucun joueur humain. */
    watch(send) {
      if (humains() < 1) { send({ t: 'vide' }); return null; }
      const id = -(suivant++); spectateurs.set(id, send);
      send({ t: 'bienvenue', id, spectateur: true, ...temps(), joueurs: [...joueurs.values()].map(vue) });
      return id;
    },
    leave(id) { if (spectateurs.delete(id)) return; if (joueurs.delete(id)) diffuse({ t: 'part', id }); },
    /**
     * Un tir. `annonce` : { cible?: id du joueur que la balle atteint, dist?: m, tof?: s }.
     * Renvoie 'ok', ou la raison du refus.
     */
    shot(id, annonce = {}) {
      const j = joueurs.get(id); if (!j) return 'inconnu';
      if (phase !== 'jeu') return 'pause';
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
      const empTireur = j.emp, empCible = c.emp, n = numero;
      later(() => {
        // à l'arrivée de la balle : même manche, la cible encore là et debout, le tireur toujours dans la salle
        const tireur = joueurs.get(id), cible = joueurs.get(c.id);
        if (n !== numero || phase !== 'jeu' || !tireur || !cible || !cible.vivant || cible.emp !== empCible) return;
        cible.vivant = false; cible.subies++; tireur.touches++; const pts = pointsPour(d); tireur.points += pts;
        diffuse({ t: 'touche', tireur: id, cible: cible.id, emp: empCible, de: empTireur, dist: Math.round(d), points: pts, scores: [...joueurs.values()].map(vue) });
        later(() => {
          const k = joueurs.get(cible.id); if (!k || k.vivant) return;
          k.emp = tirage(k.emp) ?? k.emp; k.vivant = true;
          diffuse({ t: 'retour', id: k.id, emp: k.emp });
        }, RETOUR_MS);
      }, tof * 1000);
      return 'ok';
    },
    /** Ce que le menu et le salon d'attente affichent, sans entrer dans la salle. */
    resume: () => ({ ...temps(), connectes: joueurs.size, humains: humains(), spectateurs: spectateurs.size, places: MAX_JOUEURS - joueurs.size,
      joueurs: [...joueurs.values()].sort(parRang).map(ligne), precedente, meilleurs: meilleurs.slice(0, 5), pires: pires.slice(0, 5) }),
    etat: () => [...joueurs.values()].map(vue),
    nombre: () => joueurs.size,
  };
}
