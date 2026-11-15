// La Fête foraine : mécaniques de foire (src/game/extra/fair.ts) et règles de score de la carte.
import { describe, expect, it } from 'vitest';
import { OrderedSeries, SeriesTracker, SteadyRotation, StepRotation } from '../src/game/extra/fair';
import { BONUS_MAX, POSTS, RANGE_LIMIT, TEST_PLAN, WEAPON_IDS, WHEEL } from '../src/levels/fete/map';
import { meta } from '../src/levels/fete/meta';
import { SERIES, STEPS, STEP_POST } from '../src/levels/fete/mission';
import { LEVEL_RULES } from '../src/shared/scores-core.mjs';

describe('rotation par à-coups', () => {
  const r = new StepRotation(8, 2.6, 6);
  it('arrêt franc puis un huitième de tour', () => {
    expect(r.angle(0)).toBe(0);
    expect(r.angle(5.99)).toBe(0);
    expect(r.holdLeft(1)).toBeCloseTo(5);
    expect(r.holdLeft(6.5)).toBe(0);
    expect(r.angle(8.6)).toBeCloseTo(Math.PI / 4);
    expect(r.angle(8.6 + 3)).toBeCloseTo(Math.PI / 4);
    expect(r.angle(8.6 * 8)).toBeCloseTo(Math.PI * 2);
  });
  it('continue et monotone pendant le mouvement, sans à-coup aux raccords', () => {
    let prev = r.angle(0);
    for (let t = 0; t < 30; t += 0.01) {
      const a = r.angle(t);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(a - prev).toBeLessThan(0.006);
      prev = a;
    }
  });
  it('rotation continue : jamais à l’arrêt, sauf à vitesse nulle', () => {
    expect(new SteadyRotation(0.5).angle(4)).toBe(2);
    expect(new SteadyRotation(0.5).holdLeft()).toBe(0);
    expect(new SteadyRotation(0).holdLeft()).toBe(Infinity);
  });
});

describe('série ordonnée', () => {
  it('seule la suivante est acceptée, une autre ne coûte rien', () => {
    const s = new OrderedSeries(['a', 'b', 'c']);
    expect(s.next()).toBe('a');
    expect(s.accept('b')).toBe(false);
    expect(s.next()).toBe('a');
    expect(s.accept('a')).toBe(true);
    expect(s.accept('a')).toBe(false);
    expect(s.accept('b')).toBe(true);
    expect(s.accept('c')).toBe(true);
    expect(s.next()).toBeNull();
    s.reset();
    expect(s.next()).toBe('a');
  });
});

describe('série chronométrée', () => {
  const rule = { total: 4, chainWindow: 6, chainPoints: 50, par: 60, speedPoints: 400 };
  it('le chrono part au premier tir, l’enchaînement monte, la rapidité paie à la fin', () => {
    const s = new SeriesTracker();
    s.begin(rule);
    expect(s.started).toBe(false);
    s.shot(10);
    s.shot(11);
    expect(s.elapsed(13)).toBe(3);
    expect(s.hit(12)).toMatchObject({ rank: 1, chain: 0, done: 1, finished: false });
    expect(s.hit(15)).toMatchObject({ rank: 2, chain: 100 });
    expect(s.chainLeft(17)).toBe(4);
    // enchaînement perdu : on repart du rang 1, sans rien retirer
    expect(s.hit(30)).toMatchObject({ rank: 1, chain: 0 });
    const last = s.hit(34)!;
    expect(last).toMatchObject({ rank: 2, chain: 100, finished: true, seconds: 24 });
    expect(last.speed).toBe(Math.round(400 * (1 - 24 / 60)));
    expect(s.finished).toBe(true);
    expect(s.hit(35)).toBeNull();
    expect(s.elapsed(99)).toBe(24);
  });
  it('une série lente ne rapporte rien et ne retire rien', () => {
    const s = new SeriesTracker();
    s.begin({ ...rule, total: 1 });
    s.shot(0);
    expect(s.hit(500)).toMatchObject({ chain: 0, speed: 0, finished: true });
  });
  it('bandeau', () => {
    const s = new SeriesTracker();
    expect(s.banner(0)).toBeNull();
    s.begin(rule);
    expect(s.banner(0)).toContain('0/4');
    s.shot(1);
    s.hit(2);
    expect(s.banner(3.5)).toContain('1/4');
    expect(s.banner(3.5)).toContain('2,5 s');
    expect(s.banner(3.5)).toContain('×2');
  });
});

describe('carte « fete »', () => {
  it('règles de score du serveur', () => {
    expect(LEVEL_RULES.fete).toEqual({ steps: STEPS.length, factor: 1, range: RANGE_LIMIT, bonus: BONUS_MAX });
    expect(meta.difficulty).toBe('assist');
  });
  it('bonus possibles sous le plafond', () => {
    let max = 0;
    for (const s of STEPS) {
      const r = SERIES[s.id];
      expect(r, s.id).toBeDefined();
      expect(r.total).toBe(s.targets.length);
      for (let k = 2; k <= r.total; k++) max += r.chainPoints * k;
      max += r.speedPoints;
    }
    expect(max).toBeLessThanOrEqual(BONUS_MAX);
    expect(max).toBeGreaterThan(BONUS_MAX * 0.6);
  });
  it('plan d’essai : chaque objectif, chaque cible, postes et armes connus', () => {
    expect(TEST_PLAN.map((p) => p.step)).toEqual(STEPS.map((s) => s.id));
    for (const p of TEST_PLAN) {
      expect(p.targets).toEqual(STEPS.find((s) => s.id === p.step)!.targets);
      expect(POSTS[p.post]).toBeDefined();
      expect(WEAPON_IDS).toContain(p.weapon);
      expect(POSTS[STEP_POST[p.step]]).toBeDefined();
    }
  });
  it('une seule cible mobile, avec des arrêts francs d’au moins cinq secondes', () => {
    expect(WHEEL.hold).toBeGreaterThanOrEqual(5);
    expect(WHEEL.hold).toBeGreaterThan(WHEEL.move * 2);
  });
});
