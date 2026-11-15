// Carte « Le Château d'eau » (plaine) : conformité aux règles de score du socle, géométrie des objectifs (distances
// annoncées au briefing), règle de l'alerte, voie (abscisses, point le plus proche).
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '../src/game/extra/sabotage';
import * as M from '../src/levels/plaine/map';
import { meta } from '../src/levels/plaine/meta';
import { STEPS, STEP_POST } from '../src/levels/plaine/mission';
import { LEVEL_RULES } from '../src/shared/scores-core.mjs';

describe('carte plaine', () => {
  it('se conforme aux règles de score : 7 objectifs, portée 3 000 m, bonus 3 000, difficulté réaliste', () => {
    const r = (LEVEL_RULES as Record<string, { steps: number; range: number; bonus?: number; factor: number }>).plaine;
    expect(STEPS.length).toBe(r.steps);
    expect(M.RANGE_LIMIT).toBe(r.range);
    expect(M.BONUS_MAX).toBe(r.bonus);
    expect(meta.difficulty).toBe('real');
    expect(r.factor).toBe(1.5);
    // le bonus de carte tient dans son plafond : sept objectifs propres + mission sans faute
    expect(STEPS.length * M.BONUS.clean + M.BONUS.flawless).toBeLessThanOrEqual(M.BONUS_MAX);
  });

  it('chaque objectif a un poste conseillé, un plan d’essai et des cibles', () => {
    for (const s of STEPS) {
      expect(M.POSTS[STEP_POST[s.id]]).toBeDefined();
      const plan = M.TEST_PLAN.find((p) => p.step === s.id)!;
      expect(plan.targets).toEqual(s.targets);
      expect(M.WEAPON_IDS).toContain(plan.weapon);
    }
  });

  it('les distances annoncées sont les distances réelles depuis le poste conseillé, de 900 à 2 400 m', () => {
    const slants = Object.values(M.TARGETS).map((t) => {
      const e = M.eyeOf(t.post), p = M.targetXZ(t.id);
      const d = Math.hypot(p.x - e.x, p.z - e.z, t.alt - e.y);
      expect(d).toBeCloseTo(t.slant, 3);
      expect(M.bearingOf(p.x - e.x, p.z - e.z)).toBeCloseTo(t.bearing, 3);
      return t.slant;
    });
    expect(Math.min(...slants)).toBe(900);
    expect(Math.max(...slants)).toBe(2400);
  });

  it('les postes sont sur la couronne du plancher, entre le lanterneau et le garde-corps', () => {
    for (const p of Object.values(M.POSTS)) {
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThan(M.DECK.core + 1);
      expect(r).toBeLessThan(M.DECK.rail - 0.6);
    }
    expect(Math.hypot(M.SITE.start.x, M.SITE.start.z)).toBeGreaterThan(M.DECK.core + 1);
  });

  it('alerte : trois tirs manqués atteignent le plafond, le quatrième la donne ; une détonation seule jamais', () => {
    expect(3 * M.ALERT.miss).toBe(M.ALERT.cap);
    expect(M.ALERT.cap + M.ALERT.miss).toBeGreaterThanOrEqual(100);
    // plus gros calibre du râtelier : .50 BMG, 15 points de détonation comptés d'office par le socle avant remise
    expect(M.ALERT.cap + 15).toBeLessThan(100);
    expect(M.ALERT.retry).toBeLessThan(M.ALERT.cap);
    expect(M.ALERT.glint).toBeGreaterThanOrEqual(90);
  });

  it('la voie passe par le signal et par la trouée, que les entrepôts encadrent', () => {
    const has = (x: number, z: number): boolean => M.RAIL.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - z) < 1e-6);
    expect(has(M.SIGNAL.trackX, M.SIGNAL.trackZ)).toBe(true);
    expect(has(M.GAP.x, M.GAP.z)).toBe(true);
    const [n, s] = M.SHEDS.list;
    expect(n[0] + n[1] / 2).toBeCloseTo(M.GAP.z - M.GAP.width / 2, 6);
    expect(s[0] - s[1] / 2).toBeCloseTo(M.GAP.z + M.GAP.width / 2, 6);
  });

  it('Track : abscisse curviligne, tangente, point le plus proche', () => {
    const t = new Track([new Vector3(0, 0, 0), new Vector3(0, 0, 10), new Vector3(10, 0, 10)]);
    expect(t.total).toBeCloseTo(20, 9);
    const p = new Vector3(), f = new Vector3();
    t.at(15, p, f);
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.z).toBeCloseTo(10, 9);
    expect(f.x).toBeCloseTo(1, 9);
    expect(t.nearest(-3, 4)).toBeCloseTo(4, 9);
    expect(t.nearest(7, 13)).toBeCloseTo(17, 9);
    // hors de la voie : borné à ses extrémités
    t.at(-5, p);
    expect(p.z).toBeCloseTo(0, 9);
  });
});
