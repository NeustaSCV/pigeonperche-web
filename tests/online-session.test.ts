// Session du mode en ligne (src/online/session.ts) déroulée contre le vrai arbitrage du serveur (server/manche.mjs),
// sans réseau : le faux transport fait ce que fait server/manche-api.mjs (jeton, flux, POST), en appels directs.
import { describe, expect, it } from 'vitest';
// @ts-ignore module JavaScript du serveur, sans déclarations de types
import { createManche, pointsPour, MAX_JOUEURS, RETOUR_MS, CADENCE_MS, DIVERSION_MS, MANCHE_MS, PAUSE_MS } from '../server/manche.mjs';
import { Session, texteVent, type MsgDiversion, type MsgTir, type MsgTouche, type MsgVise, type SessionEvents, type SessionTransport } from '../src/online/session';

const LIEUX = Array.from({ length: 12 }, (_, i) => ({ nom: `E${i}`, x: i * 500, y: 180, z: 0 }));
const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x));      // ce qui passe par le réseau est sérialisé

function monde(opt: Record<string, unknown> = {}) {
  let t = 0; const attente: { a: number; fn: () => void }[] = [];
  const m = createManche({ emplacements: LIEUX, now: () => t, later: (fn: () => void, ms: number) => attente.push({ a: t + ms, fn }), rand: () => 0, ...opt });
  // fait avancer l'horloge en exécutant les minuteries dans l'ordre du temps
  const avance = (ms: number) => { const but = t + ms; for (;;) { let i = -1; attente.forEach((x, k) => { if (x.a <= but && (i < 0 || x.a < attente[i].a)) i = k; }); if (i < 0) break; const x = attente.splice(i, 1)[0]; t = Math.max(t, x.a); x.fn(); } t = but; };
  const jetons = new Map<number, string>(); let n = 0, panne = false;
  const posts: { action: string; corps: Record<string, unknown>; r: unknown }[] = [];
  /** Un poste client : sa session, son transport, de quoi couper son flux, et le journal de ses événements. */
  const client = () => {
    let coupe = () => {};
    const transport: SessionTransport = {
      summary: () => (panne ? Promise.reject(new Error('hors service')) : Promise.resolve(copie(m.resume()))),
      open(qui, onMessage, onError) {
        const jeton = 'jeton' + ++n, send = (msg: any) => onMessage(copie(msg));
        const id: number | null = 'pseudo' in qui ? m.join(qui.pseudo, (msg: any) => send(msg.t === 'bienvenue' ? { ...msg, jeton } : msg)) : m.watch(send);
        let ouvert = id != null;
        if (id != null && id > 0) jetons.set(id, jeton);
        const ferme = () => { if (!ouvert) return; ouvert = false; jetons.delete(id!); m.leave(id); };
        coupe = () => { ferme(); onError(); };
        return { close: ferme };
      },
      post(action, a: any) {
        const id = Number(a?.id);
        const r = jetons.get(id) !== a?.jeton ? { erreur: 'joueur inconnu' }
          : { r: action === 'diversion' ? m.diversion(id) : action === 'vise' ? m.aim(id, a.cible ?? null) : action === 'vote' ? m.vote(id, { vent: a.vent, niveau: a.niveau }) : m.shot(id, { cible: a.cible, dist: a.dist, tof: a.tof, dir: a.dir, zone: a.zone }) };
        posts.push({ action, corps: copie(a), r });
        return Promise.resolve(r);
      },
    };
    const s = new Session(transport, () => t);
    const vus: { t: keyof SessionEvents; m: any }[] = [];
    for (const k of ['bienvenue', 'arrive', 'part', 'tir', 'touche', 'retour', 'votes', 'vise', 'fin', 'debut', 'diversion', 'complet', 'vide', 'perdu'] as const) s.on(k, (msg) => vus.push({ t: k, m: msg }));
    const dernier = <T>(k: keyof SessionEvents): T => vus.filter((v) => v.t === k).at(-1)?.m as T;
    return { s, vus, dernier, coupe: () => coupe() };
  };
  const ecart = (a: string, b: string) => Math.abs(LIEUX.find((l) => l.nom === a)!.x - LIEUX.find((l) => l.nom === b)!.x);
  return { m, avance, client, posts, ecart, panne: (v: boolean) => { panne = v; }, t: () => t };
}

describe('session du mode en ligne', () => {
  it('lit l’état de la salle avant d’entrer, et signale un serveur muet', async () => {
    const w = monde(), a = w.client();
    await a.s.refresh();
    expect(a.s.server).toBe(true); expect(a.s.role).toBeNull(); expect(a.s.inLobby).toBe(true);
    expect(a.s.phase).toBe('jeu'); expect(a.s.remaining()).toBe(MANCHE_MS);
    expect(a.s.summary).toMatchObject({ connectes: 0, humains: 0, places: MAX_JOUEURS });
    w.panne(true); await a.s.refresh(); expect(a.s.server).toBe(false);
    w.panne(false); await a.s.refresh(); expect(a.s.server).toBe(true);
  });

  it('arrivée : le joueur reçoit sa place, les autres le voient entrer', () => {
    const w = monde(), a = w.client(), b = w.client();
    let changements = 0; a.s.on('change', () => changements++);
    a.s.join('Anna');
    expect(a.s.role).toBe('joueur'); expect(a.s.welcomed).toBe(true); expect(a.s.online).toBe(true);
    expect(a.s.inLobby).toBe(false);                                  // la manche est en cours : on entre directement
    expect(a.s.self).toMatchObject({ pseudo: 'Anna', emp: 'E0', vivant: true, vie: 2, points: 0 }); expect(a.s.life).toBe(2);
    expect(a.s.announce).toBe('Seul pour l’instant : en attente d’un autre tireur.');
    expect(changements).toBeGreaterThan(0);
    b.s.join('Bob');
    expect(b.s.announce).toBe('Trouvez les autres tireurs.');
    expect(a.vus.at(-1)).toMatchObject({ t: 'arrive', m: { joueur: { pseudo: 'Bob', emp: 'E1' } } });
    expect(a.s.players.size).toBe(2); expect(b.s.players.size).toBe(2);
    expect(a.s.announce).toBe('Bob entre dans la salle.');
    expect(a.s.playerAt('E1')?.id).toBe(b.s.me); expect(a.s.nameAt('E1')).toBe('Bob'); expect(a.s.playerAt('E0')).toBeUndefined();
    expect([...a.s.occupied()]).toEqual(['E1']);
    a.s.join('Encore');                                              // déjà dans la salle : sans effet
    expect(w.m.nombre()).toBe(2);
  });

  it('tir, touche au corps, touche à la tête, retour', () => {
    const w = monde(), a = w.client(), b = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    const ida = a.s.me!, idb = b.s.me!, d = w.ecart('E0', 'E1');
    // un tir dans le vide : les autres reçoivent l'emplacement et la direction du canon
    a.s.shoot({ dir: [0.6, 0.1, -0.8] });
    expect(w.posts.at(-1)).toMatchObject({ action: 'tir', r: { r: 'ok' } });
    expect(b.dernier<MsgTir>('tir')).toEqual({ t: 'tir', id: ida, emp: 'E0', dir: [0.6, 0.1, -0.8] });
    expect(b.s.players.get(ida)!.tirs).toBe(1);
    expect(a.vus.some((v) => v.t === 'tir')).toBe(false);            // le tireur ne reçoit pas son propre tir
    // trop tôt : la culasse
    a.s.shoot({ dir: [1, 0, 0] }); expect(w.posts.at(-1)!.r).toEqual({ r: 'cadence' });

    // balle dans le corps : appliquée à l'arrivée de la balle, un point de vie en moins
    w.avance(CADENCE_MS);
    a.s.shoot({ dir: [1, 0, 0], cible: idb, dist: d + 3, tof: 1.5, zone: 'corps' });
    expect(w.posts.at(-1)!.r).toEqual({ r: 'ok' });
    w.avance(1400); expect(b.s.life).toBe(2);
    w.avance(200);
    const corps = b.dernier<MsgTouche>('touche');
    expect(corps).toMatchObject({ tireur: ida, cible: idb, emp: 'E1', de: 'E0', dist: d, points: pointsPour(d), zone: 'corps', vie: 1, abattu: false });
    expect(b.s.life).toBe(1); expect(b.s.self!.vivant).toBe(true); expect(b.s.self!.subies).toBe(1);
    expect(a.s.self).toMatchObject({ points: pointsPour(d), touches: 1, tirs: 2 });      // le tir refusé pour cadence ne compte pas
    expect(a.s.announce).toBe(`Touché au corps : Bob à ${d} m, +${pointsPour(d)} points.`);
    expect(b.s.announce).toBe(`Anna touche Bob à ${d} m.`);
    expect(a.s.playerAt('E1')?.vie).toBe(1);

    // balle dans la tête : abattu d'un coup, 150 % des points
    w.avance(CADENCE_MS);
    a.s.shoot({ dir: [1, 0, 0], cible: idb, dist: d, tof: 1.5, zone: 'tete' });
    w.avance(1600);
    const tete = Math.round(pointsPour(d) * 1.5);
    expect(a.dernier<MsgTouche>('touche')).toMatchObject({ zone: 'tete', vie: 0, abattu: true, points: tete });
    expect(b.s.life).toBe(0); expect(b.s.self!.vivant).toBe(false);
    expect(a.s.self!.points).toBe(pointsPour(d) + tete);
    expect(a.s.announce).toBe(`Abattu à la tête : Bob à ${d} m, +${tete} points.`);
    expect(b.s.announce).toBe(`Anna abat Bob à ${d} m.`);
    expect(a.s.playerAt('E1')).toBeUndefined(); expect(a.s.occupied().size).toBe(0);
    b.s.shoot({ dir: [1, 0, 0] }); expect(w.posts.at(-1)!.r).toEqual({ r: 'couché' });

    // retour 5 secondes plus tard, ailleurs, avec toute sa vie
    w.avance(RETOUR_MS - 110); expect(b.s.life).toBe(0);      // la touche date de 100 ms
    w.avance(10);
    expect(b.vus.at(-1)).toMatchObject({ t: 'retour', m: { id: idb } });
    expect(b.s.life).toBe(2); expect(b.s.self!.emp).not.toBe('E1');
    expect(a.s.playerAt(b.s.self!.emp)?.id).toBe(idb);
  });

  it('reflet de lunette : seul le tireur visé est prévenu, et seuls les changements partent', () => {
    const w = monde(), a = w.client(), b = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    a.s.aim(b.s.me); a.s.aim(b.s.me);
    expect(w.posts.filter((p) => p.action === 'vise')).toHaveLength(1);
    expect(b.dernier<MsgVise>('vise')).toEqual({ t: 'vise', par: a.s.me, actif: true });
    expect(a.vus.some((v) => v.t === 'vise')).toBe(false);
    a.s.aim(null);
    expect(b.dernier<MsgVise>('vise')).toEqual({ t: 'vise', par: a.s.me, actif: false });
  });

  it('spectateur : refusé sans joueur humain, admis ensuite, sans place ni tir', () => {
    const w = monde(), a = w.client(), c = w.client();
    c.s.watch();
    expect(c.vus.at(-1)!.t).toBe('vide'); expect(c.s.role).toBeNull(); expect(c.s.announce).toBe('Plus aucun joueur dans la salle.');
    a.s.join('Anna'); c.s.watch();
    expect(c.s.role).toBe('spectateur'); expect(c.s.welcomed).toBe(true); expect(c.s.me).toBeNull(); expect(c.s.online).toBe(false);
    expect(c.s.players.size).toBe(1); expect(w.m.nombre()).toBe(1);
    const avant = w.posts.length; c.s.shoot({ dir: [1, 0, 0] }); c.s.aim(a.s.me);
    expect(w.posts.length).toBe(avant);
    c.s.leave(); expect(c.s.role).toBeNull(); expect(c.s.inLobby).toBe(true);
  });

  it('fin de manche, vote, début de la suivante', async () => {
    const w = monde(), a = w.client(), b = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    const d = w.ecart('E0', 'E1');
    a.s.shoot({ dir: [1, 0, 0], cible: b.s.me!, dist: d, tof: 1, zone: 'corps' }); w.avance(1000);
    // voter pendant la manche : refusé par le serveur
    a.s.vote({ vent: true }); expect(w.posts.at(-1)!.r).toEqual({ r: 'hors salon' });

    w.avance(MANCHE_MS - w.t() + 20);
    expect(a.vus.at(-1)!.t).toBe('fin');
    expect(a.s.phase).toBe('pause'); expect(a.s.inLobby).toBe(true); expect(a.s.announce).toBe('Manche terminée.');
    expect(a.s.remaining()).toBe(PAUSE_MS - 20);
    expect(a.s.lastRanking).toEqual([
      { pseudo: 'Anna', robot: false, points: pointsPour(d), touches: 1, tirs: 1, subies: 0 },
      { pseudo: 'Bob', robot: false, points: 0, touches: 0, tirs: 0, subies: 1 },
    ]);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();      // la relecture du résumé lancée par « fin »
    expect(a.s.summary!.precedente!.classement[0].pseudo).toBe('Anna');
    expect(a.s.summary!.meilleurs.map((l) => l.pseudo)).toEqual(['Anna']);       // Bob n'a pas tiré : pas de record
    a.s.shoot({ dir: [1, 0, 0] }); expect(w.posts.at(-1)!.r).toEqual({ r: 'pause' });

    // vote : chacun voit le décompte, la majorité l'emporte
    a.s.vote({ vent: true }); a.s.vote({ niveau: 'facile' }); b.s.vote({ niveau: 'facile' });
    expect(a.s.myVote).toEqual({ vent: true, niveau: 'facile' });
    expect(b.s.votes).toEqual({ vent: { oui: 1, non: 0 }, niveau: { facile: 2, standard: 0, avance: 0 } });
    expect(a.s.votes).toEqual(b.s.votes);

    w.avance(PAUSE_MS);
    expect(a.vus.at(-1)!.t).toBe('debut');
    expect(a.s.phase).toBe('jeu'); expect(a.s.inLobby).toBe(false); expect(a.s.remaining()).toBe(MANCHE_MS - 20);
    expect(a.s.settings).toEqual({ niveau: 'facile', vent: { vitesse: 2, de: 0 } });
    expect(a.s.myVote).toEqual({}); expect(a.s.votes).toBeNull();
    expect(a.s.self).toMatchObject({ points: 0, touches: 0, tirs: 0, subies: 0, vivant: true, vie: 2 });
    expect(a.s.announce).toBe('Nouvelle manche : facile (15 emplacements serrés), vent de 2 m/s venant du nord.');
    expect(new Set(a.s.ranking().map((j) => j.emp)).size).toBe(2);
    expect(a.s.ranking().map((j) => j.emp).sort()).toEqual(b.s.ranking().map((j) => j.emp).sort());
  });

  it('perte du flux : retour au salon ; reprise : une nouvelle place', async () => {
    const w = monde(), a = w.client(), b = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    const ancien = a.s.me;
    a.coupe();
    expect(a.vus.at(-1)!.t).toBe('perdu');
    expect(a.s.role).toBeNull(); expect(a.s.welcomed).toBe(false); expect(a.s.me).toBeNull(); expect(a.s.online).toBe(false);
    expect(a.s.inLobby).toBe(true); expect(a.s.players.size).toBe(0); expect(a.s.announce).toBe('Connexion à la manche perdue.');
    expect(b.vus.at(-1)).toMatchObject({ t: 'part', m: { id: ancien } }); expect(b.s.announce).toBe('Anna quitte la salle.'); expect(b.s.players.size).toBe(1);
    const avant = w.posts.length; a.s.shoot({ dir: [1, 0, 0] }); expect(w.posts.length).toBe(avant);      // hors de la salle : rien ne part
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(a.s.summary!.connectes).toBe(1);                         // le salon retrouve l'état de la salle
    // reprise
    a.s.join('Anna');
    expect(a.s.role).toBe('joueur'); expect(a.s.welcomed).toBe(true); expect(a.s.me).not.toBe(ancien); expect(a.s.players.size).toBe(2);
    expect(b.vus.at(-1)).toMatchObject({ t: 'arrive', m: { joueur: { pseudo: 'Anna' } } });
    a.s.shoot({ dir: [1, 0, 0] }); expect(w.posts.at(-1)!.r).toEqual({ r: 'ok' });      // le nouveau jeton est le bon
    // un message d'un flux fermé n'atteint plus la session
    a.s.leave(); const n = a.vus.length; b.s.shoot({ dir: [1, 0, 0] }); expect(a.vus.length).toBe(n);
  });

  it('salle complète : le onzième est renvoyé au salon', () => {
    const w = monde(), tous = Array.from({ length: MAX_JOUEURS }, () => w.client());
    tous.forEach((c, i) => c.s.join(`J${i}`));
    const k = w.client(); k.s.join('De trop');
    expect(k.vus.at(-1)!.t).toBe('complet'); expect(k.s.role).toBeNull(); expect(k.s.announce).toBe('La salle est complète (10 tireurs).');
    expect(w.m.nombre()).toBe(MAX_JOUEURS);
  });

  it('robots : signalés dans la salle, absents du classement global', async () => {
    const w = monde({ robots: ['Robot Un', 'Robot Deux', 'Robot Trois', 'Robot Quatre', 'Robot Cinq', 'Robot Six', 'Robot Sept', 'Robot Huit', 'Robot Neuf'] }), a = w.client();
    a.s.join('Anna');
    expect(a.s.players.size).toBe(MAX_JOUEURS);
    const robots = a.s.ranking().filter((j) => j.robot);
    expect(robots).toHaveLength(MAX_JOUEURS - 1);
    expect(a.s.nameAt(robots[0].emp)).toBe('🤖 ' + robots[0].pseudo);
    a.s.shoot({ dir: [1, 0, 0] });
    w.avance(MANCHE_MS - w.t() + 20);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(a.s.summary!.meilleurs.every((l) => !l.robot)).toBe(true);
    expect(a.s.summary!.meilleurs.map((l) => l.pseudo)).toEqual(['Anna']);
  });

  it('son propre compteur de tirs monte à chaque tir accepté, sans attendre une touche', async () => {
    const w = monde(), a = w.client(), b = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    let changements = 0; a.s.on('change', () => changements++);
    a.s.shoot({ dir: [1, 0, 0] }); await Promise.resolve(); await Promise.resolve();
    expect(a.s.self!.tirs).toBe(1); expect(changements).toBe(1);
    expect(b.s.players.get(a.s.me!)!.tirs).toBe(1);                  // les autres le comptent par le message « tir »
    // refusé pour la cadence : il ne compte pas
    a.s.shoot({ dir: [1, 0, 0] }); await Promise.resolve(); await Promise.resolve();
    expect(a.s.self!.tirs).toBe(1);
    w.avance(CADENCE_MS); a.s.shoot({ dir: [1, 0, 0] }); await Promise.resolve(); await Promise.resolve();
    expect(a.s.self!.tirs).toBe(2);
    expect(w.m.etat().find((j: any) => j.id === a.s.me).tirs).toBe(2);
  });

  it('diversion : tous l’entendent, le même son, dix secondes au moins entre deux', () => {
    const w = monde({ rand: () => 0.5 }), a = w.client(), b = w.client(), c = w.client();
    a.s.join('Anna'); b.s.join('Bob');
    a.s.divert();
    expect(w.posts.at(-1)).toMatchObject({ action: 'diversion', r: { r: 'ok' } });
    const recu = b.dernier<MsgDiversion>('diversion');
    expect(recu).toEqual({ t: 'diversion', id: a.s.me, emp: a.s.self!.emp, son: 3 });
    expect(a.dernier<MsgDiversion>('diversion')).toEqual(recu);      // l'auteur la reçoit aussi : il s'entend de près
    // trop tôt : refusée, personne ne reçoit rien
    w.avance(DIVERSION_MS - 1); a.s.divert();
    expect(w.posts.at(-1)!.r).toEqual({ r: 'cadence' });
    expect(b.vus.filter((v) => v.t === 'diversion')).toHaveLength(1);
    w.avance(1); a.s.divert();
    expect(w.posts.at(-1)!.r).toEqual({ r: 'ok' });
    expect(b.vus.filter((v) => v.t === 'diversion')).toHaveLength(2);
    // un spectateur n'en fait pas, mais l'entend
    c.s.watch(); const avant = w.posts.length; c.s.divert(); expect(w.posts.length).toBe(avant);
    b.s.divert(); expect(c.dernier<MsgDiversion>('diversion')).toMatchObject({ id: b.s.me });
  });

  it('vent : « venant de l’est », « de l’ouest », « du nord »', () => {
    expect(texteVent({ vitesse: 3.5, de: 90 })).toBe('vent de 3,5 m/s venant de l’est');
    expect(texteVent({ vitesse: 2, de: 270 })).toBe('vent de 2 m/s venant de l’ouest');
    expect(texteVent({ vitesse: 2, de: 0 })).toBe('vent de 2 m/s venant du nord');
    expect(texteVent({ vitesse: 2, de: 225 })).toBe('vent de 2 m/s venant du sud-ouest');
    expect(texteVent(null)).toBe('sans vent');
  });
});
