// Projectiles : intégration pas à pas, collisions (cibles, décor, terrain, eau), dispersion, passage transsonique.
// Le vol est celui de src/ballistics/flight.ts (`makeFlight` / `stepFlight`) dans l'environnement du niveau : traînée
// G1 ou G7 selon l'arme, et, si le niveau les active, densité selon l'altitude, Coriolis, dérive gyroscopique, saut
// aérodynamique. Le tir réel, la prévision (`predict`) et le tireur automatique des tests (`flyTo`) partagent le même
// départ (`launch`) : ils ne peuvent pas diverger.
import { Vector3 } from 'three';
import type { ImpactKind } from '../audio/types';
import { aeroJumpMil, type BallisticEnv } from '../ballistics/environment';
import { machAt, makeFlight, stepFlight, type Flight } from '../ballistics/flight';
import { GAME_AIR, GRAIN_KG, zeroAngle, type BulletState } from '../ballistics/solver';
import { SIGHT_HEIGHT, type WeaponDef } from '../config/weapons';
import type { LevelPhysics } from '../levels/types';
import type { Colliders, SurfaceTag } from '../world/colliders';
import type { Terrain } from '../world/terrain';
import type { Wind, WindSample } from '../world/wind';
import type { HitResult, Target, TargetCtx } from './targets';

export interface Bullet {
  s: BulletState;
  def: WeaponDef;
  /** vol préparé pour ce tir (traînée, atmosphère, rotation terrestre, dérive gyroscopique) */
  flight: Flight;
  origin: Vector3;
  pos: Vector3;
  prev: Vector3;
  alive: boolean;
  wasSupersonic: boolean;
  transonicDone: boolean;
  /** plus petite distance au campement en vol supersonique */
  campCrack: number;
  id: number;
}
export interface ImpactReport {
  bullet: Bullet;
  kind: ImpactKind;
  point: Vector3;
  /** distance tireur → impact */
  distance: number;
  tof: number;
  energy: number;
  velocity: number;
  target: Target | null;
  result: HitResult | null;
  campCrack: number;
}
export interface Prediction {
  point: Vector3;
  tof: number;
  target: Target | null;
  velocity: number;
}

const gauss = (): number => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const SUB = 1 / 400;
const zeroCache = new Map<string, number>();
export function zeroOf(def: WeaponDef): number {
  let z = zeroCache.get(def.id);
  if (z === undefined) {
    z = zeroAngle(def, def.zero, SIGHT_HEIGHT, GAME_AIR);
    zeroCache.set(def.id, z);
  }
  return z;
}

/** Direction du canon à partir de la ligne de visée et des réglages de tourelles (mrad). */
export function boreDirection(los: Vector3, def: WeaponDef, elevMil: number, windMil: number, out: Vector3): Vector3 {
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(los, up).normalize();
  const trueUp = new Vector3().crossVectors(right, los).normalize();
  const e = zeroOf(def) + elevMil * 0.001;
  // corriger « à droite » déplace l'impact à droite
  return out.copy(los).addScaledVector(trueUp, Math.tan(e)).addScaledVector(right, windMil * 0.001).normalize();
}

/**
 * Physique d'un niveau → environnement du solveur. Renvoie `undefined` quand rien n'est activé : le vol est alors
 * celui d'origine (air du jeu uniforme, aucun effet), au bit près pour une arme en G1.
 */
export function ballisticEnv(p: LevelPhysics | undefined): BallisticEnv | undefined {
  if (!p) return undefined;
  const powder = (p.powderTempSens ?? 0) !== 0 && p.temperatureC !== 15;
  if (!p.coriolis && !p.spinDrift && !p.aeroJump && !p.densityFromAltitude && !powder) return undefined;
  return {
    latitudeDeg: p.latitudeDeg, altitudeM: p.altitudeM, temperatureC: p.temperatureC, pressureHPa: p.pressureHPa, humidityPct: p.humidityPct,
    coriolis: p.coriolis, spinDrift: p.spinDrift, aeroJump: p.aeroJump, densityFromAltitude: p.densityFromAltitude, powderTempSens: p.powderTempSens,
  };
}

/** Ce que le niveau impose aux projectiles. */
export interface ShotsEnv {
  /** niveau de l'eau (gerbes), ou null */
  waterLevel: number | null;
  /** zone d'alerte (campement) : on y mesure le passage supersonique le plus proche ; null = aucune */
  alertZone: { x: number; z: number } | null;
  /** physique du niveau (Coriolis, dérive gyroscopique, densité selon l'altitude…) : voir `ballisticEnv` */
  physics: LevelPhysics;
}

const UP = new Vector3(0, 1, 0);

/**
 * Distance de l'œil, m, en deçà de laquelle le décor est ignoré : il est derrière l'objectif de la lunette et la bouche
 * du canon. La même valeur sert à la vue en lunette (objectif à 0,45 m + plan proche de 0,55 m), au télémètre et à la balle.
 */
export const MUZZLE_CLEAR = 1.0;

export class Shots {
  bullets: Bullet[] = [];
  targets: Target[] = [];
  onImpact: (r: ImpactReport) => void = () => {};
  private acc = 0;
  private ws: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
  private hit = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private nextId = 1;
  private tag = { tag: 'stone' as SurfaceTag };

  private water: number;
  private riverAt: (x: number, z: number) => number = () => -Infinity;
  private riverTop = -Infinity;
  /** environnement balistique du niveau ; `undefined` = aucun effet avancé (voir `ballisticEnv`) */
  readonly benv: BallisticEnv | undefined;
  private ld = new Vector3();
  private lr = new Vector3();
  private lu = new Vector3();

  constructor(private terrain: Terrain, private col: Colliders, private wind: Wind, private ctx: TargetCtx, readonly env: ShotsEnv) {
    // sans plan d'eau : niveau repoussé sous tout relief, aucune gerbe
    this.water = env.waterLevel ?? -1e9;
    // rivière du relief (meta.river + meta.riverWidth) : surface au point (x, z), −∞ hors du lit
    if (typeof terrain.waterSurfaceAt === 'function') {
      this.riverAt = (x, z) => terrain.waterSurfaceAt(x, z);
      terrain.waterSurfaceAt(0, 0);
      this.riverTop = terrain.riverTop;
    }
    this.benv = ballisticEnv(env.physics);
  }

  /**
   * Départ d'un coup, commun au tir réel, à la prévision et au tireur automatique : vol préparé pour l'arme dans
   * l'environnement du niveau, direction du canon (zérotage + tourelles), saut aérodynamique dû au vent traversier
   * à la bouche à l'instant `time`, vitesse initiale du vol (température de la poudre comprise).
   * `sigma` > 0 : dispersion mécanique (rad). Remplit `s` et renvoie le vol.
   */
  private launch(eye: Vector3, los: Vector3, def: WeaponDef, elevMil: number, windMil: number, time: number, sigma: number, s: BulletState): Flight {
    const oy = eye.y - SIGHT_HEIGHT;
    const f = makeFlight(def, this.benv, { air: GAME_AIR, frame: 'world', y0: oy });
    const dir = boreDirection(los, def, elevMil, windMil, this.ld);
    if (this.benv?.aeroJump) {
      // composante du vent qui pousse vers la droite du tireur : elle fait monter ou descendre le départ
      this.wind.sample(eye.x, oy, eye.z, this.ws, time);
      const right = this.lr.crossVectors(los, UP).normalize();
      const jump = aeroJumpMil(def, f.sg, this.ws.x * right.x + this.ws.z * right.z) * 0.001;
      if (jump !== 0) dir.addScaledVector(this.lu.crossVectors(right, los).normalize(), jump).normalize();
    }
    if (sigma > 0) {
      const right = this.lr.crossVectors(dir, UP).normalize();
      const tu = this.lu.crossVectors(right, dir);
      dir.addScaledVector(right, gauss() * sigma).addScaledVector(tu, gauss() * sigma).normalize();
    }
    s.x = eye.x; s.y = oy; s.z = eye.z;
    s.vx = dir.x * f.v0; s.vy = dir.y * f.v0; s.vz = dir.z * f.v0;
    s.t = 0;
    return f;
  }

  fire(eye: Vector3, los: Vector3, def: WeaponDef, elevMil: number, windMil: number, disperse = true): Bullet {
    const s: BulletState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
    const flight = this.launch(eye, los, def, elevMil, windMil, this.wind.time, disperse ? (def.moa * 0.2909) / 3 / 1000 : 0, s);
    const o = new Vector3(s.x, s.y, s.z);
    const b: Bullet = {
      s, def, flight, origin: o.clone(), pos: o.clone(), prev: o.clone(), alive: true,
      wasSupersonic: machAt(flight, flight.v0, s.y) > 1.2, transonicDone: false, campCrack: 1e9, id: this.nextId++,
    };
    this.bullets.push(b);
    return b;
  }

  /** Avance un projectile d'un sous-pas ; renvoie vrai s'il a touché quelque chose (rapport émis si emit). */
  private advance(b: Bullet, timeNow: number, emit: boolean, frozenWind: boolean, out?: Prediction): boolean {
    const s = b.s;
    this.a.set(s.x, s.y, s.z);
    this.wind.sample(s.x, s.y, s.z, this.ws, frozenWind ? this.wind.time : timeNow);
    stepFlight(s, SUB, b.flight, this.ws.x, 0, this.ws.z);
    this.b.set(s.x, s.y, s.z);
    const v = Math.hypot(s.vx, s.vy, s.vz);
    // nombre de Mach local (la vitesse du son baisse avec l'altitude si le niveau le demande)
    const mach = machAt(b.flight, v, s.y);
    // passage transsonique : le projectile est déstabilisé une fois
    if (emit && b.wasSupersonic && !b.transonicDone && mach < 1.12) {
      b.transonicDone = true;
      const sig = (b.def.transonicMoa * 0.2909) / 2 / 1000;
      s.vx += gauss() * sig * v;
      s.vy += gauss() * sig * v;
      s.vz += gauss() * sig * v;
    }
    if (this.env.alertZone && mach > 1.02) {
      const dc = Math.hypot(s.x - this.env.alertZone.x, s.z - this.env.alertZone.z);
      if (dc < b.campCrack) b.campCrack = dc;
    }
    // --- collisions : la plus proche l'emporte ---
    let bestT = 2;
    let kind: ImpactKind = 'dirt';
    let target: Target | null = null;
    let part = '';
    for (const t of this.targets) {
      if (!t.active) continue;
      const h = t.segment(this.a, this.b);
      if (h && h.t < bestT) { bestT = h.t; target = t; part = h.part; }
    }
    const seg = this.a.distanceTo(this.b);
    const d = this.col.segment(this.a, this.b, this.hit, this.tag);
    // un obstacle à moins d'un canon de l'œil (parapet ou dalle sous l'arme) est déjà dépassé par la bouche : ignoré
    if (d >= 0 && d / seg < bestT && this.hit.distanceTo(b.origin) >= MUZZLE_CLEAR) {
      bestT = d / seg;
      target = null;
      kind = this.tag.tag === 'wood' ? 'wood' : this.tag.tag === 'metal' ? 'metal' : 'rock';
    }
    if (s.y < this.terrain.heightAt(s.x, s.z)) {
      const tp = new Vector3();
      if (this.terrain.raycast(this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z, tp, seg / 4)) {
        const tt = this.a.distanceTo(tp) / seg;
        if (tt < bestT) {
          bestT = tt;
          target = null;
          // lac (niveau de la carte) ou lit d'une rivière (surface au point d'impact)
          const wet = tp.y < this.water + 0.05 || tp.y < this.riverAt(tp.x, tp.z) + 0.05;
          kind = wet ? 'water' : this.terrain.splatAt(tp.x, tp.z, 0) > 0.5 ? 'rock' : 'dirt';
        }
      }
    } else if (s.y < this.water && this.terrain.heightAt(s.x, s.z) < this.water - 0.2) {
      const tt = (this.a.y - this.water) / Math.max(1e-6, this.a.y - this.b.y);
      if (tt >= 0 && tt < bestT) { bestT = tt; target = null; kind = 'water'; }
    } else if (s.y < this.riverTop) {
      // rivière : la balle passe sous la surface de l'eau avant de toucher le fond
      const wy = this.riverAt(s.x, s.z);
      if (s.y < wy && this.terrain.heightAt(s.x, s.z) < wy - 0.2) {
        const tt = (this.a.y - wy) / Math.max(1e-6, this.a.y - this.b.y);
        if (tt >= 0 && tt < bestT) { bestT = tt; target = null; kind = 'water'; }
      }
    }
    if (bestT <= 1) {
      const p = new Vector3().lerpVectors(this.a, this.b, bestT);
      const energy = 0.5 * b.def.bulletGr * GRAIN_KG * v * v;
      if (out) { out.point.copy(p); out.tof = s.t; out.target = target; out.velocity = v; }
      if (emit) {
        let result: HitResult | null = null;
        if (target) {
          result = target.onHit({ part, point: p, dir: new Vector3(s.vx, s.vy, s.vz).normalize(), energy, weapon: b.def }, this.ctx);
          kind = result.kind;
        }
        b.pos.copy(p);
        this.onImpact({ bullet: b, kind, point: p, distance: p.distanceTo(b.origin), tof: s.t, energy, velocity: v, target, result, campCrack: b.campCrack });
      }
      b.alive = false;
      return true;
    }
    b.prev.copy(this.a);
    b.pos.copy(this.b);
    if (s.t > 14 || v < 25) { b.alive = false; return true; }
    return false;
  }

  update(dt: number): void {
    this.acc += dt;
    const steps = Math.floor(this.acc / SUB);
    this.acc -= steps * SUB;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      const t0 = this.wind.time - steps * SUB;
      for (let i = 0; i < steps && b.alive; i++) this.advance(b, t0 + i * SUB, true, false);
    }
    if (this.bullets.length && !this.bullets.some((b) => b.alive)) this.bullets.length = 0;
  }

  /**
   * Prévision sans dispersion. frozenWind : le vent reste celui de l'instant présent (aide à la visée) ;
   * sinon il évolue comme il le fera réellement (caméra de balle).
   */
  predict(eye: Vector3, los: Vector3, def: WeaponDef, elevMil: number, windMil: number, frozenWind: boolean, maxT = 6): Prediction | null {
    const s: BulletState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
    const flight = this.launch(eye, los, def, elevMil, windMil, this.wind.time, 0, s);
    const o = new Vector3(s.x, s.y, s.z);
    const b: Bullet = { s, def, flight, origin: o, pos: o.clone(), prev: o.clone(), alive: true, wasSupersonic: false, transonicDone: true, campCrack: 1e9, id: 0 };
    const out: Prediction = { point: new Vector3(), tof: 0, target: null, velocity: 0 };
    const n = Math.ceil(maxT / SUB);
    for (let i = 0; i < n; i++) if (this.advance(b, this.wind.time + i * SUB, false, frozenWind, out)) return out.tof > 0 ? out : null;
    return null;
  }

  /** Position du projectile (sans collision) quand il a parcouru la distance donnée. Sert à la visée automatique des tests. */
  flyTo(eye: Vector3, los: Vector3, def: WeaponDef, elevMil: number, windMil: number, range: number, out: Vector3): number {
    const s: BulletState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
    const flight = this.launch(eye, los, def, elevMil, windMil, this.wind.time, 0, s);
    const ox = s.x, oy = s.y, oz = s.z;
    let px = s.x, py = s.y, pz = s.z, pd = 0;
    // 12 s de vol au plus : un tir à 2 500 m en dure 5 à 8 selon le calibre
    for (let i = 0; i < 4800; i++) {
      this.wind.sample(s.x, s.y, s.z, this.ws, this.wind.time + s.t);
      stepFlight(s, SUB, flight, this.ws.x, 0, this.ws.z);
      const d = Math.hypot(s.x - ox, s.y - oy, s.z - oz);
      if (d >= range) {
        const f = (range - pd) / (d - pd);
        out.set(px + (s.x - px) * f, py + (s.y - py) * f, pz + (s.z - pz) * f);
        return s.t - SUB * (1 - f);
      }
      px = s.x; py = s.y; pz = s.z; pd = d;
    }
    out.set(s.x, s.y, s.z);
    return s.t;
  }
}
