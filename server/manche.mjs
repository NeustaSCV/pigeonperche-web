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
//
// Vote : pendant la minute de salon, les joueurs humains votent pour la manche suivante. Le niveau règle l'étalement
// des tireurs (facile : les 15 emplacements les plus resserrés ; standard : les 25 ; avancé : toute la carte), et le
// vent est coupé ou tiré au hasard jusqu'à 5 m/s. La majorité l'emporte ; à égalité, on garde le réglage en cours.
//
// Tireurs automatiques : dès qu'un joueur humain est dans la salle, des robots occupent les places libres jusqu'à
// dix tireurs ; ils cèdent leur place aux humains qui arrivent et s'en vont quand le dernier humain part. Ils tirent
// peu et mal : une cible en vue toutes les quelques secondes, avec une chance de toucher qui fond avec la distance.

export const MAX_JOUEURS = 10;
export const RETOUR_MS = 5000;          // délai avant de reparaître sur un autre emplacement
export const CADENCE_MS = 1200;         // temps minimal entre deux tirs (la culasse)
export const MANCHE_MS = 240_000;       // durée d'une manche : 4 minutes
export const PAUSE_MS = 60_000;         // salon entre deux manches : 1 minute
export const CYCLE_MS = MANCHE_MS + PAUSE_MS;   // 5 minutes : les manches commencent à xx:00, xx:05, xx:10…
export const RECORDS_MAX = 20;          // lignes gardées dans chaque liste de records
const V_MAX = 1000;                     // m/s : aucune balle du jeu ne va plus vite
const TOL_DIST = 40;                    // m : écart admis entre la distance annoncée et celle des emplacements
/** Nombre d'emplacements ouverts selon le niveau voté : plus il y en a, plus les tireurs sont loin les uns des autres. */
export const NIVEAUX = { facile: 15, standard: 25, avance: Infinity };
export const VENT_MAX = 5;              // m/s
export const ROBOT_ATTENTE_MS = [5000, 14000];   // délai entre deux tirs d'un robot : entre 5 et 14 s
export const ROBOT_VISEE_MS = 2000;      // temps pendant lequel un robot tient sa cible avant de tirer
const ROBOT_VITESSE = 700;              // m/s : vitesse moyenne prêtée à sa balle pour le temps de vol
/** Chance qu'un robot touche à la distance `d` : 20 % à 400 m, 10 % à 800 m, 4 % au-delà de 2 km. */
export const adresseRobot = (d) => Math.max(0.04, Math.min(0.2, 80 / Math.max(d, 1)));

/** Points d'une touche : un point par tranche de 10 m. */
export const pointsPour = (dist) => Math.max(1, Math.round(dist / 10));
/** Du meilleur au pire : les points, puis le moins de touches subies, puis le plus de touches réussies. */
export const parRang = (a, b) => b.points - a.points || a.subies - b.subies || b.touches - a.touches;

const propre = (s, n = 16) => String(s ?? '').replace(/[\u0000-\u001f<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @param {{ emplacements: { nom: string, x: number, y: number, z: number }[], now?: () => number,
 *           later?: (fn: () => void, ms: number) => unknown, rand?: () => number,
 *           records?: { meilleurs?: object[], pires?: object[] }, onRecords?: (r: object) => void,
 *           robots?: string[], voit?: (a: string, b: string) => boolean }} opt
 *   `robots` : pseudos des tireurs automatiques (liste vide : aucun robot) ; `voit` : ligne de visée entre deux
 *   emplacements (par défaut tout le monde se voit)
 */
export function createManche({ emplacements, now = Date.now, later = (fn, ms) => setTimeout(fn, ms), rand = Math.random, records = {}, onRecords = () => {}, robots = [], voit = () => true }) {
  const joueurs = new Map();            // id → { id, pseudo, robot, emp, vivant, points, touches, tirs, subies, dernierTir, send }
  const spectateurs = new Map();        // id → send
  let suivant = 1, numero = 0, precedente = null;
  let meilleurs = (records.meilleurs ?? []).filter((l) => !l.robot), pires = (records.pires ?? []).filter((l) => !l.robot);

  /** Les `n` emplacements les plus resserrés : ceux qui tiennent dans le plus petit cercle centré sur l'un d'eux. */
  const zoneDe = (n) => {
    if (n >= emplacements.length) return new Set(emplacements.map((e) => e.nom));
    let best = null, br = Infinity;
    for (const c of emplacements) {
      const l = emplacements.map((e) => [Math.hypot(e.x - c.x, e.z - c.z), e.nom]).sort((a, b) => a[0] - b[0]).slice(0, n);
      if (l[n - 1][0] < br) { br = l[n - 1][0]; best = l; }
    }
    return new Set(best.map((x) => x[1]));
  };
  const ZONES = Object.fromEntries(Object.entries(NIVEAUX).map(([k, n]) => [k, zoneDe(n)]));
  let reglages = { niveau: 'standard', vent: null };      // vent : null, ou { vitesse (m/s), de (azimut d'où il vient, degrés) }
  const votes = new Map();                                // id du joueur → { vent: booléen, niveau }
  const decompte = () => { const d = { vent: { oui: 0, non: 0 }, niveau: { facile: 0, standard: 0, avance: 0 } }; for (const v of votes.values()) { if (v.vent != null) d.vent[v.vent ? 'oui' : 'non']++; if (v.niveau) d.niveau[v.niveau]++; } return d; };
  const libres = (sauf) => { const pris = new Set([...joueurs.values()].map((j) => j.emp)), z = ZONES[reglages.niveau]; return emplacements.filter((e) => z.has(e.nom) && !pris.has(e.nom) && e.nom !== sauf); };
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

  /** Applique à l'arrivée de la balle la touche de `tireur` sur `cible`, distants de `d` mètres. */
  const engage = (tireur, cible, d, tof) => {
    const id = tireur.id, idc = cible.id, empTireur = tireur.emp, empCible = cible.emp, n = numero;
    later(() => {
      // même manche, la cible encore là et debout, le tireur toujours dans la salle
      const t = joueurs.get(id), c = joueurs.get(idc);
      if (n !== numero || phase !== 'jeu' || !t || !c || !c.vivant || c.emp !== empCible) return;
      c.vivant = false; c.subies++; t.touches++; const pts = pointsPour(d); t.points += pts;
      pointe(c, null); for (const q of joueurs.values()) if (q.vise === idc) pointe(q, null);
      diffuse({ t: 'touche', tireur: id, cible: idc, emp: empCible, de: empTireur, dist: Math.round(d), points: pts, scores: [...joueurs.values()].map(vue) });
      later(() => {
        const k = joueurs.get(idc); if (!k || k.vivant) return;
        k.emp = tirage(k.emp) ?? k.emp; k.vivant = true;
        diffuse({ t: 'retour', id: k.id, emp: k.emp });
      }, RETOUR_MS);
    }, tof * 1000);
  };
  /**
   * Reflet de lunette : celui qui est visé reçoit, pour lui seul, l'annonce qu'un tireur le tient dans sa lunette
   * (il verra un éclat à son emplacement). `cible` nul : le tireur ne vise plus personne.
   */
  const pointe = (j, cible) => {
    const avant = j.vise ?? null, apres = cible && cible.id !== j.id && cible.vivant && j.vivant && phase === 'jeu' ? cible.id : null;
    if (avant === apres) return;
    j.vise = apres;
    if (avant != null) joueurs.get(avant)?.send({ t: 'vise', par: j.id, actif: false });
    if (apres != null) cible.send({ t: 'vise', par: j.id, actif: true });
  };
  const ecart = (a, b) => { const p = lieu(a.emp), q = lieu(b.emp); return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); };

  // ---------- tireurs automatiques ----------
  const entre = (pseudo, robot, send) => {
    const emp = tirage(); if (!emp) return null;
    const id = suivant++;
    const j = { id, pseudo: pseudoLibre(propre(pseudo, robot ? 24 : 16) || `Tireur ${id}`), robot, emp, vivant: true, points: 0, touches: 0, tirs: 0, subies: 0, dernierTir: -1e9, send };
    joueurs.set(id, j); return j;
  };
  const tourRobot = (id) => later(() => {
    const j = joueurs.get(id); if (!j) return;                       // le robot est parti : sa boucle s'arrête
    if (phase === 'jeu' && j.vivant) {
      const enVue = [...joueurs.values()].filter((c) => c.id !== id && c.vivant && voit(j.emp, c.emp));
      if (enVue.length) {
        // il épaule, tient sa cible deux secondes (elle voit son reflet), puis tire
        const c = enVue[Math.floor(rand() * enVue.length)], touche = rand() < adresseRobot(ecart(j, c)), n = numero;
        pointe(j, c);
        later(() => {
          const moi = joueurs.get(id), cible = joueurs.get(c.id);
          if (moi && cible && n === numero && phase === 'jeu' && moi.vivant && cible.vivant && moi.vise === cible.id) {
            const d = ecart(moi, cible); moi.dernierTir = now(); moi.tirs++; diffuse({ t: 'tir', id, emp: moi.emp, vers: cible.emp, touche });
            if (touche) engage(moi, cible, d, d / ROBOT_VITESSE);
          }
          if (moi) pointe(moi, null);
        }, ROBOT_VISEE_MS);
      }
    }
    tourRobot(id);
  }, ROBOT_ATTENTE_MS[0] + rand() * (ROBOT_ATTENTE_MS[1] - ROBOT_ATTENTE_MS[0]));
  /** Ajuste le nombre de robots : les places libres quand un humain est là, aucun sinon. */
  const equilibre = () => {
    if (!robots.length) return;                                     // pas de liste : la salle ne gère aucun robot
    const bots = [...joueurs.values()].filter((j) => j.robot), voulu = robots.length && humains() ? Math.max(0, MAX_JOUEURS - humains()) : 0;
    for (const j of bots.slice(voulu)) { joueurs.delete(j.id); diffuse({ t: 'part', id: j.id }); }
    for (let k = bots.length; k < voulu; k++) {
      const libresN = robots.filter((n) => ![...joueurs.values()].some((j) => j.pseudo === propre(n, 24))); if (!libresN.length) break;
      const j = entre(libresN[Math.floor(rand() * libresN.length)], true, () => {}); if (!j) break;
      diffuse({ t: 'arrive', joueur: vue(j) }); tourRobot(j.id);
    }
  };

  const debut = () => {
    numero++; phase = 'jeu';
    // dépouillement : la majorité l'emporte, l'égalité garde le réglage en cours
    const d = decompte(), n = Object.entries(d.niveau).sort((a, b) => b[1] - a[1]);
    const niveau = n[0][1] > n[1][1] ? n[0][0] : reglages.niveau;
    const venteux = d.vent.oui !== d.vent.non ? d.vent.oui > d.vent.non : !!reglages.vent;
    reglages = { niveau, vent: venteux ? { vitesse: Math.round((2 + rand() * (VENT_MAX - 2)) * 10) / 10, de: Math.floor(rand() * 360) } : null };
    votes.clear();
    // nouvelle manche : tout le monde est replacé au hasard dans la zone du niveau
    for (const j of joueurs.values()) { j.points = 0; j.touches = 0; j.tirs = 0; j.subies = 0; j.vivant = true; j.vise = null; j.emp = null; }
    for (const j of joueurs.values()) j.emp = tirage();
    diffuse({ t: 'debut', ...temps(), reglages, joueurs: [...joueurs.values()].map(vue) });
  };
  const fin = () => {
    for (const j of joueurs.values()) j.vise = null;
    const classement = [...joueurs.values()].sort(parRang).map(ligne);
    phase = 'pause';
    if (classement.length) {
      precedente = { fin: now(), classement };
      // records de toujours : les humains qui ont tiré au moins une fois ; les robots n'y entrent jamais
      const actifs = classement.filter((l) => l.tirs > 0 && !l.robot).map((l) => ({ ...l, date: now() }));
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
      if (humains() >= MAX_JOUEURS || (robot && joueurs.size >= MAX_JOUEURS)) { send({ t: 'complet' }); return null; }
      if (!robot && joueurs.size >= MAX_JOUEURS) { const b = [...joueurs.values()].find((q) => q.robot); if (b) { joueurs.delete(b.id); diffuse({ t: 'part', id: b.id }); } }
      const j = entre(pseudo, robot, send); if (!j) { send({ t: 'complet' }); return null; }
      send({ t: 'bienvenue', id: j.id, ...temps(), reglages, votes: decompte(), joueurs: [...joueurs.values()].map(vue) });
      diffuse({ t: 'arrive', joueur: vue(j) }, j.id);
      if (!robot) equilibre();
      return j.id;
    },
    /** Entrée d'un spectateur : il reçoit tout, n'occupe aucun emplacement. Refusée s'il n'y a aucun joueur humain. */
    watch(send) {
      if (humains() < 1) { send({ t: 'vide' }); return null; }
      const id = -(suivant++); spectateurs.set(id, send);
      send({ t: 'bienvenue', id, spectateur: true, ...temps(), reglages, votes: decompte(), joueurs: [...joueurs.values()].map(vue) });
      return id;
    },
    leave(id) { if (spectateurs.delete(id)) return; votes.delete(id); const p = joueurs.get(id); if (p) pointe(p, null); for (const q of joueurs.values()) if (q.vise === id) q.vise = null; if (joueurs.delete(id)) { diffuse({ t: 'part', id }); equilibre(); } },
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
      // emplacement et direction du canon : les autres en tirent la traçante, la flamme et la détonation
      const dir = Array.isArray(annonce.dir) && annonce.dir.length === 3 && annonce.dir.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.001) ? annonce.dir.map((v) => Math.round(v * 1e5) / 1e5) : null;
      diffuse({ t: 'tir', id, emp: j.emp, ...(dir ? { dir } : {}) }, id);
      if (annonce.cible == null) return 'ok';
      const c = joueurs.get(Number(annonce.cible)); if (!c || c.id === id) return 'cible inconnue';
      if (!c.vivant) return 'cible couchée';
      const d = ecart(j, c);
      const dist = Number(annonce.dist), tof = Number(annonce.tof);
      if (!(Math.abs(dist - d) <= TOL_DIST)) return 'distance';
      if (!(tof >= d / V_MAX && tof <= 12)) return 'temps de vol';
      engage(j, c, d, tof);
      return 'ok';
    },
    /** Vote d'un joueur humain pendant la minute de salon : { vent?: booléen, niveau?: 'facile' | 'standard' | 'avance' }. */
    vote(id, choix = {}) {
      const j = joueurs.get(id); if (!j || j.robot) return 'inconnu';
      if (phase !== 'pause') return 'hors salon';
      const v = votes.get(id) ?? {};
      if (typeof choix.vent === 'boolean') v.vent = choix.vent;
      if (choix.niveau in NIVEAUX) v.niveau = choix.niveau;
      votes.set(id, v); diffuse({ t: 'votes', votes: decompte() });
      return 'ok';
    },
    /** Le joueur `id` tient le joueur `cible` dans sa lunette (nul : plus personne). */
    aim(id, cible) { const j = joueurs.get(id); if (!j) return 'inconnu'; pointe(j, cible == null ? null : joueurs.get(Number(cible)) ?? null); return 'ok'; },
    /** Ce que le menu et le salon d'attente affichent, sans entrer dans la salle. */
    resume: () => ({ ...temps(), reglages, votes: decompte(), connectes: joueurs.size, humains: humains(), spectateurs: spectateurs.size, robots: joueurs.size - humains(), places: MAX_JOUEURS - humains(),
      joueurs: [...joueurs.values()].sort(parRang).map(ligne), precedente, meilleurs: meilleurs.slice(0, 5), pires: pires.slice(0, 5) }),
    etat: () => [...joueurs.values()].map(vue),
    zone: (niveau) => [...ZONES[niveau]],
    nombre: () => joueurs.size,
  };
}
