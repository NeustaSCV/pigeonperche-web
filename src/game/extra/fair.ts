// Mécaniques de fête foraine, réutilisables par n'importe quelle carte (aucune dépendance à un niveau) :
//  - StepRotation / SteadyRotation : rotation par à-coups (arrêts francs) ou continue, fonction exacte du temps de jeu ;
//  - FairWheel + WheelPlate : grande roue de foire et plaque pendue sous une nacelle ;
//  - FairCarousel + CarouselFigure : manège (à l'arrêt ou tournant) et silhouette d'acier sur son plateau ;
//  - OrderedSeries + FairBulb : globes d'une guirlande à éteindre dans l'ordre ;
//  - StrikerBell : tape-fort, la cloche en haut du mât ;
//  - FairBalloon : ballon accroché, à éclater ;
//  - SeriesTracker : série chronométrée, bonus d'enchaînement et de rapidité.
// Les cibles mobiles lisent le temps de jeu (`TargetCtx.time`) : `predict(dt)` rend la position exacte à t + dt.
import { BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Shape, ShapeGeometry, SphereGeometry, Vector3 } from 'three';
import { GeoBuilder } from '../../core/builder';
import type { Engine } from '../../core/engine';
import { damp } from '../../core/noise';
import { Target, type HitInfo, type HitResult, type TargetCtx } from '../targets';

const std = (engine: Engine, color: number, rough = 0.7, metal = 0, key = 'fair'): MeshStandardMaterial =>
  engine.setupMaterial(new MeshStandardMaterial({ color, roughness: rough, metalness: metal }), undefined, key);
const painted = (engine: Engine, key = 'fairvc'): MeshStandardMaterial =>
  engine.setupMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.1, vertexColors: true }), undefined, key);
const tint = (b: GeoBuilder, hex: number, k = 1): void => {
  const c = new Color(hex);
  b.color = [c.r * k, c.g * k, c.b * k];
};
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const UX = v3(1, 0, 0), UY = v3(0, 1, 0), UZ = v3(0, 0, 1);

// ---------------------------------------------------------------- rotations
/** Loi de rotation d'une attraction : angle (rad) au temps de jeu t, et secondes d'arrêt qui restent à cet instant. */
export interface Rotation {
  angle(t: number): number;
  /** 0 pendant le mouvement ; Infinity pour une attraction arrêtée pour de bon */
  holdLeft(t: number): number;
}

/**
 * Rotation par à-coups : `stops` arrêts par tour ; à chaque cycle, `hold` secondes d'arrêt franc puis `move` secondes
 * pour gagner l'arrêt suivant (départ et arrivée adoucis). `dir` : sens (+1 ou −1) ; `offset` : avance du cycle, s.
 */
export class StepRotation implements Rotation {
  readonly step: number;
  readonly period: number;
  constructor(readonly stops: number, readonly move: number, readonly hold: number, readonly offset = 0, readonly dir = 1) {
    this.step = (Math.PI * 2) / stops;
    this.period = move + hold;
  }
  private phase(t: number): [number, number] {
    const u = (t + this.offset) / this.period;
    const n = Math.floor(u);
    return [n, (u - n) * this.period];
  }
  angle(t: number): number {
    const [n, f] = this.phase(t);
    if (f <= this.hold) return this.dir * n * this.step;
    const s = Math.min(1, (f - this.hold) / this.move);
    return this.dir * (n + s * s * (3 - 2 * s)) * this.step;
  }
  holdLeft(t: number): number {
    const f = this.phase(t)[1];
    return f < this.hold ? this.hold - f : 0;
  }
}

/** Rotation continue à vitesse constante (rad/s) ; 0 : à l'arrêt. */
export class SteadyRotation implements Rotation {
  constructor(readonly speed: number, readonly start = 0) {}
  angle(t: number): number {
    return this.start + this.speed * t;
  }
  holdLeft(): number {
    return this.speed === 0 ? Infinity : 0;
  }
}

// ---------------------------------------------------------------- grande roue
export interface WheelOpts {
  /** pied de la roue (sol), dans le monde */
  base: Vector3;
  /** hauteur du moyeu au-dessus du pied, rayon de la jante (m) */
  hub: number;
  radius: number;
  /** nombre de nacelles */
  cabins: number;
  /** lacet (rad) : à 0 la roue fait face à +z */
  yaw: number;
  rotation: Rotation;
  /** couleurs des nacelles, à tour de rôle */
  colors?: number[];
}

/**
 * Grande roue de foire : deux jantes, rayons, moyeu sur deux chevalets, nacelles qui restent d'aplomb.
 * `group` est à ajouter à la scène (parent sans transformation) ; `setTime(t)` la fait tourner.
 */
export class FairWheel {
  group = new Group();
  readonly o: WheelOpts;
  private rotor = new Object3D();
  private cabs: Mesh[] = [];
  private m = new Matrix4();
  private t = -1;
  constructor(engine: Engine, o: WheelOpts) {
    this.o = o;
    const { hub, radius: R, cabins: n } = o;
    this.group.position.copy(o.base);
    this.group.rotation.y = o.yaw;
    this.group.updateMatrix();
    this.m.copy(this.group.matrix);
    const mat = painted(engine);
    // --- chevalets et socle (fixes) ---
    const sb = new GeoBuilder();
    sb.useColor = true;
    tint(sb, 0xe8e2d2);
    for (const s of [-1, 1]) {
      const z = s * 1.25;
      for (const q of [-1, 1]) {
        const foot = v3(q * R * 0.42, 0, z), top = v3(0, hub, z * 0.72);
        const ay = top.clone().sub(foot);
        const len = ay.length();
        ay.normalize();
        const ax = new Vector3().crossVectors(ay, UZ).normalize();
        sb.obox(foot.clone().add(top).multiplyScalar(0.5), ax, ay, new Vector3().crossVectors(ax, ay), 0.16, len / 2, 0.16, 1.5);
      }
      // entretoise
      sb.box(0, hub * 0.42, z * 0.88, R * 0.5, 0.14, 0.14, 1.5);
    }
    tint(sb, 0x8c2f28);
    sb.box(0, 0.18, 0, R * 1.1, 0.36, 3.6, 2);
    sb.cyl(0, hub - 0.35, 0, 0.5, 0.5, 0.7, 12, 1, true);
    const stand = new Mesh(sb.build(), mat);
    stand.castShadow = stand.receiveShadow = true;
    this.group.add(stand);
    // --- rotor : jantes, rayons, moyeu ---
    const rb = new GeoBuilder();
    rb.useColor = true;
    const seg = 32;
    for (const z of [-0.62, 0.62]) {
      for (let i = 0; i < seg; i++) {
        const a = ((i + 0.5) / seg) * Math.PI * 2;
        tint(rb, i % 2 ? 0xc8412f : 0xf0e9d8);
        const c = v3(Math.sin(a) * R, Math.cos(a) * R, z);
        const tan = v3(Math.cos(a), -Math.sin(a), 0), rad = v3(Math.sin(a), Math.cos(a), 0);
        rb.obox(c, tan, rad, UZ, R * Math.tan(Math.PI / seg) + 0.02, 0.09, 0.07, 1.5);
      }
      tint(rb, 0xf0e9d8);
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rad = v3(Math.sin(a), Math.cos(a), 0), tan = v3(Math.cos(a), -Math.sin(a), 0);
        rb.obox(rad.clone().multiplyScalar(R / 2).setZ(z), tan, rad, UZ, 0.035, R / 2, 0.035, 1.5);
      }
    }
    // traverses entre les deux jantes, là où pendent les nacelles
    tint(rb, 0x3a3d40);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      rb.obox(v3(Math.sin(a) * R, Math.cos(a) * R, 0), UX, UY, UZ, 0.05, 0.05, 0.7, 1.5);
    }
    tint(rb, 0xd6a12c);
    rb.obox(v3(0, 0, 0), UX, UY, UZ, 0.55, 0.55, 0.8, 1.5);
    const rotor = new Mesh(rb.build(), mat);
    rotor.castShadow = true;
    this.rotor.position.set(0, hub, 0);
    this.rotor.add(rotor);
    this.group.add(this.rotor);
    // --- nacelles : une géométrie par couleur ---
    const colors = o.colors ?? [0xc8412f, 0x2f6f9a, 0xd6a12c, 0x3f8f6a];
    const geos = colors.map((col) => {
      const cb = new GeoBuilder();
      cb.useColor = true;
      tint(cb, 0x3a3d40);
      for (const sx of [-0.62, 0.62]) cb.box(sx, -0.7, 0, 0.05, 1.4, 0.05, 1.5);
      tint(cb, col);
      cb.box(0, -1.45, 0, 1.45, 0.6, 1.0, 1.5);
      tint(cb, 0xf0e9d8);
      cb.box(0, -1.12, 0, 1.5, 0.07, 1.05, 1.5);
      // toit en parasol
      tint(cb, col);
      cb.cyl(0, -0.42, 0, 0.95, 0.12, 0.34, 8, 1.5, true);
      return cb.build();
    });
    for (let i = 0; i < n; i++) {
      const c = new Mesh(geos[i % geos.length], mat);
      c.castShadow = true;
      this.cabs.push(c);
      this.group.add(c);
    }
    this.setTime(0);
  }
  /** Angle (rad, sens horaire vu de face) de la nacelle i au temps t ; 0 = en haut. */
  cabinAngle(i: number, t: number): number {
    return (i / this.o.cabins) * Math.PI * 2 + this.o.rotation.angle(t);
  }
  /** Axe d'accroche de la nacelle i au temps t, dans le monde. `dy`, `dz` : décalage sous l'axe et vers l'avant de la roue. */
  cabinPos(i: number, t: number, out: Vector3, dy = 0, dz = 0): Vector3 {
    const a = this.cabinAngle(i, t), R = this.o.radius;
    return out.set(Math.sin(a) * R, this.o.hub + Math.cos(a) * R + dy, dz).applyMatrix4(this.m);
  }
  /** La roue est-elle à l'arrêt pour encore `min` secondes au moins ? */
  holding(t: number, min = 0): boolean {
    return this.o.rotation.holdLeft(t) > min;
  }
  setTime(t: number): void {
    if (t === this.t) return;
    this.t = t;
    this.rotor.rotation.z = -this.o.rotation.angle(t);
    const R = this.o.radius;
    for (let i = 0; i < this.cabs.length; i++) {
      const a = this.cabinAngle(i, t);
      this.cabs[i].position.set(Math.sin(a) * R, this.o.hub + Math.cos(a) * R, 0);
    }
  }
}

/** Plaque d'acier ronde pendue sous une nacelle de la roue, face à l'avant de la roue. Touchée, elle se relève à plat. */
export class WheelPlate extends Target {
  private flap = new Object3D();
  private aim = new Object3D();
  private fall = 0;
  private t = 0;
  /** axe de la charnière sous l'axe de la nacelle, et avancée vers le tireur (m) */
  private readonly dy = -1.82;
  private readonly dz = 0.56;
  constructor(engine: Engine, id: string, label: string, readonly wheel: FairWheel, readonly cabin: number, readonly size = 0.5) {
    super(id, label);
    this.group.rotation.y = wheel.o.yaw;
    const dark = std(engine, 0x2c2e30, 0.6, 0.6);
    const bar = new Mesh(new BoxGeometry(size + 0.16, 0.04, 0.04), dark);
    bar.castShadow = true;
    this.group.add(bar);
    this.group.add(this.flap);
    const r = size / 2;
    const disc = new Mesh(new CylinderGeometry(r, r, 0.014, 24), std(engine, 0xecebe6, 0.55, 0.25, 'fairplate'));
    disc.rotation.x = Math.PI / 2;
    disc.position.y = -0.06 - r;
    disc.castShadow = true;
    this.flap.add(disc);
    const dot = new Mesh(new CircleGeometry(r * 0.42, 18), new MeshBasicMaterial({ color: 0xd9541e }));
    dot.position.set(0, -0.06 - r, 0.009);
    this.flap.add(dot);
    this.aim.position.set(0, -0.06 - r, 0);
    this.flap.add(this.aim);
    this.addCollider(this.aim, 'sphere', 'plate', r);
    this.place(0);
  }
  private place(t: number): void {
    this.t = t;
    this.wheel.setTime(t);
    this.wheel.cabinPos(this.cabin, t, this.group.position, this.dy, this.dz);
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.aim.getWorldPosition(out);
  }
  predict(dt: number, out: Vector3): Vector3 {
    if (this.done) return this.aimPoint(out);
    return this.wheel.cabinPos(this.cabin, this.t + dt, out, this.dy - 0.06 - this.size / 2, this.dz);
  }
  update(dt: number, ctx: TargetCtx): void {
    if (this.done) this.fall = damp(this.fall, 1, 6, dt);
    this.flap.rotation.x = -1.5 * this.fall;
    this.place(ctx.time);
  }
  onHit(h: HitInfo): HitResult {
    this.hits++;
    const local = this.flap.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.014, 8), new MeshBasicMaterial({ color: 0x24262a }));
    mark.position.set(local.x, local.y, 0.0095);
    this.flap.add(mark);
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first };
  }
}

// ---------------------------------------------------------------- manège
export interface CarouselOpts {
  /** centre du plateau (sol), dans le monde */
  base: Vector3;
  /** rayon du cercle des silhouettes (m) */
  radius: number;
  /** lacet (rad) : à 0 l'avant du manège regarde +z */
  yaw: number;
  /** loi de rotation ; absente : manège à l'arrêt */
  rotation?: Rotation;
  /** hauteur du plateau (m) */
  deck?: number;
}

/**
 * Manège de cibles : plateau, fût central rayé, chapiteau et fanions. Les silhouettes (CarouselFigure) se placent sur
 * le bord du plateau par leur azimut (0 = à l'avant). Sans `rotation`, le manège est à l'arrêt.
 */
export class FairCarousel {
  group = new Group();
  readonly o: CarouselOpts;
  readonly deck: number;
  private rotor = new Object3D();
  private m = new Matrix4();
  private t = -1;
  constructor(engine: Engine, o: CarouselOpts) {
    this.o = o;
    this.deck = o.deck ?? 0.5;
    const R = o.radius;
    this.group.position.copy(o.base);
    this.group.rotation.y = o.yaw;
    this.group.updateMatrix();
    this.m.copy(this.group.matrix);
    const b = new GeoBuilder();
    b.useColor = true;
    // socle fixe
    tint(b, 0x8c2f28);
    b.cyl(0, 0, 0, R + 0.95, R + 0.95, this.deck - 0.12, 28, 2, true);
    const base = new Mesh(b.build(), painted(engine));
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);
    // plateau tournant, fût, chapiteau
    const r = new GeoBuilder();
    r.useColor = true;
    tint(r, 0xe8dcc0);
    r.cyl(0, this.deck - 0.12, 0, R + 0.7, R + 0.7, 0.12, 28, 2, true);
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      const a = ((i + 0.5) / stripes) * Math.PI * 2;
      tint(r, i % 2 ? 0xc8412f : 0xf0e9d8);
      r.obox(v3(Math.sin(a) * 0.82, this.deck + 1.7, Math.cos(a) * 0.82), v3(Math.cos(a), 0, -Math.sin(a)), UY, v3(Math.sin(a), 0, Math.cos(a)), 0.23, 1.7, 0.06, 1.5);
    }
    tint(r, 0x2f6f9a);
    r.cyl(0, this.deck + 3.4, 0, 2.5, 0.16, 1.15, 12, 1.5, true);
    tint(r, 0xd6a12c);
    r.cyl(0, this.deck + 3.3, 0, 2.55, 2.55, 0.12, 12, 1.5, true);
    r.cyl(0, this.deck + 4.5, 0, 0.05, 0.05, 1.2, 6, 1, true);
    r.box(0.3, this.deck + 5.5, 0, 0.6, 0.32, 0.02, 1);
    const rot = new Mesh(r.build(), painted(engine));
    rot.castShadow = rot.receiveShadow = true;
    this.rotor.add(rot);
    this.group.add(this.rotor);
    this.setTime(0);
  }
  /** Azimut (rad, autour de la verticale, 0 = à l'avant du manège) d'une place d'azimut de départ `az`, au temps t. */
  slotAngle(az: number, t: number): number {
    return az + (this.o.rotation ? this.o.rotation.angle(t) : 0);
  }
  /** Point du bord du plateau (dessus du plancher) à l'azimut de départ `az`, au temps t, dans le monde. */
  slotPos(az: number, t: number, out: Vector3, dy = 0): Vector3 {
    const a = this.slotAngle(az, t), R = this.o.radius;
    return out.set(Math.sin(a) * R, this.deck + dy, Math.cos(a) * R).applyMatrix4(this.m);
  }
  /** À l'arrêt pour encore `min` secondes au moins (toujours vrai pour un manège sans rotation). */
  holding(t: number, min = 0): boolean {
    return !this.o.rotation || this.o.rotation.holdLeft(t) > min;
  }
  setTime(t: number): void {
    if (t === this.t) return;
    this.t = t;
    this.rotor.rotation.y = this.o.rotation ? this.o.rotation.angle(t) : 0;
  }
}

export type FigureShape = 'duck' | 'star' | 'disc';

function figureShape(kind: FigureShape): Shape {
  const s = new Shape();
  if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.14 : 0.33;
      if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r);
      else s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    s.closePath();
  } else if (kind === 'duck') {
    // canard de stand de tir, de profil, le bec à droite
    const pts: [number, number][] = [[-0.34, 0.02], [-0.3, -0.12], [-0.16, -0.2], [0.1, -0.2], [0.24, -0.12], [0.28, 0.0], [0.22, 0.1], [0.2, 0.2], [0.3, 0.2], [0.38, 0.24], [0.3, 0.28], [0.24, 0.34], [0.14, 0.36], [0.05, 0.3], [0.04, 0.16], [-0.06, 0.08], [-0.22, 0.08], [-0.32, 0.14]];
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
  } else s.absarc(0, 0, 0.28, 0, Math.PI * 2, false);
  return s;
}

/**
 * Silhouette d'acier d'un manège de cibles (canard, étoile ou cible ronde) au bout d'une tige, sur le bord du plateau.
 * Elle regarde vers l'extérieur du manège. Touchée, elle bascule en arrière. `az` : azimut de sa place (rad, 0 = à
 * l'avant) ; `scale` : 1 = environ 60 cm.
 */
export class CarouselFigure extends Target {
  private flap = new Object3D();
  private aim = new Object3D();
  private fall = 0;
  private t = 0;
  private readonly stem = 1.05;
  constructor(engine: Engine, id: string, label: string, readonly carousel: FairCarousel, readonly az: number, readonly shape: FigureShape, readonly scale = 1) {
    super(id, label);
    const dark = std(engine, 0x2c2e30, 0.6, 0.6);
    const rod = new Mesh(new BoxGeometry(0.05, this.stem, 0.05), dark);
    rod.position.y = this.stem / 2;
    rod.castShadow = true;
    this.group.add(rod);
    this.flap.position.y = this.stem;
    this.group.add(this.flap);
    const colors: Record<FigureShape, number> = { duck: 0xf2c230, star: 0xecebe6, disc: 0xecebe6 };
    const geo = new ShapeGeometry(figureShape(shape), 10);
    const mat = engine.setupMaterial(new MeshStandardMaterial({ color: colors[shape], roughness: 0.55, metalness: 0.2, side: DoubleSide }), undefined, 'fairfig');
    const body = new Mesh(geo, mat);
    const cy = shape === 'duck' ? 0.22 : shape === 'star' ? 0.34 : 0.3;
    body.position.y = cy * scale;
    body.scale.setScalar(scale);
    body.castShadow = true;
    this.flap.add(body);
    // repères peints : pastille de visée, cercles de la cible ronde, œil du canard
    const paint = (r: number, color: number, x: number, y: number, z: number): void => {
      const m = new Mesh(new CircleGeometry(r * scale, 20), new MeshBasicMaterial({ color }));
      m.position.set(x * scale, (cy + y) * scale, z);
      this.flap.add(m);
    };
    if (shape === 'disc') { paint(0.2, 0xc8412f, 0, 0, 0.004); paint(0.12, 0xecebe6, 0, 0, 0.006); paint(0.06, 0xc8412f, 0, 0, 0.008); }
    else if (shape === 'star') paint(0.1, 0xd9541e, 0, 0, 0.005);
    else { paint(0.09, 0xd9541e, -0.03, -0.06, 0.005); paint(0.025, 0x1c1c1c, 0.17, 0.27, 0.005); }
    const ax = shape === 'duck' ? -0.03 : 0, ay = shape === 'duck' ? -0.06 : 0;
    this.aim.position.set(ax * scale, (cy + ay) * scale, 0);
    this.flap.add(this.aim);
    if (shape === 'duck') {
      this.addCollider(this.aim, 'box', 'plate', 0, new Vector3(0.3 * scale, 0.15 * scale, 0.03));
      const head = new Object3D();
      head.position.set(0.16 * scale, (cy + 0.24) * scale, 0);
      this.flap.add(head);
      this.addCollider(head, 'sphere', 'head', 0.11 * scale);
    } else this.addCollider(this.aim, 'sphere', 'plate', (shape === 'star' ? 0.2 : 0.28) * scale);
    this.place(0);
  }
  private place(t: number): void {
    this.t = t;
    this.carousel.setTime(t);
    this.carousel.slotPos(this.az, t, this.group.position);
    this.group.rotation.y = this.carousel.o.yaw + this.carousel.slotAngle(this.az, t);
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.aim.getWorldPosition(out);
  }
  predict(dt: number, out: Vector3): Vector3 {
    if (this.done || !this.carousel.o.rotation) return this.aimPoint(out);
    // point visé dans le repère de la silhouette, reporté à la place qu'elle occupera
    const a = this.carousel.o.yaw + this.carousel.slotAngle(this.az, this.t + dt);
    const lx = this.aim.position.x, ly = this.stem + this.aim.position.y;
    this.carousel.slotPos(this.az, this.t + dt, out, ly);
    out.x += Math.cos(a) * lx;
    out.z -= Math.sin(a) * lx;
    return out;
  }
  /** Le manège est-il à l'arrêt pour encore `min` secondes ? */
  holding(min = 0): boolean {
    return this.carousel.holding(this.t, min);
  }
  update(dt: number, ctx: TargetCtx): void {
    if (this.done) this.fall = damp(this.fall, 1, 5, dt);
    this.flap.rotation.x = -1.5 * this.fall;
    if (this.carousel.o.rotation || this.t === 0) this.place(ctx.time);
  }
  onHit(h: HitInfo): HitResult {
    this.hits++;
    const local = this.flap.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.014, 8), new MeshBasicMaterial({ color: 0x24262a }));
    mark.position.set(local.x, local.y, 0.0105);
    this.flap.add(mark);
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first };
  }
}

// ---------------------------------------------------------------- série ordonnée, guirlande
/** Ordre imposé entre des cibles : seule la suivante de la liste peut être neutralisée. */
export class OrderedSeries {
  index = 0;
  constructor(readonly ids: string[]) {}
  /** identifiant de la cible attendue, ou null quand la série est finie */
  next(): string | null {
    return this.ids[this.index] ?? null;
  }
  /** La cible `id` est-elle la bonne ? Si oui, la série avance. */
  accept(id: string): boolean {
    if (this.ids[this.index] !== id) return false;
    this.index++;
    return true;
  }
  reset(): void {
    this.index = 0;
  }
}

/**
 * Globe allumé d'une guirlande. Il ne s'éteint que si c'est son tour dans la série (`OrderedSeries`) : la bonne
 * ampoule clignote ; une autre, touchée, vacille et reste allumée (rien n'est perdu).
 */
export class FairBulb extends Target {
  private globe: Mesh;
  private lit: MeshBasicMaterial;
  private flicker = 0;
  private readonly base = new Color();
  constructor(engine: Engine, id: string, label: string, pos: Vector3, readonly series: OrderedSeries, readonly radius = 0.22, color = 0xffc46a) {
    super(id, label);
    this.group.position.copy(pos);
    const cap = new Mesh(new CylinderGeometry(radius * 0.42, radius * 0.5, radius * 0.6, 10), std(engine, 0x2c2e30, 0.6, 0.6));
    cap.position.y = radius * 1.15;
    this.group.add(cap);
    this.base.set(color);
    this.lit = new MeshBasicMaterial({ color: this.base.clone().multiplyScalar(3) });
    this.globe = new Mesh(new SphereGeometry(radius, 16, 12), this.lit);
    this.group.add(this.globe);
    this.addCollider(this.globe, 'sphere', 'bulb', radius);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.globe.getWorldPosition(out);
  }
  update(dt: number, ctx: TargetCtx): void {
    if (this.done) return;
    this.flicker = Math.max(0, this.flicker - dt);
    let k = 2.6;
    // la suivante de la série bat lentement ; une ampoule touchée hors de son tour vacille
    if (this.series.next() === this.id) k = 3.4 + 2.6 * (0.5 + 0.5 * Math.sin(ctx.time * 5.2));
    if (this.flicker > 0) k *= 0.25 + 0.75 * Math.abs(Math.sin(ctx.time * 38));
    this.lit.color.copy(this.base).multiplyScalar(k);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    if (!this.series.accept(this.id)) {
      this.flicker = 0.9;
      return { kind: 'glass', note: 'Pas celle-ci : la guirlande s’éteint dans l’ordre. La bonne ampoule clignote.' };
    }
    this.done = true;
    this.active = false;
    this.globe.visible = false;
    ctx.fx.puff(h.point, { count: 30, speed: 4, life: 0.7, size: [0.012, 0.03], color: 0xfff0d0, alpha: 1, gravity: 9, drag: 0.8, wind: 0, glow: 0.9 });
    return { kind: 'glass', success: true };
  }
}

// ---------------------------------------------------------------- tape-fort
/**
 * Tape-fort : mât gradué, et tout en haut la cloche qu'on fait d'ordinaire sonner d'un coup de maillet. Ici une
 * balle suffit, pourvu qu'elle arrive avec `minEnergy` joules ; le curseur saute alors jusqu'à la cloche.
 * `base` : pied du mât ; il fait face au site de tir (origine) si `yaw` n'est pas donné.
 */
export class StrikerBell extends Target {
  private swing = new Object3D();
  private body = new Object3D();
  private puck: Mesh;
  private angle = 0;
  private av = 0;
  private puckY = 0.9;
  private puckV = 0;
  constructor(engine: Engine, id: string, label: string, base: Vector3, readonly height = 8, readonly minEnergy = 250, yaw?: number) {
    super(id, label);
    this.group.position.copy(base);
    this.group.rotation.y = yaw ?? Math.atan2(-base.x, -base.z);
    const H = height;
    const b = new GeoBuilder();
    b.useColor = true;
    // socle, enclume, mât à bandes de couleur
    tint(b, 0x8c2f28);
    b.box(0, 0.25, 0, 1.9, 0.5, 1.5, 1.5);
    tint(b, 0x3a3d40);
    b.box(0, 0.62, 0.35, 0.5, 0.24, 0.5, 1.5);
    const bands = Math.round(H / 0.8);
    for (let i = 0; i < bands; i++) {
      tint(b, [0xf0e9d8, 0xd6a12c, 0xf0e9d8, 0xc8412f][i % 4]);
      b.box(0, 0.5 + ((i + 0.5) * (H - 0.9)) / bands, 0, 0.62, (H - 0.9) / bands, 0.1, 1.5);
    }
    tint(b, 0x2f6f9a);
    for (const s of [-1, 1]) b.box(s * 0.38, H / 2 + 0.2, 0, 0.1, H + 0.4, 0.14, 1.5);
    // fronton
    tint(b, 0xc8412f);
    b.box(0, H + 0.62, -0.02, 1.5, 0.12, 0.3, 1.5);
    const mast = new Mesh(b.build(), painted(engine));
    mast.castShadow = mast.receiveShadow = true;
    this.group.add(mast);
    // curseur
    this.puck = new Mesh(new BoxGeometry(0.34, 0.16, 0.1), std(engine, 0x2c2e30, 0.5, 0.7));
    this.puck.position.set(0, this.puckY, 0.11);
    this.group.add(this.puck);
    // cloche
    this.swing.position.set(0, H + 0.5, 0.12);
    this.group.add(this.swing);
    const bronze = std(engine, 0xc9973f, 0.34, 0.85, 'fairbell');
    const crown = new Mesh(new CylinderGeometry(0.1, 0.16, 0.14, 16), bronze);
    crown.position.y = -0.1;
    this.swing.add(crown);
    const waist = new Mesh(new CylinderGeometry(0.16, 0.3, 0.34, 18, 1, true), bronze);
    waist.position.y = -0.34;
    waist.castShadow = true;
    this.swing.add(waist);
    const lip = new Mesh(new CylinderGeometry(0.3, 0.37, 0.12, 18, 1, true), bronze);
    lip.position.y = -0.57;
    this.swing.add(lip);
    this.body.position.set(0, -0.36, 0);
    this.swing.add(this.body);
    this.addCollider(this.body, 'box', 'bell', 0, new Vector3(0.34, 0.3, 0.3));
  }
  aimPoint(out: Vector3): Vector3 {
    return this.body.getWorldPosition(out);
  }
  update(dt: number): void {
    this.av += (-11 * this.angle - 0.6 * this.av) * dt;
    this.angle += this.av * dt;
    this.swing.rotation.z = this.angle;
    // le curseur monte d'un trait, puis retombe
    if (this.puckV !== 0 || this.puckY > 0.9) {
      this.puckV -= 9.81 * dt;
      this.puckY += this.puckV * dt;
      const top = this.height - 0.25;
      if (this.puckY > top) { this.puckY = top; this.puckV = -0.5; }
      if (this.puckY <= 0.9) { this.puckY = 0.9; this.puckV = 0; }
      this.puck.position.y = this.puckY;
    }
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    if (h.energy < this.minEnergy) {
      this.av -= 0.3;
      return { kind: 'bell', note: `La cloche a tinté sans sonner : il faut au moins ${this.minEnergy} J à l’impact.` };
    }
    this.av -= Math.min(2.8, 1 + h.energy / 1200);
    this.puckV = Math.sqrt(2 * 9.81 * this.height) * 1.1;
    ctx.fx.puff(h.point, { count: 10, speed: 2.5, life: 0.4, size: [0.012, 0.025], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.0 });
    const first = !this.done;
    this.done = true;
    return { kind: 'bell', success: first };
  }
}

// ---------------------------------------------------------------- ballon
/**
 * Ballon de baudruche au bout d'une ficelle, accroché en `anchor`. Il ne se déplace pas : la ficelle se balance de
 * quelques centimètres. Il éclate au premier impact.
 */
export class FairBalloon extends Target {
  private ball: Mesh;
  private string: Mesh;
  private color: number;
  private readonly phase: number;
  private t = 0;
  constructor(engine: Engine, id: string, label: string, readonly anchor: Vector3, color = 0xd8362c, readonly length = 1.2, readonly radius = 0.24) {
    super(id, label);
    this.color = color;
    this.phase = (anchor.x * 1.7 + anchor.z * 0.9) % 6.28;
    this.ball = new Mesh(new SphereGeometry(radius, 18, 14), std(engine, color, 0.3, 0, 'fairballoon' + color.toString(16)));
    this.ball.scale.set(1, 1.18, 1);
    this.ball.castShadow = true;
    this.group.add(this.ball);
    this.string = new Mesh(new CylinderGeometry(0.005, 0.005, 1, 4), new MeshBasicMaterial({ color: 0xe8e8e8 }));
    this.group.add(this.string);
    this.addCollider(this.ball, 'sphere', 'balloon', radius * 1.08);
    this.place(0);
  }
  private at(t: number, out: Vector3): Vector3 {
    const s = Math.sin(t * 1.1 + this.phase) * 0.035;
    return out.set(this.anchor.x + s, this.anchor.y + this.length + this.radius, this.anchor.z + s * 0.4);
  }
  private place(t: number): void {
    this.t = t;
    this.at(t, this.ball.position);
    this.string.position.copy(this.anchor).add(this.ball.position).multiplyScalar(0.5);
    this.string.scale.set(1, this.length + this.radius, 1);
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.ball.position);
  }
  predict(dt: number, out: Vector3): Vector3 {
    return this.done ? this.aimPoint(out) : this.at(this.t + dt, out);
  }
  update(_dt: number, ctx: TargetCtx): void {
    if (!this.done) this.place(ctx.time);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    this.done = true;
    this.active = false;
    this.ball.visible = false;
    this.string.visible = false;
    ctx.fx.puff(h.point, { count: 26, speed: 4, life: 0.7, size: [0.03, 0.07], color: this.color, alpha: 0.95, gravity: 6, drag: 2.5, wind: 0.3 });
    return { kind: 'balloon', success: true };
  }
}

// ---------------------------------------------------------------- séries chronométrées
/** Règle d'une série : nombre de cibles, enchaînement, rapidité. */
export interface SeriesRule {
  /** nombre de cibles de la série */
  total: number;
  /** deux touches à moins de `chainWindow` secondes l'une de l'autre s'enchaînent */
  chainWindow: number;
  /** bonus d'une touche enchaînée : `chainPoints` × rang dans l'enchaînement (rang 2 pour la deuxième touche) */
  chainPoints: number;
  /** bonus de rapidité : `speedPoints` pour une série instantanée, 0 à partir de `par` secondes (linéaire) */
  par: number;
  speedPoints: number;
}
export interface SeriesHit {
  /** rang dans l'enchaînement en cours (1 : touche isolée) et points d'enchaînement de cette touche */
  rank: number;
  chain: number;
  done: number;
  total: number;
  /** la série vient de se terminer : durée du premier tir à la dernière touche, et bonus de rapidité */
  finished: boolean;
  seconds: number;
  speed: number;
}

/**
 * Suivi d'une série chronométrée. Le chronomètre part au premier tir (`shot`) ; chaque touche (`hit`) rend son rang
 * d'enchaînement et ses points ; la dernière rend le bonus de rapidité. Le temps ne retire jamais rien.
 * La carte accorde les points (`Mission.addBonus`) et les annonce.
 */
export class SeriesTracker {
  rule: SeriesRule | null = null;
  done = 0;
  rank = 0;
  private t0 = -1;
  private last = -1;
  private end = -1;
  begin(rule: SeriesRule): void {
    this.rule = rule;
    this.done = 0;
    this.rank = 0;
    this.t0 = this.last = this.end = -1;
  }
  get started(): boolean {
    return this.t0 >= 0;
  }
  get finished(): boolean {
    return this.end >= 0;
  }
  /** un coup part : lance le chronomètre s'il ne tourne pas */
  shot(time: number): void {
    if (this.rule && this.t0 < 0) this.t0 = time;
  }
  /** secondes écoulées depuis le premier tir (figées à la fin de la série) */
  elapsed(time: number): number {
    return this.t0 < 0 ? 0 : (this.end >= 0 ? this.end : time) - this.t0;
  }
  /** secondes qui restent pour enchaîner sur la dernière touche (0 : enchaînement perdu ou pas commencé) */
  chainLeft(time: number): number {
    return this.rule && this.last >= 0 && this.end < 0 ? Math.max(0, this.rule.chainWindow - (time - this.last)) : 0;
  }
  hit(time: number): SeriesHit | null {
    const r = this.rule;
    if (!r || this.end >= 0) return null;
    if (this.t0 < 0) this.t0 = time;
    this.rank = this.last >= 0 && time - this.last <= r.chainWindow ? this.rank + 1 : 1;
    this.last = time;
    this.done++;
    const chain = this.rank >= 2 ? r.chainPoints * this.rank : 0;
    const finished = this.done >= r.total;
    let seconds = 0, speed = 0;
    if (finished) {
      this.end = time;
      seconds = time - this.t0;
      speed = Math.round(r.speedPoints * Math.min(1, Math.max(0, 1 - seconds / r.par)));
    }
    return { rank: this.rank, chain, done: this.done, total: r.total, finished, seconds, speed };
  }
  /** Ligne du bandeau (`rt.banner`) : avancement, chronomètre, enchaînement en cours. */
  banner(time: number): string | null {
    const r = this.rule;
    if (!r) return null;
    const sec = (s: number): string => s.toFixed(1).replace('.', ',');
    if (this.t0 < 0) return `Série <b>0/${r.total}</b> · le chrono part au premier tir`;
    let s = `Série <b>${this.done}/${r.total}</b> · <b>${sec(this.elapsed(time))} s</b>`;
    const left = this.chainLeft(time);
    if (left > 0 && this.done < r.total) s += ` · enchaînement <b>×${this.rank + 1}</b> encore ${sec(left)} s`;
    return s;
  }
}
