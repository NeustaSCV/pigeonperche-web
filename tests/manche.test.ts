// Manche multijoueur de la Ville nouvelle : arbitrage du serveur (server/manche.mjs), sans réseau.
import { describe, expect, it } from 'vitest';
// @ts-ignore module JavaScript du serveur, sans déclarations de types
import { createManche, pointsPour, adresseRobot, VIE_MAX, MAX_JOUEURS, RETOUR_MS, CADENCE_MS, MANCHE_MS, PAUSE_MS, ROBOT_ATTENTE_MS, ROBOT_VISEE_MS } from '../server/manche.mjs';
// @ts-ignore
import { ROBOTS } from '../server/robots.mjs';

const LIEUX = Array.from({ length: 12 }, (_, i) => ({ nom: `E${i}`, x: i * 500, y: 180, z: 0 }));

function salle(opt: any = {}) {
  let t = 0; const attente: { a: number; fn: () => void }[] = [];
  const gardes: any[] = [];
  const m = createManche({ emplacements: LIEUX, now: () => t, later: (fn: () => void, ms: number) => attente.push({ a: t + ms, fn }), rand: () => 0, onRecords: (r: any) => gardes.push(r), ...opt });
  // fait avancer l'horloge en exécutant les minuteries dans l'ordre du temps
  const avance = (ms: number) => { const but = t + ms; for (;;) { let i = -1; attente.forEach((x, k) => { if (x.a <= but && (i < 0 || x.a < attente[i].a)) i = k; }); if (i < 0) break; const x = attente.splice(i, 1)[0]; t = Math.max(t, x.a); x.fn(); } t = but; };
  const entre = (pseudo: string) => { const recu: any[] = []; const id = m.join(pseudo, (x: any) => recu.push(x)); return { id, recu }; };
  const dist = (a: number, b: number) => { const e = m.etat(); const p = (id: number) => LIEUX.find((l) => l.nom === e.find((j: any) => j.id === id).emp)!; return Math.abs(p(a).x - p(b).x); };
  return { m, avance, entre, dist, gardes };
}

describe('manche multijoueur', () => {
  it('place chaque joueur sur un emplacement libre et annonce les arrivées', () => {
    const { m, entre } = salle();
    const a = entre('Anna'), b = entre('<b>Bob</b>');
    const e = m.etat();
    expect(new Set(e.map((j: any) => j.emp)).size).toBe(2);
    expect(a.recu[0]).toMatchObject({ t: 'bienvenue', id: a.id });
    expect(a.recu.at(-1)).toMatchObject({ t: 'arrive', joueur: { id: b.id, pseudo: 'bBob/b' } });
    expect(b.recu[0].joueurs).toHaveLength(2);
  });
  it('refuse le onzième joueur', () => {
    const { entre } = salle();
    for (let i = 0; i < MAX_JOUEURS; i++) expect(entre(`J${i}`).id).not.toBeNull();
    const k = entre('de trop');
    expect(k.id).toBeNull(); expect(k.recu[0]).toEqual({ t: 'complet' });
  });
  it('applique la touche à l’arrivée de la balle, compte les points à la distance, puis fait reparaître la cible ailleurs', () => {
    const { m, avance, entre, dist } = salle();
    const a = entre('Anna'), b = entre('Bob'); const d = dist(a.id!, b.id!), avant = m.etat().find((j: any) => j.id === b.id).emp;
    expect(m.shot(a.id, { cible: b.id, dist: d + 5, tof: 1.5, zone: 'tete' })).toBe('ok');
    avance(1000); expect(m.etat().find((j: any) => j.id === b.id).vivant).toBe(true);
    avance(600);
    const eb = m.etat().find((j: any) => j.id === b.id), ea = m.etat().find((j: any) => j.id === a.id);
    expect(eb.vivant).toBe(false); expect(ea.points).toBe(Math.round(pointsPour(d) * 1.5)); expect(ea.touches).toBe(1);      // tir à la tête : 150 % des points
    expect(b.recu.at(-1)).toMatchObject({ t: 'touche', tireur: a.id, cible: b.id, dist: d });
    expect(m.shot(b.id, {})).toBe('couché');
    avance(RETOUR_MS);
    const apres = m.etat().find((j: any) => j.id === b.id);
    expect(apres.vivant).toBe(true); expect(apres.emp).not.toBe(avant);
    expect(a.recu.at(-1)).toMatchObject({ t: 'retour', id: b.id, emp: apres.emp });
  });
  it('refuse la cadence trop rapide, la distance fausse et le temps de vol impossible', () => {
    const { m, avance, entre, dist } = salle();
    const a = entre('Anna'), b = entre('Bob'); const d = dist(a.id!, b.id!);
    expect(m.shot(a.id, {})).toBe('ok');
    expect(m.shot(a.id, {})).toBe('cadence');
    avance(CADENCE_MS); expect(m.shot(a.id, { cible: b.id, dist: d + 400, tof: 2 })).toBe('distance');
    avance(CADENCE_MS); expect(m.shot(a.id, { cible: b.id, dist: d, tof: 0.01 })).toBe('temps de vol');
    avance(CADENCE_MS); expect(m.shot(a.id, { cible: 999, dist: d, tof: 1 })).toBe('cible inconnue');
    avance(20000); expect(m.etat().every((j: any) => j.vivant && j.points === 0)).toBe(true);
  });
  it('n’applique pas la touche si la cible est partie pendant le vol', () => {
    const { m, avance, entre, dist } = salle();
    const a = entre('Anna'), b = entre('Bob');
    m.shot(a.id, { cible: b.id, dist: dist(a.id!, b.id!), tof: 2 });
    m.leave(b.id); avance(3000);
    expect(m.etat()).toHaveLength(1); expect(m.etat()[0].points).toBe(0);
    expect(a.recu.at(-1)).toEqual({ t: 'part', id: b.id });
  });
  it('cale les manches sur l’horloge : 4 minutes de jeu, 1 minute de salon, classement gardé et points remis à zéro', () => {
    const { m, avance, entre, dist, gardes } = salle();
    const a = entre('Anna'), b = entre('Bob'); const d = dist(a.id!, b.id!);
    expect(a.recu[0]).toMatchObject({ phase: 'jeu', reste: MANCHE_MS });
    m.shot(a.id, { cible: b.id, dist: d, tof: 1 }); avance(2000);
    avance(MANCHE_MS - 2000 + 50);
    const fin = a.recu.at(-1);
    expect(fin).toMatchObject({ t: 'fin', phase: 'pause' });
    expect(fin.classement.map((l: any) => l.pseudo)).toEqual(['Anna', 'Bob']);
    expect(m.shot(a.id, {})).toBe('pause');
    const r = m.resume();
    expect(r).toMatchObject({ phase: 'pause', connectes: 2, humains: 2 });
    expect(r.precedente.classement[0]).toMatchObject({ pseudo: 'Anna', points: pointsPour(d), touches: 1 });
    expect(r.meilleurs).toHaveLength(1);          // Bob n'a pas tiré : il n'entre pas dans les records
    expect(gardes).toHaveLength(1);
    avance(PAUSE_MS);
    expect(a.recu.at(-1)).toMatchObject({ t: 'debut', phase: 'jeu' });
    expect(m.etat().every((j: any) => j.points === 0 && j.vivant)).toBe(true);
    expect(m.shot(a.id, {})).toBe('ok');
  });
  it('n’admet un spectateur que s’il y a au moins un joueur humain, et donne deux pseudos distincts à deux homonymes', () => {
    const { m, entre } = salle();
    const vu: any[] = [];
    expect(m.watch((x: any) => vu.push(x))).toBeNull(); expect(vu[0]).toEqual({ t: 'vide' });
    m.join('Robot', () => {}, { robot: true });
    expect(m.watch(() => {})).toBeNull();
    entre('Anna'); const autre = entre('anna');
    expect(m.etat().map((j: any) => j.pseudo)).toEqual(['Robot', 'Anna', 'anna 2']);
    const id = m.watch((x: any) => vu.push(x));
    expect(id).toBeLessThan(0); expect(vu.at(-1)).toMatchObject({ t: 'bienvenue', spectateur: true });
    expect(m.resume()).toMatchObject({ connectes: 3, humains: 2, spectateurs: 1 });
    expect(m.etat()[0].robot).toBe(true); expect(autre.id).not.toBeNull();
  });
  it('remplit les places libres de robots dès qu’un humain est là, leur fait céder la place, et les renvoie quand il part', () => {
    const { m, entre } = salle({ robots: ROBOTS });
    expect(m.resume()).toMatchObject({ connectes: 0, robots: 0 });
    const a = entre('Anna');
    expect(m.resume()).toMatchObject({ connectes: MAX_JOUEURS, humains: 1, robots: MAX_JOUEURS - 1, places: MAX_JOUEURS - 1 });
    const bots = m.etat().filter((j: any) => j.robot);
    expect(new Set(bots.map((j: any) => j.pseudo)).size).toBe(MAX_JOUEURS - 1);
    expect(bots.every((j: any) => ROBOTS.includes(j.pseudo))).toBe(true);
    expect(new Set(m.etat().map((j: any) => j.emp)).size).toBe(MAX_JOUEURS);
    expect(a.recu.filter((x: any) => x.t === 'arrive' && x.joueur.robot)).toHaveLength(MAX_JOUEURS - 1);
    const b = entre('Bob');
    expect(b.id).not.toBeNull();
    expect(m.resume()).toMatchObject({ connectes: MAX_JOUEURS, humains: 2, robots: MAX_JOUEURS - 2 });
    m.leave(b.id); expect(m.resume()).toMatchObject({ humains: 1, robots: MAX_JOUEURS - 1 });
    m.leave(a.id); expect(m.resume()).toMatchObject({ connectes: 0, humains: 0, robots: 0 });
  });
  it('fait tirer les robots sur ce qu’ils voient seulement, et applique leurs touches comme celles des joueurs', () => {
    // un seul robot (salle réduite à deux emplacements) ; rand = 0 : il tire au plus tôt et touche à tous les coups
    const deux = LIEUX.slice(0, 2);
    const aveugle = salle({ robots: ROBOTS, emplacements: deux, voit: () => false });
    const a0 = aveugle.entre('Anna'); aveugle.avance(60_000);
    expect(a0.recu.some((x: any) => x.t === 'tir' || x.t === 'touche')).toBe(false);
    const { m, avance, entre } = salle({ robots: ROBOTS, emplacements: deux });
    const a = entre('Anna'); const bot = m.etat().find((j: any) => j.robot);
    avance(ROBOT_ATTENTE_MS[0] + 10);
    expect(a.recu.at(-1)).toEqual({ t: 'vise', par: bot.id, actif: true });     // il épaule : sa cible voit le reflet
    avance(ROBOT_VISEE_MS);
    expect(a.recu.filter((x: any) => x.t === 'tir')).toEqual([{ t: 'tir', id: bot.id, emp: bot.emp, vers: m.etat().find((j: any) => j.id === a.id).emp, touche: true }]);
    expect(a.recu.at(-1)).toEqual({ t: 'vise', par: bot.id, actif: false });
    avance(2000);
    const t = a.recu.find((x: any) => x.t === 'touche');
    expect(t).toMatchObject({ tireur: bot.id, cible: a.id, dist: 500, zone: 'tete', points: Math.round(pointsPour(500) * 1.5) });      // rand = 0 : dans la tête
    expect(m.etat().find((j: any) => j.id === a.id).vivant).toBe(false);
    expect(adresseRobot(400)).toBeCloseTo(0.2); expect(adresseRobot(800)).toBeCloseTo(0.1); expect(adresseRobot(3000)).toBe(0.04);
  });
  it('n’inscrit jamais un robot aux records de toujours, mais le garde au classement de la partie', () => {
    const deux = LIEUX.slice(0, 2);
    const { m, avance, entre, gardes } = salle({ robots: ROBOTS, emplacements: deux });
    const a = entre('Anna'); const bot = m.etat().find((j: any) => j.robot);
    avance(CADENCE_MS); expect(m.shot(a.id, {})).toBe('ok');
    avance(MANCHE_MS);                                             // le robot touche à tous les coups (rand = 0)
    const r = m.resume();
    expect(r.precedente.classement.map((l: any) => l.pseudo)).toEqual([bot.pseudo, 'Anna']);
    expect(r.precedente.classement[0].points).toBeGreaterThan(0);
    expect(r.meilleurs.map((l: any) => l.pseudo)).toEqual(['Anna']);
    expect(r.pires.map((l: any) => l.pseudo)).toEqual(['Anna']);
    expect(gardes.at(-1).meilleurs.some((l: any) => l.robot)).toBe(false);
  });
  it('n’annonce le reflet de lunette qu’à celui qui est visé, et l’éteint quand le tireur vise ailleurs ou s’en va', () => {
    const { m, entre } = salle();
    const a = entre('Anna'), b = entre('Bob'), c = entre('Chloé');
    const vus = (j: any) => j.recu.filter((x: any) => x.t === 'vise');
    expect(m.aim(a.id, b.id)).toBe('ok'); m.aim(a.id, b.id);
    expect(vus(b)).toEqual([{ t: 'vise', par: a.id, actif: true }]); expect(vus(c)).toEqual([]); expect(vus(a)).toEqual([]);
    m.aim(a.id, c.id);
    expect(vus(b).at(-1)).toEqual({ t: 'vise', par: a.id, actif: false }); expect(vus(c)).toEqual([{ t: 'vise', par: a.id, actif: true }]);
    m.leave(a.id);
    expect(vus(c).at(-1)).toEqual({ t: 'vise', par: a.id, actif: false });
  });
  it('applique le vote de la minute de salon : niveau à la majorité, vent jusqu’à 5 m/s, égalité = réglage en cours', () => {
    // 30 emplacements : 20 serrés de 100 m à l'ouest, 10 espacés de 1 km à l'est
    const carte = [...Array.from({ length: 20 }, (_, i) => ({ nom: `S${i}`, x: i * 100, y: 180, z: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ nom: `L${i}`, x: 10000 + i * 1000, y: 180, z: 0 }))];
    const { m, avance, entre } = salle({ emplacements: carte });
    expect(m.zone('facile')).toHaveLength(15); expect(m.zone('standard')).toHaveLength(25); expect(m.zone('avance')).toHaveLength(30);
    expect(m.zone('facile').every((n: string) => n.startsWith('S'))).toBe(true);
    const a = entre('Anna'), b = entre('Bob'), c = entre('Chloé');
    expect(a.recu[0].reglages).toEqual({ niveau: 'standard', vent: null });
    expect(m.vote(a.id, { niveau: 'facile' })).toBe('hors salon');
    avance(MANCHE_MS + 50);
    expect(m.vote(a.id, { niveau: 'facile', vent: true })).toBe('ok');
    m.vote(b.id, { niveau: 'facile', vent: true }); m.vote(c.id, { niveau: 'avance', vent: false });
    m.vote(c.id, { niveau: 'n’importe quoi' as any });
    expect(a.recu.at(-1)).toEqual({ t: 'votes', votes: { vent: { oui: 2, non: 1 }, niveau: { facile: 2, standard: 0, avance: 1 } } });
    avance(PAUSE_MS);
    const d = a.recu.at(-1);
    expect(d).toMatchObject({ t: 'debut', reglages: { niveau: 'facile' } });
    expect(d.reglages.vent.vitesse).toBeGreaterThanOrEqual(2); expect(d.reglages.vent.vitesse).toBeLessThanOrEqual(5);
    expect(d.joueurs.every((j: any) => j.emp.startsWith('S'))).toBe(true);            // tout le monde replacé dans la zone serrée
    expect(new Set(d.joueurs.map((j: any) => j.emp)).size).toBe(3);
    // manche suivante : un vote pour, un vote contre le vent, personne sur le niveau → rien ne change
    avance(MANCHE_MS); m.vote(a.id, { vent: false }); m.vote(b.id, { vent: true }); avance(PAUSE_MS);
    expect(a.recu.at(-1).reglages.niveau).toBe('facile'); expect(a.recu.at(-1).reglages.vent).not.toBeNull();
    // puis la majorité coupe le vent
    avance(MANCHE_MS); m.vote(a.id, { vent: false }); m.vote(b.id, { vent: false, niveau: 'avance' }); avance(PAUSE_MS);
    expect(a.recu.at(-1).reglages).toEqual({ niveau: 'avance', vent: null });
  });
  it('relaie aux autres l’emplacement et la direction du canon de chaque tir, et écarte une direction fantaisiste', () => {
    const { m, avance, entre } = salle();
    const a = entre('Anna'), b = entre('Bob'); const emp = m.etat().find((j: any) => j.id === a.id).emp;
    m.shot(a.id, { dir: [0.6, 0.01, -0.8] });
    expect(b.recu.at(-1)).toEqual({ t: 'tir', id: a.id, emp, dir: [0.6, 0.01, -0.8] });
    expect(a.recu.some((x: any) => x.t === 'tir')).toBe(false);          // le tireur ne reçoit pas son propre tir
    avance(CADENCE_MS); m.shot(a.id, { dir: [5, 'x', NaN] as any });
    expect(b.recu.at(-1)).toEqual({ t: 'tir', id: a.id, emp });
  });
  it('compte deux points de vie : le corps en retire un, la tête abat d’un coup, et la vie revient au retour', () => {
    const { m, avance, entre, dist } = salle();
    const a = entre('Anna'), b = entre('Bob'), c = entre('Chloé'); const dab = dist(a.id!, b.id!), dac = dist(a.id!, c.id!);
    const de = (id: number) => m.etat().find((j: any) => j.id === id);
    expect(de(b.id!).vie).toBe(VIE_MAX);
    // première balle dans le corps : Bob perd un point, reste debout, peut encore tirer
    m.shot(a.id, { cible: b.id, dist: dab, tof: 1, zone: 'corps' }); avance(1100);
    expect(de(b.id!)).toMatchObject({ vie: 1, vivant: true });
    expect(b.recu.at(-1)).toMatchObject({ t: 'touche', zone: 'corps', vie: 1, abattu: false, cible: b.id });
    expect(m.shot(b.id, {})).toBe('ok');
    // deuxième balle dans le corps : abattu
    avance(CADENCE_MS); m.shot(a.id, { cible: b.id, dist: dab, tof: 1 }); avance(1100);
    expect(de(b.id!)).toMatchObject({ vie: 0, vivant: false });
    expect(b.recu.at(-1)).toMatchObject({ t: 'touche', abattu: true, vie: 0 });
    // une balle dans la tête : Chloé, intacte, est abattue d'un coup
    avance(CADENCE_MS); m.shot(a.id, { cible: c.id, dist: dac, tof: 1, zone: 'tete' }); avance(1100);
    expect(de(c.id!)).toMatchObject({ vie: 0, vivant: false });
    expect(de(a.id!)).toMatchObject({ touches: 3, points: pointsPour(dab) * 2 + Math.round(pointsPour(dac) * 1.5) });
    avance(RETOUR_MS);
    expect(de(b.id!)).toMatchObject({ vie: VIE_MAX, vivant: true }); expect(de(c.id!)).toMatchObject({ vie: VIE_MAX, vivant: true });
  });
});
