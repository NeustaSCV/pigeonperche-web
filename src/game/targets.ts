// Les cibles : plaques, ballon, antenne, projecteur, bidon, cadenas, drone, sentinelle, véhicule, cible dans la foule.
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { ImpactKind } from '../audio/types';
import type { WeaponDef } from '../config/weapons';
import type { Engine } from '../core/engine';
import { damp, mulberry32 } from '../core/noise';
import { CharacterMesh, Crowd, defaultPose, type Outfit, type PoseInput } from '../player/character';
import type { Fx } from '../world/fx';
import type { Terrain } from '../world/terrain';
import type { Wind, WindSample } from '../world/wind';

/** Points d'ancrage que le décor d'un niveau fournit aux cibles qui en ont besoin. */
export interface PadlockAnchors { padlock: Vector3; padlockYaw: number; gatePivot: Vector3; gateYaw: number }
export interface SentinelAnchors { mirador: Vector3; miradorYaw: number }
export interface MarketAnchors { market: Vector3; /** obstacles du marché (x, z, rayon) */ stalls: [number, number, number][] }

export interface Collider {
  node: Object3D;
  shape: 'sphere' | 'box';
  r: number;
  half: Vector3;
  part: string;
}
export interface HitInfo {
  part: string;
  point: Vector3;
  dir: Vector3;
  energy: number;
  weapon: WeaponDef;
}
export interface HitResult {
  kind: ImpactKind;
  /** message court affiché au joueur */
  note?: string;
  /** la cible vient d'être neutralisée */
  success?: boolean;
  /** un civil a été touché */
  civilian?: boolean;
}
export interface TargetCtx {
  fx: Fx;
  wind: Wind;
  terrain: Terrain;
  time: number;
}

const _inv = new Matrix4();
const _a = new Vector3(), _b = new Vector3(), _d = new Vector3();

/** Intersection segment / collisionneur. Renvoie t dans [0,1] ou -1. */
function hitCollider(c: Collider, a: Vector3, b: Vector3): number {
  if (c.shape === 'sphere') {
    _a.setFromMatrixPosition(c.node.matrixWorld);
    _d.copy(b).sub(a);
    const l2 = _d.lengthSq();
    _b.copy(a).sub(_a);
    const B = _b.dot(_d), C = _b.lengthSq() - c.r * c.r;
    const disc = B * B - l2 * C;
    if (disc < 0) return -1;
    const t = (-B - Math.sqrt(disc)) / l2;
    return t >= 0 && t <= 1 ? t : C < 0 ? 0 : -1;
  }
  _inv.copy(c.node.matrixWorld).invert();
  _a.copy(a).applyMatrix4(_inv);
  _b.copy(b).applyMatrix4(_inv);
  _d.copy(_b).sub(_a);
  let t0 = 0, t1 = 1;
  for (const ax of ['x', 'y', 'z'] as const) {
    const o = _a[ax], dd = _d[ax], h = c.half[ax];
    if (Math.abs(dd) < 1e-9) { if (o < -h || o > h) return -1; continue; }
    let u0 = (-h - o) / dd, u1 = (h - o) / dd;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    if (t0 > t1) return -1;
  }
  return t0;
}

export abstract class Target {
  group = new Group();
  colliders: Collider[] = [];
  done = false;
  /** active = visible et touchable */
  active = true;
  hits = 0;
  constructor(public id: string, public label: string) {}
  protected addCollider(node: Object3D, shape: 'sphere' | 'box', part: string, r = 0.2, half?: Vector3): Collider {
    const c = { node, shape, r, half: half ?? new Vector3(r, r, r), part };
    this.colliders.push(c);
    return c;
  }
  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    let best: { t: number; part: string } | null = null;
    for (const c of this.colliders) {
      const t = hitCollider(c, a, b);
      if (t >= 0 && (!best || t < best.t)) best = { t, part: c.part };
    }
    return best;
  }
  /** point à viser (centre de la zone utile) */
  abstract aimPoint(out: Vector3): Vector3;
  /** position prévue du point à viser dans dt secondes */
  predict(dt: number, out: Vector3): Vector3 {
    void dt;
    return this.aimPoint(out);
  }
  update(_dt: number, _ctx: TargetCtx): void {}
  abstract onHit(h: HitInfo, ctx: TargetCtx): HitResult;
}

const std = (engine: Engine, color: number, rough = 0.7, metal = 0, key = 'tgt'): MeshStandardMaterial =>
  engine.setupMaterial(new MeshStandardMaterial({ color, roughness: rough, metalness: metal }), undefined, key);

// ---------------------------------------------------------------- plaque d'acier
export class SteelPlate extends Target {
  private plate = new Object3D();
  private angle = 0;
  private av = 0;
  constructor(engine: Engine, id: string, label: string, pos: Vector3, public size: number, round: boolean) {
    super(id, label);
    const toS = new Vector3(-pos.x, 0, -pos.z).normalize();
    this.group.position.copy(pos);
    this.group.rotation.y = Math.atan2(toS.x, toS.z);
    const wood = std(engine, 0x5d4c38, 0.9);
    const H = 1.55;
    for (const s of [-1, 1]) {
      const p = new Mesh(new BoxGeometry(0.07, H + 0.3, 0.07), wood);
      p.position.set(s * (size / 2 + 0.22), H / 2 - 0.15, 0);
      p.castShadow = true;
      this.group.add(p);
    }
    const bar = new Mesh(new BoxGeometry(size + 0.6, 0.07, 0.07), wood);
    bar.position.set(0, H, 0);
    this.group.add(bar);
    this.plate.position.set(0, H - 0.04, 0);
    this.group.add(this.plate);
    const steel = std(engine, 0xe9e6de, 0.55, 0.3);
    const geo = round ? new CylinderGeometry(size / 2, size / 2, 0.012, 24) : new BoxGeometry(size, 0.012, size);
    const m = new Mesh(geo, steel);
    m.rotation.x = Math.PI / 2;
    m.position.y = -0.14 - size / 2;
    m.castShadow = true;
    this.plate.add(m);
    const dot = new Mesh(new CircleGeometry(size * 0.16, 16), new MeshBasicMaterial({ color: 0xd9541e }));
    dot.position.set(0, -0.14 - size / 2, 0.008);
    this.plate.add(dot);
    for (const s of [-1, 1]) {
      const ch = new Mesh(new BoxGeometry(0.012, 0.16, 0.012), std(engine, 0x333333, 0.5, 0.8));
      ch.position.set(s * size * 0.32, -0.07, 0);
      this.plate.add(ch);
    }
    const node = new Object3D();
    node.position.set(0, -0.14 - size / 2, 0);
    this.plate.add(node);
    if (round) this.addCollider(node, 'sphere', 'plate', size / 2);
    else this.addCollider(node, 'box', 'plate', 0, new Vector3(size / 2, size / 2, 0.02));
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[0].node.getWorldPosition(out);
  }
  update(dt: number): void {
    this.av += (-22 * this.angle - 1.4 * this.av) * dt;
    this.angle += this.av * dt;
    this.plate.rotation.x = this.angle;
  }
  onHit(h: HitInfo): HitResult {
    this.av -= Math.min(9, 1.2 + h.energy / 260);
    this.hits++;
    // marque d'impact : la peinture saute
    const local = this.plate.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.012 + Math.min(0.02, h.weapon.bulletGr * 0.00008), 8), new MeshBasicMaterial({ color: 0x24262a }));
    mark.position.set(local.x, local.y, 0.009);
    this.plate.add(mark);
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first };
  }
}

// ---------------------------------------------------------------- ballon
export class Balloon extends Target {
  private ball: Mesh;
  private base: Vector3;
  private ws: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
  private string: Mesh;
  constructor(engine: Engine, pos: Vector3) {
    super('balloon', "Ballon d'entraînement");
    this.base = pos.clone();
    const peg = new Mesh(new BoxGeometry(0.06, 0.5, 0.06), std(engine, 0x5d4c38, 0.9));
    peg.position.copy(pos).y += 0.2;
    this.group.add(peg);
    this.ball = new Mesh(new SphereGeometry(0.24, 18, 14), std(engine, 0xd8362c, 0.3, 0, 'balloon'));
    this.ball.scale.set(1, 1.18, 1);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    this.string = new Mesh(new CylinderGeometry(0.004, 0.004, 1, 4), new MeshBasicMaterial({ color: 0xdddddd }));
    this.group.add(this.string);
    this.addCollider(this.ball, 'sphere', 'balloon', 0.26);
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.ball.position);
  }
  update(_dt: number, ctx: TargetCtx): void {
    if (this.done) return;
    ctx.wind.sample(this.base.x, this.base.y, this.base.z, this.ws);
    // le ballon se couche sous le vent : bon indice de force et de direction
    const L = 3.2;
    const lean = Math.min(1.1, this.ws.speed * 0.11);
    const bob = Math.sin(ctx.time * 1.3) * 0.05;
    this.ball.position.set(this.base.x + this.ws.x / (this.ws.speed + 0.01) * Math.sin(lean) * L, this.base.y + 0.45 + Math.cos(lean) * L + bob, this.base.z + this.ws.z / (this.ws.speed + 0.01) * Math.sin(lean) * L);
    _a.set(this.base.x, this.base.y + 0.45, this.base.z);
    this.string.position.copy(_a).add(this.ball.position).multiplyScalar(0.5);
    this.string.scale.set(1, _a.distanceTo(this.ball.position), 1);
    this.string.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), _b.copy(this.ball.position).sub(_a).normalize());
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.done = true;
    this.active = false;
    this.ball.visible = false;
    this.string.visible = false;
    ctx.fx.puff(h.point, { count: 26, speed: 4, life: 0.7, size: [0.03, 0.07], color: 0xd8362c, alpha: 0.95, gravity: 6, drag: 2.5, wind: 0.3 });
    return { kind: 'balloon', success: true };
  }
}

// ---------------------------------------------------------------- boîtier d'antenne
export class RelayFeed extends Target {
  private led: Mesh;
  private box: Mesh;
  constructor(engine: Engine, pos: Vector3) {
    super('relay', 'Émetteur du relais radio');
    this.group.position.copy(pos);
    this.group.lookAt(0, pos.y, 0);
    this.box = new Mesh(new BoxGeometry(0.5, 0.62, 0.3), std(engine, 0x9aa0a4, 0.5, 0.5));
    this.box.castShadow = true;
    this.group.add(this.box);
    const fin = new Mesh(new CylinderGeometry(0.03, 0.03, 1.5, 6), std(engine, 0xd8d8d8, 0.4, 0.6));
    fin.position.set(0, 0.9, 0);
    this.group.add(fin);
    this.led = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ color: new Color(6, 0.3, 0.2) }));
    this.led.position.set(0.14, 0.2, 0.16);
    this.group.add(this.led);
    this.addCollider(this.box, 'box', 'feed', 0, new Vector3(0.25, 0.31, 0.15));
  }
  aimPoint(out: Vector3): Vector3 {
    return this.box.getWorldPosition(out);
  }
  update(_dt: number, ctx: TargetCtx): void {
    this.led.visible = !this.done && Math.sin(ctx.time * 5) > -0.2;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (h.energy < 120) return { kind: 'metal', note: 'Énergie insuffisante : le boîtier a résisté.' };
    this.done = true;
    ctx.fx.puff(h.point, { count: 30, speed: 5, life: 0.5, size: [0.02, 0.04], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.5 });
    ctx.fx.puff(h.point, { count: 8, speed: 0.6, up: 0.8, life: 3, size: [0.2, 1.2], color: 0x555555, alpha: 0.5 });
    (this.box.material as MeshStandardMaterial).color.set(0x3a3a3a);
    return { kind: 'electric', success: true };
  }
}

// ---------------------------------------------------------------- projecteur
export class Searchlight extends Target {
  private head = new Object3D();
  private lens: Mesh;
  private cone: Mesh;
  constructor(engine: Engine, pos: Vector3) {
    super('searchlight', 'Projecteur du campement');
    this.group.position.copy(pos);
    this.group.add(this.head);
    const body = new Mesh(new CylinderGeometry(0.3, 0.24, 0.5, 14), std(engine, 0x2e3134, 0.5, 0.7));
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    this.head.add(body);
    this.lens = new Mesh(new CircleGeometry(0.27, 18), new MeshBasicMaterial({ color: new Color(14, 12, 9) }));
    this.lens.position.z = 0.26;
    this.head.add(this.lens);
    const cg = new CylinderGeometry(0.28, 3.2, 26, 16, 1, true);
    cg.rotateX(-Math.PI / 2);
    cg.translate(0, 0, 13.2);
    this.cone = new Mesh(cg, new MeshBasicMaterial({ color: new Color(1, 0.9, 0.7), transparent: true, opacity: 0.045, depthWrite: false, side: 2 }));
    this.head.add(this.cone);
    this.addCollider(this.head, 'sphere', 'lamp', 0.33);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.head.getWorldPosition(out);
  }
  update(_dt: number, ctx: TargetCtx): void {
    if (this.done) return;
    // balayage lent centré sur la direction du sommet
    const p = this.group.position;
    const base = Math.atan2(-p.x, -p.z);
    this.head.rotation.set(0.12, base + Math.sin(ctx.time * 0.22) * 0.55, 0);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.done = true;
    this.lens.visible = false;
    this.cone.visible = false;
    ctx.fx.puff(h.point, { count: 34, speed: 4.5, life: 0.8, size: [0.015, 0.03], color: 0xe8f0ff, alpha: 1, gravity: 9, drag: 0.6, wind: 0, glow: 0.8 });
    return { kind: 'glass', success: true };
  }
}

// ---------------------------------------------------------------- bidon de carburant
export class FuelDrum extends Target {
  private drum: Mesh;
  constructor(engine: Engine, pos: Vector3) {
    super('drum', 'Bidon de carburant');
    this.drum = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 16), std(engine, 0xa8322a, 0.5, 0.4));
    this.drum.position.copy(pos).y += 0.45;
    this.drum.castShadow = true;
    this.group.add(this.drum);
    const band = new Mesh(new CylinderGeometry(0.305, 0.305, 0.12, 16), std(engine, 0xd8c23a, 0.5, 0.3));
    band.position.copy(this.drum.position);
    this.group.add(band);
    this.addCollider(this.drum, 'box', 'drum', 0, new Vector3(0.3, 0.45, 0.3));
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.drum.position);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (h.energy < 250 || h.weapon.penetration < 2) return { kind: 'metal', note: 'La tôle du bidon a tenu : il faut un calibre plus puissant.' };
    this.done = true;
    const p = this.drum.position.clone();
    ctx.fx.puff(p, { count: 40, speed: 5, up: 4, life: 1.2, size: [0.5, 2.6], color: 0xff9a3a, alpha: 0.9, drag: 1.5, wind: 0.4, glow: 1.2 });
    ctx.fx.addEmitter(p.clone().add(new Vector3(0, 0.6, 0)), 16, { speed: 0.7, up: 2.4, life: 1.0, size: [0.35, 1.1], color: 0xff8a2a, alpha: 0.85, drag: 0.8, wind: 0.5, glow: 1.0 });
    ctx.fx.addEmitter(p.clone().add(new Vector3(0, 1.6, 0)), 7, { speed: 0.6, up: 2.6, life: 7, size: [0.8, 6], color: 0x242424, alpha: 0.6, drag: 0.3, wind: 1 });
    (this.drum.material as MeshStandardMaterial).color.set(0x1c1a18);
    return { kind: 'fuel', success: true };
  }
}

// ---------------------------------------------------------------- cadenas du treuil
export class Padlock extends Target {
  private lock: Mesh;
  private arm = new Object3D();
  private open = 0;
  constructor(engine: Engine, a: PadlockAnchors) {
    super('padlock', 'Cadenas du treuil');
    this.lock = new Mesh(new BoxGeometry(0.26, 0.3, 0.09), std(engine, 0xc9a23a, 0.35, 0.9));
    this.lock.position.copy(a.padlock);
    this.lock.rotation.y = a.padlockYaw;
    this.lock.castShadow = true;
    this.group.add(this.lock);
    const sh = new Mesh(new BoxGeometry(0.16, 0.14, 0.03), std(engine, 0x777777, 0.3, 0.9));
    sh.position.copy(a.padlock).y += 0.2;
    sh.rotation.y = a.padlockYaw;
    this.group.add(sh);
    // barrière levante retenue par le treuil : elle retombe quand le cadenas saute
    this.arm.position.copy(a.gatePivot);
    this.arm.rotation.y = a.gateYaw;
    const boom = new Mesh(new BoxGeometry(0.12, 0.12, 6.8), std(engine, 0xd8d2c4, 0.7));
    boom.position.z = 3.1;
    boom.castShadow = true;
    this.arm.add(boom);
    for (let i = 0; i < 4; i++) {
      const st = new Mesh(new BoxGeometry(0.125, 0.125, 0.6), std(engine, 0xb8362c, 0.7));
      st.position.z = 1.2 + i * 1.5;
      this.arm.add(st);
    }
    this.arm.rotation.x = -1.25;
    this.group.add(this.arm);
    this.addCollider(this.lock, 'box', 'lock', 0, new Vector3(0.14, 0.16, 0.06));
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.lock.position);
  }
  update(dt: number): void {
    if (this.done) {
      this.open = damp(this.open, 1, 2.2, dt);
      this.arm.rotation.x = -1.25 * (1 - this.open) + Math.sin(this.open * 9) * 0.05 * (1 - this.open);
    }
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (h.energy < 280 || h.weapon.penetration < 2) return { kind: 'metal', note: 'Le cadenas a encaissé : pas assez d’énergie à cette distance.' };
    this.done = true;
    this.lock.visible = false;
    ctx.fx.puff(h.point, { count: 18, speed: 3.5, life: 0.5, size: [0.015, 0.03], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.2 });
    return { kind: 'metal', success: true };
  }
}

// ---------------------------------------------------------------- drone
export class Drone extends Target {
  private body = new Group();
  private home: Vector3;
  private vel = new Vector3();
  private rot: Mesh[] = [];
  private ws: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
  private crashed = false;
  constructor(engine: Engine, pos: Vector3) {
    super('drone', 'Drone en vol stationnaire');
    this.home = pos.clone();
    const dark = std(engine, 0x1d1f22, 0.4, 0.5);
    const hull = new Mesh(new BoxGeometry(0.34, 0.12, 0.44), dark);
    hull.castShadow = true;
    this.body.add(hull);
    const cam = new Mesh(new SphereGeometry(0.07, 10, 8), std(engine, 0x0a0a0c, 0.1, 0.8));
    cam.position.set(0, -0.09, 0.14);
    this.body.add(cam);
    const blur = new MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.32, depthWrite: false, side: 2 });
    for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [0.36, 0.36], [-0.36, 0.36]]) {
      const arm = new Mesh(new BoxGeometry(0.04, 0.03, 0.52), dark);
      arm.position.set(x / 2, 0, z / 2);
      arm.rotation.y = Math.atan2(x, z);
      this.body.add(arm);
      const r = new Mesh(new CircleGeometry(0.2, 14), blur);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.06, z);
      this.body.add(r);
      this.rot.push(r);
    }
    const led = new Mesh(new SphereGeometry(0.025, 6, 6), new MeshBasicMaterial({ color: new Color(0.3, 5, 0.6) }));
    led.position.set(0, 0.02, -0.24);
    this.body.add(led);
    this.body.position.copy(pos);
    this.group.add(this.body);
    this.addCollider(this.body, 'box', 'drone', 0, new Vector3(0.42, 0.12, 0.42));
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.body.position);
  }
  private posAt(t: number, out: Vector3): Vector3 {
    return out.set(this.home.x + Math.sin(t * 0.31) * 1.6 + Math.sin(t * 0.83) * 0.3, this.home.y + Math.sin(t * 0.47) * 0.7, this.home.z + Math.sin(t * 0.23 + 1) * 1.3);
  }
  private now = 0;
  predict(dt: number, out: Vector3): Vector3 {
    return this.done ? out.copy(this.body.position) : this.posAt(this.now + dt, out);
  }
  update(dt: number, ctx: TargetCtx): void {
    this.now = ctx.time;
    if (!this.done) {
      this.posAt(ctx.time, this.body.position);
      ctx.wind.sample(this.home.x, this.home.y, this.home.z, this.ws);
      // le drone penche contre le vent pour tenir sa position
      this.body.rotation.set(-this.ws.z * 0.03, ctx.time * 0.05, this.ws.x * 0.03);
    } else if (!this.crashed) {
      this.vel.y -= 9.8 * dt;
      this.body.position.addScaledVector(this.vel, dt);
      this.body.rotation.x += dt * 5;
      this.body.rotation.z += dt * 3.1;
      if (Math.random() < 0.5) ctx.fx.puff(this.body.position, { count: 1, speed: 0.3, life: 1.6, size: [0.1, 0.7], color: 0x333333, alpha: 0.5 });
      if (this.body.position.y < ctx.terrain.heightAt(this.body.position.x, this.body.position.z) + 0.1) {
        this.crashed = true;
        ctx.fx.puff(this.body.position, { count: 14, speed: 2, up: 1, life: 1.6, size: [0.2, 1.4], color: 0x8a7a66, alpha: 0.5 });
      }
    }
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (this.done) return { kind: 'metal' };
    this.done = true;
    this.vel.copy(h.dir).multiplyScalar(1.5);
    for (const r of this.rot) r.visible = false;
    ctx.fx.puff(h.point, { count: 16, speed: 3, life: 0.5, size: [0.015, 0.03], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.2 });
    return { kind: 'electric', success: true };
  }
  /** position et niveau sonore pour le bourdonnement */
  get position(): Vector3 {
    return this.body.position;
  }
}

// ---------------------------------------------------------------- personnage ciblable (sentinelle)
function humanColliders(t: Target, ch: CharacterMesh): void {
  const head = new Object3D();
  head.position.set(0, 0.13, 0);
  ch.rig.head.add(head);
  t.colliders.push({ node: head, shape: 'sphere', r: 0.125, half: new Vector3(), part: 'head' });
  const torso = new Object3D();
  torso.position.set(0, 0.26, 0);
  ch.rig.spine.add(torso);
  t.colliders.push({ node: torso, shape: 'box', r: 0, half: new Vector3(0.21, 0.3, 0.14), part: 'torso' });
  for (const leg of [ch.rig.legL, ch.rig.legR]) {
    const n = new Object3D();
    n.position.set(0, -0.4, 0);
    leg.add(n);
    t.colliders.push({ node: n, shape: 'box', r: 0, half: new Vector3(0.09, 0.44, 0.09), part: 'legs' });
  }
}

export class Sentinel extends Target {
  private ch: CharacterMesh;
  private pose: PoseInput = defaultPose();
  private u = 0.5;
  private dir = 1;
  private wait = 3;
  private now = 0;
  private yaw: number;
  private center: Vector3;
  private side = new Vector3();
  constructor(engine: Engine, a: SentinelAnchors) {
    super('sentinel', 'Sentinelle du mirador');
    this.ch = new CharacterMesh(engine, { jacket: 0x3d4033, trousers: 0x33362b, skin: 0xb98f70, hat: 0x262a22, pack: null, boots: 0x1c1915, height: 1.0 });
    // fusil d'assaut en bandoulière sur la poitrine
    const gun = new Mesh(new BoxGeometry(0.05, 0.09, 0.78), std(engine, 0x151515, 0.5, 0.6));
    gun.position.set(0, 0.2, 0.2);
    gun.rotation.set(0.2, 0.9, 0);
    this.ch.rig.spine.add(gun);
    this.group.add(this.ch.group);
    this.center = a.mirador.clone();
    this.yaw = a.miradorYaw;
    this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    humanColliders(this, this.ch);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[1].node.getWorldPosition(out);
  }
  /**
   * Position du buste dans `dt` secondes : le va-et-vient de update() déroulé à l'avance (marche à 0,75 m/s sur
   * 2,4 m, demi-tour, pause). L'ancienne extrapolation en ligne droite, plafonnée à 1,5 s, manquait la sentinelle
   * dès que le vol de la balle (2 s à 1 250 m) enjambait un demi-tour ou la fin d'une pause.
   */
  predict(dt: number, out: Vector3): Vector3 {
    this.aimPoint(out);
    if (this.done) return out;
    let u = this.u, dir = this.dir, wait = this.wait, t = this.now, left = dt;
    for (let guard = 0; guard < 16 && left > 1e-4; guard++) {
      if (wait > 0) {
        const s = Math.min(wait, left);
        wait -= s; left -= s; t += s;
      } else {
        const need = ((dir > 0 ? 1 - u : u) * 2.4) / 0.75;
        const s = Math.min(need, left);
        u += (dir * 0.75 * s) / 2.4; left -= s; t += s;
        if (s >= need) { u = dir > 0 ? 1 : 0; dir = -dir; wait = 3.5 + ((t * 7.3) % 3.5); }
      }
    }
    return out.addScaledVector(this.side, (u - this.u) * 2.4);
  }
  update(dt: number, ctx: TargetCtx): void {
    const p = this.pose;
    p.time += dt;
    this.now = ctx.time;
    if (this.done) {
      p.fall = Math.min(1, p.fall + dt * 1.3);
      p.move = 0;
    } else if (this.wait > 0) {
      this.wait -= dt;
      p.move = damp(p.move, 0, 6, dt);
      p.headYaw = Math.sin(ctx.time * 0.5) * 0.7;
    } else {
      // va-et-vient sur 2,4 m le long du garde-corps face au sommet
      this.u += (this.dir * 0.75 * dt) / 2.4;
      p.move = damp(p.move, 0.75, 6, dt);
      p.phase += dt * 4.6;
      p.headYaw = 0;
      if (this.u > 1 || this.u < 0) {
        this.u = Math.min(1, Math.max(0, this.u));
        this.dir *= -1;
        this.wait = 3.5 + ((ctx.time * 7.3) % 3.5);
      }
    }
    const g = this.ch.group;
    g.position.copy(this.center).addScaledVector(this.side, (this.u - 0.5) * 2.4);
    g.position.x += Math.sin(this.yaw) * 1.05;
    g.position.z += Math.cos(this.yaw) * 1.05;
    // en marche : de profil ; à l'arrêt : face au sommet
    const walkYaw = this.yaw + (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const want = this.wait > 0 || this.done ? this.yaw : walkYaw;
    let d = want - g.rotation.y;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += d * Math.min(1, dt * 5);
    this.ch.rig.pose(p);
  }
  onHit(h: HitInfo): HitResult {
    if (h.energy < 60) return { kind: 'body', note: 'Projectile à bout de course : sans effet.' };
    const first = !this.done;
    this.done = true;
    return { kind: 'body', success: first };
  }
}

// ---------------------------------------------------------------- véhicule
export class Vehicle extends Target {
  private car = new Group();
  private path: Vector3[] = [];
  private lens: number[] = [];
  private total = 0;
  private s = 0;
  private dir = 1;
  speed = 0;
  private cruise = 7.5;
  private pause = 0;
  private stopped = false;
  private smoke: { on: boolean; pos: Vector3 } | null = null;
  private swerve = 0;
  private alertT = 0;
  private fwd = new Vector3();
  /** `patrol` : indices (dans terrain.meta.road) des deux bouts de la navette. */
  constructor(engine: Engine, terrain: Terrain, private fxr: Fx, patrol: [number, number]) {
    super('vehicle', 'Véhicule sur la route');
    const rd = terrain.meta.road;
    const i0 = Math.max(0, patrol[0]), i1 = Math.min(rd.length - 1, patrol[1]);
    for (let i = i0; i <= i1; i++) this.path.push(new Vector3(rd[i][0], Math.max(terrain.heightAt(rd[i][0], rd[i][1]), rd[i][2]) + 0.02, rd[i][1]));
    this.lens.push(0);
    for (let i = 1; i < this.path.length; i++) {
      this.total += this.path[i].distanceTo(this.path[i - 1]);
      this.lens.push(this.total);
    }
    this.s = this.total * 0.75;
    const paint = std(engine, 0x8a2f2a, 0.45, 0.3);
    const dark = std(engine, 0x15171a, 0.5, 0.3);
    const cab = new Mesh(new BoxGeometry(1.75, 0.75, 1.7), paint);
    cab.position.set(0, 1.35, 0.25);
    const hood = new Mesh(new BoxGeometry(1.75, 0.55, 1.45), paint);
    hood.position.set(0, 0.92, 1.75);
    const bed = new Mesh(new BoxGeometry(1.8, 0.6, 2.2), paint);
    bed.position.set(0, 0.95, -1.6);
    const base = new Mesh(new BoxGeometry(1.7, 0.3, 4.9), dark);
    base.position.set(0, 0.55, 0);
    const glass = new Mesh(new BoxGeometry(1.6, 0.5, 1.4), std(engine, 0x10161c, 0.1, 0.5));
    glass.position.set(0, 1.42, 0.3);
    for (const m of [cab, hood, bed, base, glass]) { m.castShadow = true; this.car.add(m); }
    const wheelG = new CylinderGeometry(0.4, 0.4, 0.28, 14);
    wheelG.rotateZ(Math.PI / 2);
    for (const [x, z] of [[-0.9, 1.6], [0.9, 1.6], [-0.9, -1.6], [0.9, -1.6]]) {
      const w = new Mesh(wheelG, dark);
      w.position.set(x, 0.4, z);
      w.castShadow = true;
      this.car.add(w);
      this.addCollider(w, 'sphere', 'tire', 0.42);
    }
    this.addCollider(hood, 'box', 'engine', 0, new Vector3(0.88, 0.3, 0.72));
    this.addCollider(cab, 'box', 'body', 0, new Vector3(0.88, 0.4, 0.85));
    this.addCollider(bed, 'box', 'body', 0, new Vector3(0.9, 0.3, 1.1));
    this.group.add(this.car);
    this.place();
  }
  private at(s: number, out: Vector3, fwd?: Vector3): Vector3 {
    s = Math.min(this.total - 0.01, Math.max(0, s));
    let i = 1;
    while (i < this.lens.length - 1 && this.lens[i] < s) i++;
    const f = (s - this.lens[i - 1]) / (this.lens[i] - this.lens[i - 1]);
    out.lerpVectors(this.path[i - 1], this.path[i], f);
    if (fwd) fwd.copy(this.path[i]).sub(this.path[i - 1]).normalize();
    return out;
  }
  private place(): void {
    this.at(this.s, this.car.position, this.fwd);
    if (this.dir < 0) this.fwd.negate();
    const yaw = Math.atan2(this.fwd.x, this.fwd.z) + this.swerve;
    this.car.rotation.set(-Math.asin(Math.max(-0.4, Math.min(0.4, this.fwd.y))), yaw, 0, 'YXZ');
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[4].node.getWorldPosition(out);
  }
  predict(dt: number, out: Vector3): Vector3 {
    const s = this.s + this.dir * this.speed * dt;
    this.at(s, out);
    out.y += 0.92;
    // capot : 1,75 m devant le centre
    const f = new Vector3();
    this.at(s, _a, f);
    if (this.dir < 0) f.negate();
    return out.addScaledVector(f, 1.75);
  }
  update(dt: number): void {
    if (this.stopped) {
      this.speed = damp(this.speed, 0, 1.6, dt);
      this.swerve = damp(this.swerve, this.swerve > 0 ? 0.5 : this.swerve < 0 ? -0.5 : 0, 2, dt);
    } else if (this.pause > 0) {
      this.pause -= dt;
      this.speed = damp(this.speed, 0, 2.5, dt);
      if (this.pause <= 0) this.dir *= -1;
    } else {
      this.alertT -= dt;
      const want = this.cruise * (this.alertT > 0 ? 1.6 : 1);
      this.speed = damp(this.speed, want, 0.8, dt);
      if ((this.dir > 0 && this.s > this.total - 12) || (this.dir < 0 && this.s < 12)) this.pause = 7;
    }
    this.s += this.dir * this.speed * dt;
    this.place();
    if (this.smoke) this.smoke.pos.copy(this.car.position).add(_a.set(0, 1.2, 0)).addScaledVector(this.fwd, 1.8);
  }
  onHit(h: HitInfo): HitResult {
    if (this.stopped) return { kind: 'metal' };
    if (h.part === 'tire') {
      if (h.energy < 150) return { kind: 'tire', note: 'Le pneu a tenu.' };
      this.stopped = this.done = true;
      this.swerve = Math.random() < 0.5 ? 0.02 : -0.02;
      return { kind: 'tire', success: true, note: 'Pneu crevé : le véhicule est immobilisé.' };
    }
    if (h.part === 'engine') {
      if (h.weapon.penetration < 4 || h.energy < 450) {
        this.alertT = 12;
        return { kind: 'metal', note: `Le ${h.weapon.caliber} ne perce pas le bloc moteur : visez un pneu ou changez de calibre.` };
      }
      this.stopped = this.done = true;
      const e = this.fxr.addEmitter(this.car.position, 9, { speed: 0.5, up: 1.8, life: 5, size: [0.4, 3.5], color: 0x3a3a3a, alpha: 0.6, drag: 0.4, wind: 1 });
      this.smoke = e;
      return { kind: 'metal', success: true, note: 'Bloc moteur percé : le véhicule est immobilisé.' };
    }
    this.alertT = 12;
    return { kind: 'metal', note: 'Carrosserie : sans effet. Visez le moteur ou un pneu.' };
  }
  get position(): Vector3 {
    return this.car.position;
  }
}

// ---------------------------------------------------------------- foule du marché
interface Agent {
  x: number; z: number; yaw: number;
  tx: number; tz: number;
  state: 'walk' | 'idle' | 'talk' | 'flee' | 'down' | 'gone';
  timer: number;
  speed: number;
  pose: PoseInput;
  hostile: boolean;
  faceYaw: number;
}
const JACKETS = [0x3f5f7f, 0x6b7a4a, 0x8a8478, 0xc9b48a, 0x5a4a6a, 0x2f4f4f, 0xb8763a, 0x7a8fa8, 0xd8d2c4, 0x4a4a52, 0x9a5a4a, 0x557a6a];
const TROUSERS = [0x2f3440, 0x4a4438, 0x5a5a5a, 0x3a4a5a, 0x6a5a48, 0x2a2a2e];
const SKIN = [0xc9a184, 0xb98a68, 0xd8b498, 0x9a6f52, 0xc49472];
export const HOSTILE_OUTFIT: Outfit = { jacket: 0x9c3a2e, trousers: 0x2f3440, skin: 0xb98a68, hat: 0x141416, pack: 0x55602f, boots: 0x1c1915, height: 1.03 };
export const HOSTILE_DESC = 'Veste rouge brique, casquette noire, sac à dos vert olive. Il boite de la jambe gauche.';

export class Market extends Target {
  crowd: Crowd;
  private agents: Agent[] = [];
  private rnd = mulberry32(8080);
  private half = { x: 24, z: 16 };
  panic = false;
  /** 0..1 pour la rumeur du marché */
  activity = 1;
  private tmpHit = new Vector3();
  constructor(engine: Engine, private a: MarketAnchors, private terrain: Terrain) {
    super('hostile', 'Cible dans la foule');
    const N = 36;
    const outfits: Outfit[] = [];
    const r = this.rnd;
    for (let i = 0; i < N; i++) {
      if (i === 0) { outfits.push(HOSTILE_OUTFIT); continue; }
      const o: Outfit = {
        jacket: JACKETS[Math.floor(r() * JACKETS.length)], trousers: TROUSERS[Math.floor(r() * TROUSERS.length)], skin: SKIN[Math.floor(r() * SKIN.length)],
        hat: r() < 0.3 ? [0xd8c9a0, 0x6a4a3a, 0x8a8a8a, 0x3a5a7a][Math.floor(r() * 4)] : null, pack: r() < 0.18 ? [0x6a4a3a, 0x3a4a6a, 0x8a7a5a][Math.floor(r() * 3)] : null,
        boots: 0x2a2420, height: 0.9 + r() * 0.16,
      };
      // leurres : chaque indice pris seul ne suffit pas
      if (i === 1 || i === 2) { o.jacket = 0x9c3a2e; o.pack = null; o.hat = i === 1 ? null : 0xd8c9a0; }
      if (i === 3 || i === 4) { o.pack = 0x55602f; o.jacket = i === 3 ? 0x3f5f7f : 0xc9b48a; }
      if (i === 5 || i === 6) { o.hat = 0x141416; o.jacket = i === 5 ? 0x4a4a52 : 0x6b7a4a; }
      if (i === 7) { o.jacket = 0xb8463a; o.pack = 0x6a4a3a; o.hat = null; }
      outfits.push(o);
    }
    this.crowd = new Crowd(engine, outfits);
    this.group.add(this.crowd.group);
    for (let i = 0; i < N; i++) {
      const p = this.freeSpot();
      const ag: Agent = { x: p[0], z: p[1], yaw: r() * 6.28, tx: p[0], tz: p[1], state: 'idle', timer: r() * 5, speed: 0.95 + r() * 0.5, pose: defaultPose(), hostile: i === 0, faceYaw: 0 };
      if (ag.hostile) { ag.pose.limp = 1; ag.speed = 0.92; }
      ag.pose.phase = r() * 6;
      this.agents.push(ag);
    }
  }
  private blocked(x: number, z: number, pad = 0.7): boolean {
    for (const [sx, sz, sr] of this.a.stalls) if (Math.hypot(x - sx, z - sz) < sr + pad) return true;
    return false;
  }
  private freeSpot(): [number, number] {
    for (let k = 0; k < 40; k++) {
      const x = this.a.market.x + (this.rnd() * 2 - 1) * this.half.x, z = this.a.market.z + (this.rnd() * 2 - 1) * this.half.z;
      if (!this.blocked(x, z)) return [x, z];
    }
    return [this.a.market.x, this.a.market.z + 8];
  }
  private hostileAgent(): Agent {
    return this.agents[0];
  }
  aimPoint(out: Vector3): Vector3 {
    const h = this.hostileAgent();
    return out.set(h.x, this.terrain.heightAt(h.x, h.z) + 1.25, h.z);
  }
  predict(dt: number, out: Vector3): Vector3 {
    const h = this.hostileAgent();
    this.aimPoint(out);
    if (h.state === 'walk') {
      const d = Math.hypot(h.tx - h.x, h.tz - h.z);
      const adv = Math.min(d, h.speed * dt);
      if (d > 0.01) { out.x += ((h.tx - h.x) / d) * adv; out.z += ((h.tz - h.z) / d) * adv; }
    }
    return out;
  }
  /** Test du segment contre tous les passants. */
  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    let best: { t: number; part: string } | null = null;
    const d = _d.copy(b).sub(a);
    const len2 = d.lengthSq();
    for (let i = 0; i < this.agents.length; i++) {
      const g = this.agents[i];
      if (g.state === 'gone' || g.state === 'down') continue;
      const hgt = this.crowd.rigs[i].outfit.height;
      const gy = this.terrain.heightAt(g.x, g.z);
      // rejet rapide : distance du point au segment
      _a.set(g.x, gy + 0.9, g.z).sub(a);
      let t = _a.dot(d) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + d.x * t - g.x, py = a.y + d.y * t - gy, pz = a.z + d.z * t - g.z;
      if (px * px + pz * pz > 0.3 * 0.3 || py < 0 || py > 1.8 * hgt) continue;
      // échantillonnage fin le long du segment dans ce voisinage
      for (let k = -6; k <= 6; k++) {
        const tt = t + (k * 0.06) / Math.sqrt(len2);
        if (tt < 0 || tt > 1) continue;
        const x = a.x + d.x * tt - g.x, y = (a.y + d.y * tt - gy) / hgt, z = a.z + d.z * tt - g.z;
        const rr = x * x + z * z;
        const head = rr + (y - 1.62) * (y - 1.62) < 0.13 * 0.13;
        const body = y > 0.05 && y < 1.5 && rr < (y > 0.85 ? 0.21 * 0.21 : 0.15 * 0.15);
        if (head || body) {
          if (!best || tt < best.t) best = { t: tt, part: (g.hostile ? 'hostile' : 'civil') + ':' + i };
          break;
        }
      }
    }
    return best;
  }
  startPanic(): void {
    if (this.panic) return;
    this.panic = true;
    for (const g of this.agents) {
      if (g.state === 'down') continue;
      g.state = 'flee';
      g.timer = 0.2 + this.rnd() * 0.9;
      const a = Math.atan2(g.z - this.a.market.z, g.x - this.a.market.x) + (this.rnd() - 0.5);
      // on fuit vers les ruelles, pas vers le sud découvert
      const ang = Math.sin(a) > 0.5 ? (Math.cos(a) > 0 ? 0.3 : Math.PI - 0.3) : a;
      g.tx = this.a.market.x + Math.cos(ang) * 46;
      g.tz = this.a.market.z + Math.sin(ang) * 34;
      g.speed = 3.2 + this.rnd() * 1.2;
    }
  }
  update(dt: number, ctx: TargetCtx): void {
    const r = this.rnd;
    this.activity = damp(this.activity, this.panic ? 0 : 1, 1.2, dt);
    for (let i = 0; i < this.agents.length; i++) {
      const g = this.agents[i];
      const p = g.pose;
      p.time += dt;
      const rig = this.crowd.rigs[i];
      if (g.state === 'gone') { rig.root.visible = false; continue; }
      if (g.state === 'down') {
        p.fall = Math.min(1, p.fall + dt * 1.3);
        p.move = damp(p.move, 0, 8, dt);
      } else if (g.state === 'walk' || g.state === 'flee') {
        if (g.state === 'flee' && g.timer > 0) { g.timer -= dt; p.move = 0; p.headYaw = Math.sin(p.time * 9) * 0.6; }
        else {
          let dx = g.tx - g.x, dz = g.tz - g.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.35) {
            if (g.state === 'flee') g.state = 'gone';
            else {
              g.state = 'idle';
              g.timer = (g.hostile ? 2.5 : 3) + r() * (g.hostile ? 4 : 9);
              // discussion si un voisin immobile est proche
              const other = this.agents.find((o) => o !== g && !g.hostile && !o.hostile && o.state !== 'walk' && Math.hypot(o.x - g.x, o.z - g.z) < 1.7);
              if (other) {
                g.state = 'talk';
                g.faceYaw = Math.atan2(other.x - g.x, other.z - g.z);
                if (other.state === 'idle') { other.state = 'talk'; other.faceYaw = Math.atan2(g.x - other.x, g.z - other.z); other.timer = Math.max(other.timer, g.timer); }
              } else {
                // se tourne vers l'étal le plus proche
                let bs = 1e9;
                for (const [sx, sz] of this.a.stalls) { const ds = Math.hypot(sx - g.x, sz - g.z); if (ds < bs) { bs = ds; g.faceYaw = Math.atan2(sx - g.x, sz - g.z); } }
              }
            }
          } else {
            dx /= d; dz /= d;
            // contournement des étals et des voisins
            let ax = 0, az = 0;
            for (const [sx, sz, sr] of this.a.stalls) {
              const ox = g.x - sx, oz = g.z - sz, od = Math.hypot(ox, oz);
              if (od < sr + 1.1) { const k = (sr + 1.1 - od) / (sr + 1.1); ax += (ox / od) * k * 2.6 + (-oz / od) * k * 1.2; az += (oz / od) * k * 2.6 + (ox / od) * k * 1.2; }
            }
            if (g.state === 'walk')
              for (const o of this.agents) {
                if (o === g || o.state === 'gone') continue;
                const ox = g.x - o.x, oz = g.z - o.z, od = Math.hypot(ox, oz);
                if (od < 0.8 && od > 0.01) { ax += (ox / od) * 1.2; az += (oz / od) * 1.2; }
              }
            dx += ax; dz += az;
            const l = Math.hypot(dx, dz) || 1;
            g.x += (dx / l) * g.speed * dt;
            g.z += (dz / l) * g.speed * dt;
            g.faceYaw = Math.atan2(dx, dz);
            const run = g.state === 'flee';
            p.move = damp(p.move, run ? 1.8 : g.speed / 1.35, 6, dt);
            p.phase += dt * (run ? 9.5 : 4.2 * g.speed);
            p.talk = damp(p.talk, 0, 6, dt);
            p.headYaw = 0;
          }
        }
      } else {
        g.timer -= dt;
        p.move = damp(p.move, 0, 6, dt);
        p.talk = damp(p.talk, g.state === 'talk' ? 1 : 0, 4, dt);
        p.headYaw = g.state === 'idle' ? Math.sin(p.time * 0.7 + i) * 0.5 : 0;
        if (g.timer <= 0) {
          const s = this.freeSpot();
          g.tx = s[0]; g.tz = s[1];
          g.state = 'walk';
        }
      }
      let dy = g.faceYaw - g.yaw;
      dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.yaw += dy * Math.min(1, dt * 6);
      rig.root.position.set(g.x, this.terrain.heightAt(g.x, g.z), g.z);
      rig.root.rotation.y = g.yaw;
      rig.pose(p);
    }
    this.crowd.sync();
    void ctx;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    const [who, idx] = h.part.split(':');
    const g = this.agents[Number(idx)];
    g.state = 'down';
    ctx.fx.puff(this.tmpHit.copy(h.point), { count: 5, speed: 0.6, life: 0.8, size: [0.05, 0.3], color: 0x8a8070, alpha: 0.35 });
    this.startPanic();
    if (who === 'hostile') { this.done = true; return { kind: 'body', success: true }; }
    return { kind: 'body', civilian: true };
  }
  /** pour les tests : force la cible à s'immobiliser à découvert */
  freezeHostile(x: number, z: number): void {
    const h = this.hostileAgent();
    h.x = h.tx = x; h.z = h.tz = z;
    h.state = 'idle';
    h.timer = 1e9;
  }
}
