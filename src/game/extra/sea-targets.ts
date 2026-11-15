// Cibles de mer, réutilisables par toute carte qui a une nappe d'eau (src/world/sea.ts). Rien ici ne dépend d'une carte.
//
//   Floater        porteur posé sur l'eau : bouée, coque au mouillage, ponton. Il suit la houle (`follow` : part de la
//                  hauteur de houle transmise, 0 = fixé sur un pieu ou un corps-mort raide, 1 = flotte librement) et
//                  penche avec la pente de l'eau (`tilt`). Sans houle (`swell: null`) c'est un simple support fixe.
//   Runner         embarcation qui suit une route en ligne brisée, à vitesse constante, avec un arrêt franc à chaque
//                  point (`wait`, en secondes). Tout est fonction du temps : la position à l'instant t se calcule sans
//                  état, donc `predict` est exact. `start(t)` la lance, `halt(t)` la fige (moteur touché), `reset()`.
//   CarriedTarget  cible portée par un Floater ou un Runner (lanterne de bouée, antenne, projecteur, moteur, boîtier) :
//                  elle se place à chaque image sur son porteur ; `predict(dt)` donne sa position exacte dans dt
//                  secondes, houle, roulis et route compris — le tireur automatique des essais s'en sert.
//   buoyGeometry, hullGeometry, skiffGeometry : géométries simples, un maillage par porteur (couleurs par sommet).
//
// Le porteur n'est pas une cible : ajouter son `group` à un groupe de la scène (le décor de la carte). Ses cibles
// l'appellent d'elles-mêmes (`setTime`) ; une carte qui a un porteur sans cible appelle `setTime(rt.time)` dans `frame`.
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Raycaster, Vector3, type Object3D } from 'three';
import type { ImpactKind } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import type { Engine } from '../../core/engine';
import type { Swell } from '../../world/sea';
import { Target, type HitInfo, type HitResult, type TargetCtx } from '../targets';

const UP = new Vector3(0, 1, 0);
const _slope = { sx: 0, sz: 0 };
const _n = new Vector3(), _q = new Quaternion(), _p = new Vector3();
const _xz = { x: 0, z: 0, heading: 0 };

export interface FloatSpec {
  x: number;
  z: number;
  /** niveau moyen de l'eau (m) : le `level` de la nappe */
  level: number;
  /** houle de la nappe, ou null : support fixe */
  swell: Swell | null;
  /** part de la hauteur de houle transmise au porteur (défaut 1) ; 0 : il ne monte ni ne descend */
  follow?: number;
  /** part de la pente de l'eau transmise en roulis et tangage (défaut 1) */
  tilt?: number;
  /** cap du porteur, radians (rotation autour de y : à 0 son axe x local pointe vers +x) */
  heading?: number;
}

/** Porteur posé sur l'eau. Son repère local : y = 0 à la flottaison, x vers l'avant. */
export class Floater {
  group = new Group();
  x: number;
  z: number;
  heading: number;
  readonly level: number;
  readonly swell: Swell | null;
  follow: number;
  tilt: number;
  /** dernier instant appliqué au groupe */
  time = -1;
  constructor(s: FloatSpec) {
    this.x = s.x;
    this.z = s.z;
    this.level = s.level;
    this.swell = s.swell;
    this.follow = s.follow ?? 1;
    this.tilt = s.tilt ?? 1;
    this.heading = s.heading ?? 0;
    this.setTime(0);
  }
  /** position sur l'eau et cap à l'instant t (un porteur au mouillage ne bouge pas) */
  protected track(_t: number, out: { x: number; z: number; heading: number }): void {
    out.x = this.x;
    out.z = this.z;
    out.heading = this.heading;
  }
  /** position (flottaison) et orientation du porteur à l'instant t */
  poseAt(t: number, pos: Vector3, quat: Quaternion): void {
    this.track(t, _xz);
    let y = this.level;
    quat.setFromAxisAngle(UP, _xz.heading);
    if (this.swell) {
      y += this.follow * this.swell.height(_xz.x, _xz.z, t);
      const f = this.follow * this.tilt;
      if (f > 0) {
        this.swell.slope(_xz.x, _xz.z, t, _slope);
        _n.set(-_slope.sx * f, 1, -_slope.sz * f).normalize();
        quat.premultiply(_q.setFromUnitVectors(UP, _n));
      }
    }
    pos.set(_xz.x, y, _xz.z);
  }
  /** point du repère local du porteur → monde, à l'instant t */
  worldAt(local: Vector3, t: number, out: Vector3): Vector3 {
    const q = new Quaternion();
    this.poseAt(t, _p, q);
    return out.copy(local).applyQuaternion(q).add(_p);
  }
  /** place le groupe à l'instant t (sans effet si c'est déjà fait) */
  setTime(t: number): void {
    if (t === this.time) return;
    this.time = t;
    this.poseAt(t, this.group.position, this.group.quaternion);
    this.group.updateMatrixWorld(true);
  }
}

export interface RoutePoint {
  x: number;
  z: number;
  /** arrêt franc en ce point, secondes (défaut 0) */
  wait?: number;
}

/**
 * Embarcation qui suit une route : arrêt à chaque point (`wait`), puis tronçon droit à `speed` m/s. Elle attend au
 * premier point tant que `start` n'a pas été appelé ; arrivée au dernier point, elle y reste (`arrived`).
 */
export class Runner extends Floater {
  /** segments de la chronologie : arrêt (a = b) ou tronçon */
  private legs: { t0: number; t1: number; ax: number; az: number; bx: number; bz: number; head: number; move: boolean }[] = [];
  private startT: number | null = null;
  private haltT: number | null = null;
  /** durée du virage au départ d'un tronçon, s */
  private turn = 1.6;
  /** durée totale de la route, du départ à l'arrivée au dernier point (s) */
  readonly duration: number;
  constructor(s: Omit<FloatSpec, 'x' | 'z' | 'heading'>, readonly route: RoutePoint[], readonly speed: number) {
    super({ ...s, x: route[0].x, z: route[0].z });
    let t = 0;
    let head = route.length > 1 ? Math.atan2(-(route[1].z - route[0].z), route[1].x - route[0].x) : 0;
    for (let i = 0; i < route.length; i++) {
      const a = route[i];
      const w = a.wait ?? 0;
      if (w > 0) { this.legs.push({ t0: t, t1: t + w, ax: a.x, az: a.z, bx: a.x, bz: a.z, head, move: false }); t += w; }
      const b = route[i + 1];
      if (!b) break;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      head = Math.atan2(-(b.z - a.z), b.x - a.x);
      this.legs.push({ t0: t, t1: t + len / speed, ax: a.x, az: a.z, bx: b.x, bz: b.z, head, move: true });
      t += len / speed;
    }
    this.duration = t;
    this.heading = this.legs[0]?.head ?? 0;
    this.time = -1;
    this.setTime(0);
  }
  /** temps de route écoulé à l'instant t */
  private tau(t: number): number {
    if (this.startT === null) return 0;
    return Math.max(0, Math.min(this.haltT ?? Infinity, t) - this.startT);
  }
  private leg(tau: number): number {
    const L = this.legs;
    for (let i = 0; i < L.length; i++) if (tau < L[i].t1) return i;
    return L.length - 1;
  }
  protected track(t: number, out: { x: number; z: number; heading: number }): void {
    const L = this.legs;
    if (!L || !L.length) { out.x = this.x; out.z = this.z; out.heading = this.heading; return; }
    const tau = this.tau(t), i = this.leg(tau), g = L[i];
    const u = g.t1 > g.t0 ? Math.min(1, Math.max(0, (tau - g.t0) / (g.t1 - g.t0))) : 1;
    out.x = g.ax + (g.bx - g.ax) * u;
    out.z = g.az + (g.bz - g.az) * u;
    out.heading = g.head;
    // virage en début de tronçon : le cap passe de celui du tronçon précédent au nouveau (jamais pendant un arrêt)
    if (g.move && i > 0) {
      const k = Math.min(1, (tau - g.t0) / this.turn);
      if (k < 1) {
        let d = g.head - L[i - 1].head;
        d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        out.heading = g.head - d * (1 - k * k * (3 - 2 * k));
      }
    }
  }
  get started(): boolean {
    return this.startT !== null;
  }
  get halted(): boolean {
    return this.haltT !== null;
  }
  /** lance la route à l'instant t (sans effet si elle est déjà lancée) */
  start(t: number): void {
    if (this.startT === null) this.startT = t;
  }
  /** fige l'embarcation où elle se trouve à l'instant t */
  halt(t: number): void {
    if (this.haltT === null) this.haltT = this.startT === null ? t : Math.max(t, this.startT);
    if (this.startT === null) this.startT = this.haltT;
  }
  /** revient au premier point, à l'arrêt, route non lancée */
  reset(): void {
    this.startT = this.haltT = null;
    this.time = -1;
  }
  /** à l'arrêt à l'instant t (pas encore partie, arrêt de route, figée ou arrivée) */
  stoppedAt(t: number): boolean {
    if (this.startT === null || this.haltT !== null) return true;
    const tau = this.tau(t);
    return tau >= this.duration || !this.legs[this.leg(tau)].move;
  }
  /** secondes d'arrêt qui restent à l'instant t (0 en route ; infini si elle n'est pas partie, figée ou arrivée) */
  waitLeft(t: number): number {
    if (this.startT === null || this.haltT !== null) return Infinity;
    const tau = this.tau(t);
    if (tau >= this.duration) return Infinity;
    const g = this.legs[this.leg(tau)];
    return g.move ? 0 : g.t1 - tau;
  }
  /** secondes avant l'arrivée au dernier point (durée entière si la route n'est pas lancée) */
  timeLeft(t: number): number {
    return Math.max(0, this.duration - this.tau(t));
  }
  arrivedAt(t: number): boolean {
    return this.startT !== null && this.haltT === null && this.tau(t) >= this.duration;
  }
}

export interface CarriedSpec {
  id: string;
  label: string;
  carrier: Floater;
  /** centre de la cible dans le repère du porteur */
  local: Vector3;
  /** boîte (demi-dimensions) ou sphère (rayon) */
  half?: Vector3;
  r?: number;
  /** nature de l'impact (son, gerbe) quand la cible est neutralisée ; `metal` sinon */
  kind: ImpactKind;
  /** énergie minimale à l'impact (J) ; en dessous la cible résiste et `weakNote` s'affiche */
  minEnergy?: number;
  weakNote?: string;
  /** message à la neutralisation */
  note?: string;
  /** partie visible de la cible, centrée sur son origine (ajoutée au groupe de la cible) */
  mesh: Object3D;
  /** ce qui disparaît quand elle est neutralisée (verre, lueur) */
  lit?: Object3D;
  /** appelé une fois, à la neutralisation */
  onDone?: (h: HitInfo, ctx: TargetCtx) => void;
}

/** Cible portée par un Floater : elle le suit à chaque image, et `predict` est exact. */
export class CarriedTarget extends Target {
  private time = 0;
  constructor(private s: CarriedSpec) {
    super(s.id, s.label);
    this.group.add(s.mesh);
    if (s.half) this.addCollider(this.group, 'box', s.id, 0, s.half.clone());
    else this.addCollider(this.group, 'sphere', s.id, s.r ?? 0.2);
    this.place(0);
  }
  private place(t: number): void {
    const c = this.s.carrier;
    c.setTime(t);
    this.group.position.copy(this.s.local).applyQuaternion(c.group.quaternion).add(c.group.position);
    this.group.quaternion.copy(c.group.quaternion);
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.group.position);
  }
  predict(dt: number, out: Vector3): Vector3 {
    return this.s.carrier.worldAt(this.s.local, this.time + dt, out);
  }
  update(_dt: number, ctx: TargetCtx): void {
    this.time = ctx.time;
    this.place(ctx.time);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    if (this.done) return { kind: 'metal' };
    if (h.energy < (this.s.minEnergy ?? 0)) return { kind: 'metal', note: this.s.weakNote ?? 'Touché, sans effet : pas assez d’énergie à cette distance.' };
    this.done = true;
    if (this.s.lit) this.s.lit.visible = false;
    const k = this.s.kind;
    if (k === 'glass') ctx.fx.puff(h.point, { count: 30, speed: 4.5, life: 0.8, size: [0.015, 0.03], color: 0xe8f0ff, alpha: 1, gravity: 9, drag: 0.6, wind: 0, glow: 0.8 });
    else {
      ctx.fx.puff(h.point, { count: 26, speed: 5, life: 0.5, size: [0.02, 0.04], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.5 });
      ctx.fx.puff(h.point, { count: 8, speed: 0.6, up: 0.8, life: 3, size: [0.2, 1.4], color: 0x4a4a4a, alpha: 0.5, wind: 1 });
    }
    this.s.onDone?.(h, ctx);
    return { kind: k, success: true, note: this.s.note };
  }
}

/**
 * Corps d'un porteur (flotteur de bouée, coque) : il arrête la balle et renvoie le télémètre, sans rien valoir.
 * La collision suit le maillage visible. `over` : cibles posées sur le porteur, qui gardent la priorité quand le
 * même segment les traverse (leur zone touchable peut être noyée dans le maillage).
 */
export class CarrierBody extends Target {
  private time = 0;
  private ray = new Raycaster();
  private dir = new Vector3();
  constructor(id: string, label: string, private carrier: Floater, private meshes: Object3D[], readonly over: Target[] = []) {
    super(id, label);
  }
  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    const len = this.dir.copy(b).sub(a).length();
    if (len < 1e-6) return null;
    this.ray.set(a, this.dir.divideScalar(len));
    this.ray.far = len;
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    for (const t of this.over) if (t.active && t.segment(a, b)) return null;
    return { t: hit.distance / len, part: 'body' };
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.carrier.group.position);
  }
  predict(dt: number, out: Vector3): Vector3 {
    return this.carrier.worldAt(out.set(0, 0, 0), this.time + dt, out);
  }
  update(_dt: number, ctx: TargetCtx): void {
    this.time = ctx.time;
  }
  onHit(): HitResult {
    this.hits++;
    return { kind: 'metal' };
  }
}

// ---------------------------------------------------------------------------------------------
// Géométries simples : un maillage par porteur, couleurs par sommet, matière commune.
// ---------------------------------------------------------------------------------------------
const mats = new WeakMap<Engine, MeshStandardMaterial>();
/** Matière peinte commune aux porteurs (couleurs par sommet). */
export function seaPaint(engine: Engine): MeshStandardMaterial {
  let m = mats.get(engine);
  if (!m) {
    m = engine.setupMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.1, vertexColors: true }), undefined, 'seaPaint');
    mats.set(engine, m);
  }
  return m;
}
/** Maillage d'un porteur ou d'une cible, à partir d'un constructeur de géométrie coloré. */
export function paintMesh(engine: Engine, gb: GeoBuilder): Mesh {
  const m = new Mesh(gb.build() as BufferGeometry, seaPaint(engine));
  m.castShadow = true;
  return m;
}
export function painter(): GeoBuilder {
  const gb = new GeoBuilder();
  gb.useColor = true;
  return gb;
}
const lin = (hex: number, k = 1): [number, number, number] => {
  const f = (v: number): number => { const c = v / 255; return (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * k; };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};
/** Couleur courante d'un constructeur (hexadécimal sRVB, gain facultatif). */
export function tint(gb: GeoBuilder, hex: number, k = 1): void {
  gb.color = lin(hex, k);
}

/**
 * Bouée de chenal : flotteur, pylône, voyant. Origine à la flottaison ; le feu se pose à `BUOY_LAMP_Y`.
 * `shape` : 'can' (cylindre, bâbord) ou 'cone' (conique, tribord).
 */
export const BUOY_LAMP_Y = 3.05;
export function buoyGeometry(gb: GeoBuilder, color: number, shape: 'can' | 'cone'): void {
  tint(gb, color, 0.55);
  gb.cyl(0, -0.75, 0, 0.75, 1.05, 0.5, 12, 1, false);
  tint(gb, color);
  gb.cyl(0, -0.25, 0, 1.05, 1.05, 0.7, 12, 1, true);
  // pylône : quatre montants et deux ceintures
  tint(gb, color, 0.8);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = new Vector3(dx * 0.62, 0.45, dz * 0.62), b = new Vector3(dx * 0.2, 2.5, dz * 0.2);
    const d = b.clone().sub(a), len = d.length();
    d.divideScalar(len);
    const sx = new Vector3().crossVectors(d, new Vector3(0, 0, 1)).normalize(), sz = new Vector3().crossVectors(sx, d);
    gb.obox(a.add(b).multiplyScalar(0.5), sx, d, sz, 0.045, len / 2, 0.045);
  }
  gb.box(0, 1.3, 0, 0.9, 0.06, 0.9);
  gb.box(0, 2.5, 0, 0.5, 0.08, 0.5);
  // voyant : cylindre ou cône, sous le feu
  tint(gb, color);
  if (shape === 'can') gb.cyl(0, 1.5, 0, 0.42, 0.42, 0.75, 10, 1, true);
  else gb.cyl(0, 1.5, 0, 0.5, 0.04, 0.85, 10, 1, true);
  // embase du feu
  tint(gb, 0x2b2e31);
  gb.cyl(0, 2.54, 0, 0.14, 0.14, BUOY_LAMP_Y - 0.2 - 2.54, 8, 1, true);
}

/**
 * Coque d'un petit caboteur au mouillage (longueur `L`, largeur `B`) : coque, pavois, château arrière, mât de charge,
 * caisses en pontée. Avant vers +x. Renvoie les points d'accroche utiles (repère local).
 */
export function hullGeometry(gb: GeoBuilder, L: number, B: number, hull: number, deckColor = 0x8a7a62): { deck: number; roof: Vector3; bow: Vector3; mast: Vector3 } {
  const hl = L / 2, hb = B / 2, free = 1.5;
  // coque : caisson et étrave en pointe (prisme à quatre pans)
  tint(gb, 0x6e2a22);
  gb.box(-0.1 * hl, -0.55, 0, L * 0.82, 0.9, B * 0.96);
  tint(gb, hull);
  gb.box(-0.1 * hl, free / 2 - 0.1, 0, L * 0.82, free, B);
  gb.cyl(hl * 0.72 - hb * 0.2, -1.0, 0, hb * 0.9, hb, free + 0.9, 4, 1, true);
  // pont et pavois
  tint(gb, deckColor);
  gb.box(-0.1 * hl, free - 0.08, 0, L * 0.8, 0.06, B - 0.3);
  tint(gb, hull, 0.8);
  for (const s of [-1, 1]) gb.box(-0.1 * hl, free + 0.3, s * (hb - 0.06), L * 0.82, 0.6, 0.1);
  // château arrière et timonerie
  const cx = -hl * 0.62;
  tint(gb, 0xe4e0d6);
  gb.box(cx, free + 1.2, 0, L * 0.2, 2.4, B * 0.8);
  tint(gb, 0xd8d3c6);
  gb.box(cx + 0.3, free + 3.3, 0, L * 0.14, 1.8, B * 0.62);
  tint(gb, 0x1c2228);
  gb.box(cx + 0.3 + L * 0.07, free + 3.5, 0, 0.06, 0.7, B * 0.52);
  for (const s of [-1, 1]) gb.box(cx + 0.3, free + 3.5, s * B * 0.31, L * 0.1, 0.7, 0.06);
  tint(gb, 0x9a3b2c);
  gb.box(cx + 0.3, free + 4.26, 0, L * 0.15, 0.12, B * 0.68);
  // cheminée
  tint(gb, 0x24272a);
  gb.cyl(cx - L * 0.06, free + 2.4, 0, 0.5, 0.42, 2.3, 8, 1, true);
  // mât de charge et sa corne
  const mx = hl * 0.12;
  tint(gb, 0xc9b98f);
  gb.box(mx, free + 3.4, 0, 0.22, 6.8, 0.22);
  gb.obox(new Vector3(mx + 2.2, free + 4.4, 0), new Vector3(0.83, 0.56, 0).normalize(), new Vector3(-0.56, 0.83, 0).normalize(), new Vector3(0, 0, 1), 2.8, 0.09, 0.09);
  // pontée : caisses bâchées, de part et d'autre du mât
  const crates = [0x4f6a5a, 0x8d6a3f, 0x56606a, 0x9a8250, 0x6a4a3a];
  let n = 0;
  for (const [x, w] of [[mx - 3.4, 2.4], [mx - 1.1, 1.6], [mx + 1.6, 2.2], [mx + 4.0, 1.8]]) for (const s of [-1, 1]) {
    tint(gb, crates[n++ % crates.length]);
    gb.box(x, free + 0.65 + (n % 3) * 0.12, s * hb * 0.42, w, 1.3 + (n % 3) * 0.24, hb * 0.7, 1, (n % 2) * 0.04);
  }
  return { deck: free, roof: new Vector3(cx + 0.3, free + 4.32, 0), bow: new Vector3(hl * 0.66, free + 0.6, 0), mast: new Vector3(mx, free + 6.8, 0) };
}

/**
 * Canot à moteur (longueur `L`) : coque ouverte, bancs, caisses, moteur hors-bord. Avant vers +x.
 * Renvoie le centre et les demi-dimensions du capot du moteur (la cible), repère local.
 */
export function skiffGeometry(gb: GeoBuilder, L: number, hull: number): { motor: Vector3; half: Vector3 } {
  const hl = L / 2, B = L * 0.36, hb = B / 2;
  tint(gb, hull, 0.6);
  gb.box(-0.3, -0.12, 0, L * 0.78, 0.3, B * 0.9);
  tint(gb, hull);
  for (const s of [-1, 1]) gb.box(-0.3, 0.3, s * (hb - 0.06), L * 0.78, 0.62, 0.12);
  gb.box(-hl * 0.78 - 0.24, 0.3, 0, 0.12, 0.62, B);
  gb.cyl(hl * 0.5, -0.27, 0, hb * 0.92, hb, 0.88, 4, 1, false);
  tint(gb, 0x3a3d40);
  gb.box(-0.3, 0.04, 0, L * 0.76, 0.05, B - 0.2);
  // bancs et chargement bâché
  tint(gb, 0xb7ac92);
  gb.box(0.9, 0.42, 0, 0.3, 0.06, B - 0.2);
  gb.box(-1.1, 0.42, 0, 0.3, 0.06, B - 0.2);
  tint(gb, 0x4f6a5a);
  gb.box(-0.1, 0.5, 0, 1.3, 0.8, B * 0.62, 1, 0.05);
  tint(gb, 0x8d6a3f);
  gb.box(1.55, 0.36, 0.1, 0.7, 0.5, B * 0.5, 1, -0.08);
  // moteur hors-bord : embase, puis capot (la cible)
  const mx = -hl * 0.78 - 0.55;
  tint(gb, 0x2a2d30);
  gb.box(mx + 0.05, -0.1, 0, 0.2, 0.9, 0.22);
  tint(gb, 0x17191c);
  gb.box(mx, 0.72, 0, 0.62, 0.74, 0.5);
  tint(gb, 0xd8d3c6);
  gb.box(mx, 0.86, 0, 0.64, 0.12, 0.52);
  return { motor: new Vector3(mx, 0.72, 0), half: new Vector3(0.31, 0.37, 0.25) };
}
