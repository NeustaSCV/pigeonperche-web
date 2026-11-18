// Ambiance de la Ville nouvelle : effet Doppler d'un véhicule qui passe, et règles de discrétion (au loin, rare).
import { describe, expect, it } from 'vitest';
import { AMBIENCE_MIN_RANGE, CityAmbience, passBy } from '../src/online/ambience';
import { SR } from '../src/audio/shot-dsp';

/** fréquence d'un son pur, par comptage des passages par zéro montants */
const freq = (x: Float32Array, a: number, b: number): number => {
  let n = 0, premier = -1, dernier = -1;
  for (let i = Math.max(1, a); i < b; i++) if (x[i - 1] <= 0 && x[i] > 0) { if (premier < 0) premier = i; dernier = i; n++; }
  return n > 1 ? ((n - 1) * SR) / (dernier - premier) : 0;
};
const pur = (hz: number, sec: number): Float32Array => Float32Array.from({ length: Math.floor(sec * SR) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));

describe('ambiance de ville', () => {
  it('Doppler : plus aigu quand le véhicule approche, plus grave quand il s’éloigne, dans la proportion v/c', () => {
    const v = 20, d0 = 500, s = pur(600, 3);
    const avant = passBy(s, v, d0, -60, 2, 1, 1), apres = passBy(s, v, d0, 60, 2, 1, 1);
    const somme = (p: { l: Float32Array; r: Float32Array }) => p.l.map((y, i) => y + p.r[i]);
    const fa = freq(somme(avant), 1000, 90000), fb = freq(somme(apres), 1000, 90000);
    expect(fa).toBeGreaterThan(600 * 1.03); expect(fa).toBeLessThan(600 * 1.07);      // +v/c·cos ≈ +5,4 %
    expect(fb).toBeLessThan(600 * 0.97); expect(fb).toBeGreaterThan(600 * 0.93);
    // au plus près : hauteur d'origine
    const pres = passBy(s, v, d0, -1, 2, 1, 1);
    expect(Math.abs(freq(somme(pres), 1000, 90000) - 600)).toBeLessThan(3);
  });
  it('placement et niveau suivent la position : à gauche avant le passage, à droite après, plus faible au loin', () => {
    const s = pur(500, 1), e = (x: Float32Array) => x.reduce((a, y) => a + y * y, 0);
    const avant = passBy(s, 20, 500, -40, 0.8, 1, 1), apres = passBy(s, 20, 500, 40, 0.8, 1, 1), pres = passBy(s, 20, 500, -0.4, 0.8, 1, 1);
    expect(e(avant.l)).toBeGreaterThan(e(avant.r) * 2); expect(e(apres.r)).toBeGreaterThan(e(apres.l) * 2);
    expect(e(pres.l) + e(pres.r)).toBeGreaterThan((e(avant.l) + e(avant.r)) * 2);
    // sens inverse : l'autre oreille
    const inverse = passBy(s, 20, 500, -40, 0.8, -1, 1);
    expect(e(inverse.r)).toBeGreaterThan(e(inverse.l) * 2);
  });
  it('au plus un klaxon et une sirène par manche, jamais dans les 25 premières ni les 30 dernières secondes, espacés de 40 s', () => {
    for (let graine = 1; graine <= 40; graine++) {
      let g = graine * 7919; const rand = () => ((g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const joues: { n: number; t: number }[] = []; let t = 0;
      const audio = { started: true, playBuffer: (l: Float32Array) => { joues.push({ n: l.length, t }); return true; } };
      const amb = new CityAmbience(audio as never, 'x/', rand) as any;
      amb.horn = pur(400, 0.9); amb.siren = pur(700, 20);                    // pas de fond : on ne compte que les événements
      amb.newRound(240000, 0);
      for (t = 0; t <= 240000; t += 500) amb.frame(true, t);
      expect(joues.length).toBeLessThanOrEqual(2);
      expect(new Set(joues.map((j) => j.n)).size).toBe(joues.length);        // jamais deux fois le même son
      for (const j of joues) { expect(j.t).toBeGreaterThanOrEqual(25000); expect(j.t).toBeLessThanOrEqual(210500); }
      if (joues.length === 2) expect(Math.abs(joues[0].t - joues[1].t)).toBeGreaterThanOrEqual(39500);
      // rien de plus si la manche se prolonge, rien après la fin de manche
      for (t = 240000; t <= 400000; t += 500) amb.frame(true, t);
      expect(joues.length).toBeLessThanOrEqual(2);
    }
  });
  it('rien ne joue hors salon et manche, ni moteur audio arrêté ; la rumeur s’enchaîne sans trou', () => {
    const appels: { delay: number; t: number }[] = []; let t = 0;
    const audio = { started: true, playBuffer: (_l: Float32Array, _r: Float32Array, o: { delay?: number }) => { appels.push({ delay: o.delay ?? 0, t }); return true; } };
    const amb = new CityAmbience(audio as never, 'x/') as any; amb.bed = pur(100, 2);
    for (t = 0; t < 3000; t += 16) amb.frame(false, t);
    expect(appels).toHaveLength(0);
    for (t = 3000; t < 9000; t += 16) amb.frame(true, t);
    expect(appels.length).toBe(4);                                            // trois boucles de deux secondes en six secondes, la quatrième déjà en file (0,4 s d'avance)
    for (let i = 1; i < appels.length; i++) expect(Math.abs(appels[i].t + appels[i].delay * 1000 - (appels[i - 1].t + appels[i - 1].delay * 1000) - 2000)).toBeLessThan(1);
    expect(AMBIENCE_MIN_RANGE).toBeGreaterThanOrEqual(500);
  });
});
