// Vol des balles du jeu (src/game/shots.ts) : il doit suivre le solveur de src/ballistics dans l'environnement du
// niveau, et rester celui d'origine quand le niveau n'active rien.
//
// Le tir est le VRAI tir du jeu (`Shots.fire` puis `Shots.update`, collisions comprises) ; seuls le relief, le vent
// et la cible sont remplacés par des doublures simples : sol très bas, vent uniforme, plan vertical à la distance
// voulue qui relève le point de passage. Les réglages de tourelle viennent de `firingSolution`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { GAME_AIR, firingSolution, stepBullet, zeroAngle, type BulletState } from '../src/ballistics';
import { SIGHT_HEIGHT, weaponById, type WeaponDef } from '../src/config/weapons';
import { Shots, ballisticEnv, boreDirection, zeroOf, type ImpactReport } from '../src/game/shots';
import type { LevelPhysics } from '../src/levels/types';

const NEUTRAL: LevelPhysics = { latitudeDeg: 45, altitudeM: 0, temperatureC: 15, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
const FULL: LevelPhysics = { latitudeDeg: 46, altitudeM: 1800, temperatureC: 8, coriolis: true, spinDrift: true, aeroJump: true, densityFromAltitude: true };

/** vent uniforme : `speed` m/s venant de l'azimut `from` (degrés, 0 = du nord) */
function steadyWind(speed: number, from: number): any {
  const b = ((from + 180) * Math.PI) / 180;
  const x = Math.sin(b) * speed, z = -Math.cos(b) * speed;
  return { time: 0, sample: (_x: number, _y: number, _z: number, out: any) => { out.x = x; out.z = z; out.speed = speed; out.gust = 0; return out; } };
}
const flatTerrain: any = { heightAt: () => -1e5, raycast: () => false, splatAt: () => 0 };
const noColliders: any = { segment: () => -1 };

/** cible de test : plan perpendiculaire à la ligne de visée, à `range` m de l'œil */
function plane(eye: Vector3, los: Vector3, range: number): any {
  const c = eye.clone().addScaledVector(los, range);
  return {
    id: 'plan', active: true, done: false,
    segment(a: Vector3, b: Vector3) {
      const da = a.clone().sub(c).dot(los), db = b.clone().sub(c).dot(los);
      return da < 0 && db >= 0 ? { t: da / (da - db), part: 'plan' } : null;
    },
    onHit: () => ({ kind: 'steel', success: true }),
    // relevés du tir d'adresse (écart au centre, vitesse de la cible) : cible immobile, zone inconnue
    hitOffset: () => null,
    predict: (_dt: number, out: Vector3) => out.copy(c),
  };
}

interface Shot { up: number; right: number; tof: number; velocity: number; distance: number }
/** Tire le coup réel du jeu (sans dispersion) et relève l'écart au point visé, en mètres (haut et droite positifs). */
function shoot(def: WeaponDef, physics: LevelPhysics, o: { range: number; bearing: number; pitch?: number; elev: number; windage: number; windSpeed?: number; windFrom?: number }): Shot {
  const eye = new Vector3(0, 300, 0);
  const b = (o.bearing * Math.PI) / 180, p = o.pitch ?? 0;
  const los = new Vector3(Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p));
  const wind = steadyWind(o.windSpeed ?? 0, o.windFrom ?? 0);
  const shots = new Shots(flatTerrain, noColliders, wind, {} as any, { waterLevel: null, alertZone: null, physics });
  shots.targets = [plane(eye, los, o.range)];
  let rep: ImpactReport | null = null;
  shots.onImpact = (r) => (rep = r);
  shots.fire(eye, los, def, o.elev, o.windage, false);
  for (let i = 0; i < 2000 && !rep; i++) shots.update(1 / 100);
  if (!rep) throw new Error('le projectile n’a pas atteint le plan');
  const r = rep as ImpactReport;
  const right = new Vector3().crossVectors(los, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, los);
  const d = r.point.clone().sub(eye.clone().addScaledVector(los, o.range));
  return { up: d.dot(up), right: d.dot(right), tof: r.tof, velocity: r.velocity, distance: r.distance };
}

// la déstabilisation transsonique est aléatoire : pour comparer à un calcul, on la neutralise (tirage gaussien nul)
beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.25); });
afterEach(() => { vi.restoreAllMocks(); });

describe('conversion de la physique du niveau', () => {
  it('rien d’activé : pas d’environnement avancé', () => {
    expect(ballisticEnv(NEUTRAL)).toBeUndefined();
    expect(ballisticEnv({ ...NEUTRAL, powderTempSens: 0.5 })).toBeUndefined(); // 15 °C : la poudre est à sa température de référence
    expect(ballisticEnv(undefined)).toBeUndefined();
  });
  it('un seul effet suffit, et les réglages sont transmis', () => {
    expect(ballisticEnv({ ...NEUTRAL, spinDrift: true })?.spinDrift).toBe(true);
    expect(ballisticEnv({ ...NEUTRAL, temperatureC: 30, powderTempSens: 0.5 })?.powderTempSens).toBe(0.5);
    const e = ballisticEnv({ ...FULL, pressureHPa: 800, humidityPct: 40 })!;
    expect([e.latitudeDeg, e.altitudeM, e.temperatureC, e.pressureHPa, e.humidityPct]).toEqual([46, 1800, 8, 800, 40]);
    expect(e.coriolis && e.spinDrift && e.aeroJump && e.densityFromAltitude).toBe(true);
  });
});

describe('physique neutre : le vol d’origine', () => {
  it('arme en G1 : même trajectoire, au bit près, que l’intégration d’origine (stepBullet dans l’air du jeu)', () => {
    const def = weaponById('65cm');
    const eye = new Vector3(12, 261, -7);
    const los = new Vector3(0.31, -0.2, -0.93).normalize();
    const wind = steadyWind(4.2, 255);
    const shots = new Shots(flatTerrain, noColliders, wind, {} as any, { waterLevel: null, alertZone: null, physics: NEUTRAL });
    const b = shots.fire(eye, los, def, 7.3, -0.4, false);
    // référence : le code d'avant l'intégration
    const dir = boreDirection(los, def, 7.3, -0.4, new Vector3());
    const s: BulletState = { x: eye.x, y: eye.y - SIGHT_HEIGHT, z: eye.z, vx: dir.x * def.v0, vy: dir.y * def.v0, vz: dir.z * def.v0, t: 0 };
    const w: any = {};
    wind.sample(0, 0, 0, w);
    for (let i = 0; i < 300; i++) stepBullet(s, 1 / 400, def.bcG1, GAME_AIR, w.x, 0, w.z);
    shots.update(300 / 400 + 1e-9);
    expect(b.s.t).toBeCloseTo(s.t, 12);
    expect([b.s.x, b.s.y, b.s.z, b.s.vx, b.s.vy, b.s.vz]).toEqual([s.x, s.y, s.z, s.vx, s.vy, s.vz]);
    expect(b.flight.plain).toBe(true);
  });
  it('arme en G7 : elle vole en G7 (et non plus en G1), zérotée dans le même modèle', () => {
    const def = weaponById('65prc');
    expect(zeroOf(def)).toBe(zeroAngle(def, def.zero, SIGHT_HEIGHT, GAME_AIR));
    const sol = firingSolution(def, { range: 1000, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })!;
    const hit = shoot(def, NEUTRAL, { range: 1000, bearing: 0, elev: sol.elevMil, windage: sol.windMil });
    expect(Math.abs(hit.up)).toBeLessThan(0.02);
    // les deux modèles se valent en supersonique ; au-delà (1 800 m), le repli G1 d'avant donnait un autre réglage :
    // le tir réel suit bien le G7 du carnet
    const far = firingSolution(def, { range: 1800, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })!;
    const g1 = firingSolution({ ...def, dragModel: undefined }, { range: 1800, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })!;
    expect(Math.abs(g1.elevMil - far.elevMil)).toBeGreaterThan(0.3);
    const hitFar = shoot(def, NEUTRAL, { range: 1800, bearing: 0, elev: far.elevMil, windage: far.windMil });
    expect(Math.abs(hitFar.up / 1800) * 1000).toBeLessThan(0.05);
  });
  it('le zérotage met au but à la distance de zéro, pour chaque famille d’armes', () => {
    for (const id of ['22lr', '308', '6cm', '300prc', '338lm300', '50bmg']) {
      const def = weaponById(id);
      const hit = shoot(def, NEUTRAL, { range: def.zero, bearing: 70, elev: 0, windage: 0 });
      expect(Math.abs(hit.up), id).toBeLessThan(0.004);
      expect(Math.abs(hit.right), id).toBeLessThan(0.001);
    }
  });
});

describe('physique avancée : le tir réel suit firingSolution', () => {
  // une arme intermédiaire en G7, deux armes ELR (G7 et G1), à 1 000 et 2 000 m, tous effets actifs, vent de travers
  const cases: [string, number, number][] = [
    ['65prc', 1000, 40], ['300prc', 1000, 310], ['300prc', 2000, 95],
    ['338lm300', 1000, 180], ['33xc', 2000, 265], ['416b', 2000, 20], ['375ct', 2000, 140],
  ];
  for (const [id, range, bearing] of cases) {
    it(`${id} à ${range} m, azimut ${bearing}° : impact à moins de 0,05 mrad du point visé`, () => {
      const def = weaponById(id);
      const env = ballisticEnv(FULL)!;
      const windSpeed = 4, windFrom = bearing - 70;
      const pitch = -0.06;
      const sol = firingSolution(def, { range, heightDiff: Math.sin(pitch) * range, azimuthDeg: bearing, windSpeed, windFromDeg: windFrom, env, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })!;
      expect(sol).not.toBeNull();
      const hit = shoot(def, FULL, { range, bearing, pitch, elev: sol.elevMil, windage: sol.windMil, windSpeed, windFrom });
      expect(Math.abs(hit.up / range) * 1000, 'écart vertical, mrad').toBeLessThan(0.05);
      expect(Math.abs(hit.right / range) * 1000, 'écart latéral, mrad').toBeLessThan(0.05);
      expect(Math.abs(hit.tof - sol.tof)).toBeLessThan(0.01);
      expect(Math.abs(hit.velocity - sol.velocity)).toBeLessThan(1.5);
      // les effets avancés pèsent réellement : sans eux le même réglage manque de plus de 0,2 mrad
      const flat = shoot(def, NEUTRAL, { range, bearing, pitch, elev: sol.elevMil, windage: sol.windMil, windSpeed, windFrom });
      expect(Math.hypot(flat.up, flat.right) / range * 1000).toBeGreaterThan(0.2);
    });
  }
  it('chaque effet pris seul est rendu par le vol (dérive gyroscopique à droite, Coriolis à droite dans l’hémisphère nord)', () => {
    const def = weaponById('300prc');
    const base = shoot(def, NEUTRAL, { range: 1500, bearing: 0, elev: 12, windage: 0 });
    const spin = shoot(def, { ...NEUTRAL, spinDrift: true }, { range: 1500, bearing: 0, elev: 12, windage: 0 });
    const cor = shoot(def, { ...NEUTRAL, coriolis: true }, { range: 1500, bearing: 0, elev: 12, windage: 0 });
    expect(spin.right - base.right).toBeGreaterThan(0.2);
    expect(cor.right - base.right).toBeGreaterThan(0.05);
    // air d'altitude : moins de traînée, la balle arrive plus haut et plus vite
    const thin = shoot(def, { ...NEUTRAL, altitudeM: 2500, densityFromAltitude: true }, { range: 1500, bearing: 0, elev: 12, windage: 0 });
    expect(thin.up).toBeGreaterThan(base.up + 1);
    expect(thin.velocity).toBeGreaterThan(base.velocity + 20);
    // saut aérodynamique : vent venant de la droite, pas à droite → le coup monte
    const calm = shoot(def, NEUTRAL, { range: 1500, bearing: 0, elev: 12, windage: 0, windSpeed: 5, windFrom: 90 });
    const jump = shoot(def, { ...NEUTRAL, aeroJump: true }, { range: 1500, bearing: 0, elev: 12, windage: 0, windSpeed: 5, windFrom: 90 });
    expect(jump.up).toBeGreaterThan(calm.up + 0.1);
  });
  it('la prévision et le tireur automatique suivent le même vol que le tir', () => {
    const def = weaponById('33xc');
    const eye = new Vector3(0, 300, 0);
    const los = new Vector3(0.6, -0.05, -0.8).normalize();
    const wind = steadyWind(5, 200);
    const shots = new Shots(flatTerrain, noColliders, wind, {} as any, { waterLevel: null, alertZone: null, physics: FULL });
    const range = 1800;
    shots.targets = [plane(eye, los, range)];
    let rep: ImpactReport | null = null;
    shots.onImpact = (r) => (rep = r);
    const pred = shots.predict(eye, los, def, 14, 0.5, true, 8)!;
    const got = new Vector3();
    const tof = shots.flyTo(eye, los, def, 14, 0.5, pred.point.distanceTo(new Vector3(eye.x, eye.y - SIGHT_HEIGHT, eye.z)), got);
    shots.fire(eye, los, def, 14, 0.5, false);
    for (let i = 0; i < 2000 && !rep; i++) shots.update(1 / 100);
    const r = rep as unknown as ImpactReport;
    expect(r.point.distanceTo(pred.point)).toBeLessThan(1e-6);
    expect(got.distanceTo(pred.point)).toBeLessThan(0.02);
    expect(Math.abs(tof - r.tof)).toBeLessThan(0.005);
  });
});
