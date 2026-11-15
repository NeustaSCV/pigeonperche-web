// Tirs d'adresse (src/game/skill.ts) : bonus et compliment pour un tir en plein centre ou sur une cible en mouvement,
// écart au centre mesuré sur la cible (Target.hitOffset), plafond dans la mission et bornes acceptées par le serveur.
import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CENTRE_MAX, MOVING_MIN, assessHit, skillDetail } from '../src/game/skill';
import { Target, type HitResult } from '../src/game/targets';
import { LEVEL_RULES, SKILL_CENTRE, SKILL_MOVING, SKILL_PER_STEP, scoreBounds } from '../src/shared/scores-core.mjs';

class Plate extends Target {
  node = new Object3D();
  constructor(shape: 'box' | 'sphere') {
    super('p', 'plaque');
    this.node.position.set(10, 2, -100);
    this.node.updateMatrixWorld(true);
    // plaque de 50 cm de côté, mince, face au tireur (axe z) ; ou sphère de 25 cm de rayon
    this.addCollider(this.node, shape, 'plate', 0.25, shape === 'box' ? new Vector3(0.25, 0.25, 0.01) : undefined);
  }
  aimPoint(out: Vector3): Vector3 { return out.copy(this.node.position); }
  onHit(): HitResult { return { kind: 'steel', success: true }; }
}
const DIR = new Vector3(0, 0, -1);

describe('jugement d’un tir au but', () => {
  it('ne récompense pas un tir ordinaire', () => {
    expect(assessHit(0.6, 0)).toBeNull();
    expect(assessHit(null, 0)).toBeNull();
    expect(assessHit(CENTRE_MAX + 0.01, MOVING_MIN - 0.01)).toBeNull();
    expect(assessHit(NaN, NaN)).toBeNull();
  });

  it('récompense le plein centre, la cible en mouvement, et cumule les deux', () => {
    const c = assessHit(0.1, 0, 0)!;
    expect([c.centre, c.moving, c.bonus]).toEqual([true, false, SKILL_CENTRE]);
    const m = assessHit(0.8, 1.2, 0)!;
    expect([m.centre, m.moving, m.bonus]).toEqual([false, true, SKILL_MOVING]);
    const b = assessHit(0.05, 1.2, 0)!;
    expect(b.bonus).toBe(SKILL_CENTRE + SKILL_MOVING);
    // toucher en mouvement vaut plus que toucher la même cible à l'arrêt
    expect(m.bonus).toBeGreaterThan(0);
    expect(assessHit(0.8, 0)).toBeNull();
    // une cible en mouvement dont on ignore la zone touchée reste récompensée
    expect(assessHit(null, 1.2)!.moving).toBe(true);
  });

  it('donne toujours un compliment non vide, quel que soit le tirage', () => {
    for (const pick of [0, 0.34, 0.99, 1, 2, -1, NaN]) {
      for (const [o, s] of [[0.1, 0], [0.9, 1], [0.1, 1]] as const) expect(assessHit(o, s, pick)!.title.length).toBeGreaterThan(5);
    }
    expect(skillDetail(assessHit(0.1, 0, 0)!, 250, 596)).toBe('+250 points · plein centre');
    expect(skillDetail(assessHit(0.1, 1, 0)!, 650, 1100)).toBe('+650 points · plein centre, cible en mouvement · à 1,1 km');
    // plafond atteint : le compliment reste, sans annoncer de points
    expect(skillDetail(assessHit(0.9, 1, 0)!, 0, 300)).toBe('cible en mouvement');
  });
});

describe('écart au centre de la zone touchée', () => {
  it('vaut 0 au centre et 1 au bord, sur une plaque comme sur une sphère', () => {
    for (const shape of ['box', 'sphere'] as const) {
      const t = new Plate(shape);
      expect(t.hitOffset('plate', new Vector3(10, 2, -99.99), DIR)).toBeCloseTo(0, 6);
      expect(t.hitOffset('plate', new Vector3(10.25, 2, -99.99), DIR)).toBeCloseTo(1, 6);
      expect(t.hitOffset('plate', new Vector3(10.05, 2.0, -99.99), DIR)!).toBeLessThan(CENTRE_MAX);
      expect(t.hitOffset('plate', new Vector3(10.1, 2.1, -99.99), DIR)!).toBeGreaterThan(CENTRE_MAX);
    }
  });

  it('ne dépend pas de la profondeur du point d’impact sur la trajectoire, et ignore une zone inconnue', () => {
    const t = new Plate('sphere');
    const a = t.hitOffset('plate', new Vector3(10.1, 2, -99.75), DIR)!, b = t.hitOffset('plate', new Vector3(10.1, 2, -100.2), DIR)!;
    expect(a).toBeCloseTo(b, 9);
    expect(t.hitOffset('autre', new Vector3(10, 2, -100), DIR)).toBeNull();
  });
});

describe('plafond et bornes du serveur', () => {
  it('borne le score maximal avec le plafond des tirs d’adresse de chaque carte', () => {
    expect(SKILL_PER_STEP).toBe(SKILL_CENTRE + SKILL_MOVING);
    for (const [id, r] of Object.entries(LEVEL_RULES) as [string, { steps: number; factor: number; range: number; bonus?: number }][]) {
      const b = scoreBounds(id)!;
      expect(b.max).toBe(Math.ceil((r.steps * (1900 + SKILL_PER_STEP + r.range * 0.5) + 2000 + (r.bonus ?? 0)) * r.factor));
      expect(b.min).toBeLessThan(b.max);
    }
  });
});
