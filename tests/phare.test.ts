// Carte « Le Phare » : règles des scores, route du canot (seule cible mobile, arrêts francs), prédiction exacte.
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Floater, Runner } from '../src/game/extra/sea-targets';
import * as M from '../src/levels/phare/map';
import { STEPS, STEP_POST } from '../src/levels/phare/mission';
import { Swell } from '../src/world/sea';

describe('phare : données', () => {
  it('sept objectifs, portée et bonus conformes aux règles des scores', () => {
    expect(STEPS.length).toBe(7);
    expect(M.RANGE_LIMIT).toBe(1800);
    expect(M.BONUS_MAX).toBe(3000);
    expect(M.BONUS.clean * STEPS.length + M.BONUS.skiff).toBeLessThanOrEqual(M.BONUS_MAX);
    for (const s of STEPS) expect(Object.keys(M.POSTS)).toContain(STEP_POST[s.id]);
    expect(M.TEST_PLAN.map((p) => p.step)).toEqual(STEPS.map((s) => s.id));
  });
  it('la houle laisse la mer du modèle du phare sous la nappe animée', () => {
    const swell = new Swell(M.SWELL);
    expect(swell.maxAmp).toBeLessThan(9 - M.PHARE.groundY - 0.05);
  });
});

describe('phare : le canot', () => {
  const swell = new Swell(M.SWELL);
  const mk = (): Runner => new Runner({ level: 0, swell, follow: 0.1, tilt: 1 }, M.SKIFF.route, M.SKIFF.speed);
  it('chaque arrêt de la route dure au moins 6 s, et la route laisse plus de deux minutes', () => {
    for (const p of M.SKIFF.route.slice(0, -1)) expect(p.wait ?? 0).toBeGreaterThanOrEqual(6);
    expect(mk().duration).toBeGreaterThan(120);
  });
  it('attend au départ, s’arrête à chaque point, puis arrive', () => {
    const r = mk();
    expect(r.stoppedAt(50)).toBe(true);
    r.start(100);
    expect(r.stoppedAt(105)).toBe(true);
    expect(r.waitLeft(105)).toBeCloseTo((M.SKIFF.route[0].wait ?? 0) - 5, 6);
    expect(r.stoppedAt(100 + (M.SKIFF.route[0].wait ?? 0) + 3)).toBe(false);
    expect(r.arrivedAt(100 + r.duration + 1)).toBe(true);
    const end = M.SKIFF.route[M.SKIFF.route.length - 1];
    const p = r.worldAt(new Vector3(), 100 + r.duration + 1, new Vector3());
    expect(Math.hypot(p.x - end.x, p.z - end.z)).toBeLessThan(1e-6);
  });
  it('à l’arrêt la position prévue ne bouge presque pas ; en route elle avance à la vitesse de la route', () => {
    const r = mk();
    r.start(0);
    const local = new Vector3(-2.7, 0.7, 0);
    const a = r.worldAt(local, 2, new Vector3()), b = r.worldAt(local, 2.2, new Vector3());
    expect(a.distanceTo(b) / 0.2).toBeLessThan(0.3);
    const t = (M.SKIFF.route[0].wait ?? 0) + 6;
    const c = r.worldAt(local, t, new Vector3()), d = r.worldAt(local, t + 0.2, new Vector3());
    expect(Math.hypot(d.x - c.x, d.z - c.z) / 0.2).toBeCloseTo(M.SKIFF.speed, 1);
  });
  it('figé, il ne bouge plus ; remis à zéro, il revient au départ', () => {
    const r = mk();
    r.start(0);
    r.halt(40);
    const a = r.worldAt(new Vector3(), 40, new Vector3()), b = r.worldAt(new Vector3(), 400, new Vector3());
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-9);
    r.reset();
    const c = r.worldAt(new Vector3(), 500, new Vector3());
    expect(Math.hypot(c.x - M.SKIFF.route[0].x, c.z - M.SKIFF.route[0].z)).toBeLessThan(1e-9);
  });
  it('une bouée bridée par son corps-mort bouge de quelques centimètres par seconde au plus', () => {
    const f = new Floater({ x: 244, z: 291, level: 0, swell, follow: 0.12 });
    let worst = 0;
    for (let t = 0; t < 30; t += 0.37) worst = Math.max(worst, f.worldAt(new Vector3(0, 3.05, 0), t, new Vector3()).distanceTo(f.worldAt(new Vector3(0, 3.05, 0), t + 0.2, new Vector3())) / 0.2);
    expect(worst).toBeLessThan(0.1);
  });
});
