// Manche multijoueur de la Ville nouvelle : arbitrage du serveur (server/manche.mjs), sans réseau.
import { describe, expect, it } from 'vitest';
// @ts-ignore module JavaScript du serveur, sans déclarations de types
import { createManche, pointsPour, MAX_JOUEURS, RETOUR_MS, CADENCE_MS } from '../server/manche.mjs';

const LIEUX = Array.from({ length: 12 }, (_, i) => ({ nom: `E${i}`, x: i * 500, y: 180, z: 0 }));

function salle() {
  let t = 0; const attente: { a: number; fn: () => void }[] = [];
  const m = createManche({ emplacements: LIEUX, now: () => t, later: (fn: () => void, ms: number) => attente.push({ a: t + ms, fn }), rand: () => 0 });
  const avance = (ms: number) => { t += ms; for (;;) { const i = attente.findIndex((x) => x.a <= t); if (i < 0) break; attente.splice(i, 1)[0].fn(); } };
  const entre = (pseudo: string) => { const recu: any[] = []; const id = m.join(pseudo, (x: any) => recu.push(x)); return { id, recu }; };
  const dist = (a: number, b: number) => { const e = m.etat(); const p = (id: number) => LIEUX.find((l) => l.nom === e.find((j: any) => j.id === id).emp)!; return Math.abs(p(a).x - p(b).x); };
  return { m, avance, entre, dist };
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
    expect(m.shot(a.id, { cible: b.id, dist: d + 5, tof: 1.5 })).toBe('ok');
    avance(1000); expect(m.etat().find((j: any) => j.id === b.id).vivant).toBe(true);
    avance(600);
    const eb = m.etat().find((j: any) => j.id === b.id), ea = m.etat().find((j: any) => j.id === a.id);
    expect(eb.vivant).toBe(false); expect(ea.points).toBe(pointsPour(d)); expect(ea.touches).toBe(1);
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
});
