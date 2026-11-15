// Pédagogie du mrad dans le tutoriel (src/game/tutorial.ts) : c'est un angle, donc une taille qui grandit avec la
// distance. Une étape lui est consacrée, et le carnet puis la tourelle en donnent l'équivalent sur la cible.
import { describe, expect, it } from 'vitest';
import { MRAD_STUDY, TUTO_STEPS, Tutorial, milSize, type TutoSnap } from '../src/game/tutorial';

const snap = (o: Partial<TutoSnap> = {}): TutoSnap => ({
  site: { post: 'pas', near: 'plate1', far: 'plate2', postPhrase: 'le pas de tir', postShort: 'pas de tir', nearHint: 'devant vous', rackHint: 'sous l’abri' } as never,
  dt: 0.1, touch: false, portrait: false, difficulty: 'standard', state: 'play', yaw: 0, pitch: 0, x: 0, z: 0, post: 'pas', stance: 'prone', scope: true, zoom: 8,
  range: 65, ranged: false, elev: 0, breath: 'normal', shots: 0, reloading: false, weaponId: '223', caliber: '.223 Rem', plate1Done: false, plate2Done: false,
  aimErr1: 1, aimErr2: 400, dist1: 65, dist2: 300, need1: 1.3, need2: 2.4, windSpeed: 2, rackDist: 20, ...o,
});
/** amène le tutoriel à l'étape voulue, sans jouer les précédentes */
const at = (id: string): Tutorial => { const t = new Tutorial(); t.index = TUTO_STEPS.indexOf(id); return t; };
const norm = (s: string): string => s.replace(/\s/g, ' ');

describe('ce que couvre un mrad', () => {
  it('10 cm à 100 m, 20 cm à 200 m, 1 m à 1 000 m', () => {
    expect(milSize(1, 100)).toBe('10 cm');
    expect(milSize(1, 200)).toBe('20 cm');
    expect(milSize(1, 1000)).toBe('1,0 m');
    expect(milSize(1, 65)).toBe('7 cm');
    expect(milSize(1.3, 65)).toBe('8 cm');
    expect(milSize(-2, 300)).toBe('60 cm');
    expect(milSize(0.01, 50)).toBe('1 cm');
  });
});

describe('leçon du mrad', () => {
  it('vient après la mesure de la distance et avant le carnet', () => {
    const i = TUTO_STEPS.indexOf('mrad');
    expect(TUTO_STEPS[i - 1]).toBe('range');
    expect(TUTO_STEPS[i + 1]).toBe('book');
    expect(TUTO_STEPS.length).toBe(17);
  });

  it('dit que c’est un angle, donne les trois repères et le chiffre à la distance de la plaque', () => {
    const t = at('mrad');
    t.update(snap());
    const v = t.view!;
    expect(v.id).toBe('mrad');
    expect(norm(v.text)).toContain('Un mrad est un angle : il couvre 10 cm à 100 m, 20 cm à 200 m, 1 m à 1 000 m.');
    expect(norm(v.text)).toContain('à 65 m, 1 mrad couvre 7 cm sur la plaque');
    expect(norm(t.view!.text)).not.toMatch(/\bclics?\b/i);
  });

  it('se valide après quelques secondes passées à observer la plaque au réticule, pas avant, et pas hors lunette', () => {
    const t = at('mrad');
    for (let k = 0; k < (MRAD_STUDY - 1) * 10; k++) t.update(snap());
    expect(t.validated).not.toContain('mrad');
    // hors lunette, ou réticule ailleurs : le temps ne compte pas
    for (let k = 0; k < 100; k++) t.update(snap({ scope: false }));
    for (let k = 0; k < 100; k++) t.update(snap({ aimErr1: 80 }));
    expect(t.validated).not.toContain('mrad');
    for (let k = 0; k < 15; k++) t.update(snap());
    expect(t.validated).toContain('mrad');
  });

  it('ne bloque pas un joueur qui a déjà fait sonner la plaque', () => {
    const t = at('mrad');
    t.update(snap({ plate1Done: true }));
    expect(t.validated).toContain('mrad');
  });
});

describe('le carnet et la tourelle relient la chute à l’angle', () => {
  it('carnet : la chute en centimètres à cette distance, puis l’angle qui la compense', () => {
    const t = at('book');
    t.update(snap());
    expect(norm(t.view!.text)).toBe('La balle tombe en route : à 65 m, elle arrive 8 cm sous la croix. Le carnet donne l’angle qui compense cette chute : 1,3 mrad. Ouvrez-le.');
    const z = at('book');
    z.update(snap({ need1: 0 }));
    expect(norm(z.view!.text)).toContain('le carnet indique 0 mrad');
  });

  it('tourelle : la lunette se relève de cet angle', () => {
    const t = at('elev');
    t.update(snap());
    expect(norm(t.view!.text)).toBe('Affichez 1,3 mrad à la tourelle d’élévation : la lunette se relève de cet angle, soit 8 cm à 65 m, et la balle retombe sur la croix.');
    const a = at('elev');
    a.update(snap({ difficulty: 'assist' }));
    expect(norm(a.view!.text)).toContain('la lunette se relève de cet angle et compense la chute');
  });

  it('seconde plaque : le mrad vaut plus loin', () => {
    const t = at('plate2');
    t.update(snap({ weaponId: '223' }));
    expect(norm(t.view!.text)).toContain('à 300 m, où 1 mrad couvre 30 cm');
  });

  it('aucune étape ne parle de clic de tourelle', () => {
    for (const id of TUTO_STEPS) for (const o of [{}, { difficulty: 'assist' as const }, { touch: true, portrait: true }]) {
      const t = at(id);
      t.update(snap(o));
      const all = `${t.view!.text} ${t.view!.cmd}`.replace(/Clic (droit|gauche)/g, '');
      expect(all, id).not.toMatch(/\bclics?\b/i);
    }
  });
});
