// Mécaniques de sabotage, réutilisables par toute carte (aucune dépendance vers une carte) :
//  - `Track` + `Train` : convoi sur une voie (polyligne), qui manœuvre puis s'immobilise sur ordre ; un de ses wagons
//    porte une plaque à tirer À L'ARRÊT (`predict` reste exact pendant le mouvement, pour le tireur automatique) ;
//  - `RailSignal` : signal à abattre (sa cible bascule, ses feux s'éteignent) ;
//  - `Valve` : volant de vanne, qui saute et laisse un jet de vapeur (un indice de vent de plus) ;
//  - `HoverDrone` : drone en point fixe, strictement immobile ;
//  - `GlintScope` : lunette adverse sur trépied, dont le reflet trahit la position, avec un délai avant d'être repéré ;
//  - `ClockFace` : cadran d'horloge (impact de nature « bell ») ;
//  - `Stealth` : suivi de l'alerte d'une carte où chaque tir manqué compte.
// Aucune effusion de sang : tout ceci est du matériel.
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import type { WeaponDef } from '../../config/weapons';
import { GeoBuilder } from '../../core/builder';
import type { Engine } from '../../core/engine';
import type { Mission } from '../mission';
import type { ImpactReport } from '../shots';
import { Target, type HitInfo, type HitResult, type TargetCtx } from '../targets';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const std = (engine: Engine, color: number, rough = 0.7, metal = 0, key = 'sab', emissive = 0): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (emissive > 0) { m.emissive.set(color); m.emissiveIntensity = emissive; }
  return engine.setupMaterial(m, undefined, key);
};
/** matière à couleurs par sommet (un seul maillage par objet) */
const painted = (engine: Engine, rough = 0.75, metal = 0.15): MeshStandardMaterial =>
  engine.setupMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }), undefined, 'sabPaint');
/**
 * Fait passer une matière devant ce qui est juste derrière elle (plaque sur son cadre, cadran sur sa lunette). À
 * 1 500 m, le tampon de profondeur ne sépare pas deux surfaces distantes de quelques centimètres : sans ce décalage,
 * c'est le fond qui s'affiche. `order` : rang dans l'empilement (1 au-dessus du fond, 2 au-dessus de 1…).
 */
function front<T extends MeshStandardMaterial | MeshBasicMaterial>(m: T, order: number): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2 * order;
  m.polygonOffsetUnits = -6 * order;
  return m;
}
/** peinture posée à fleur d'une surface (pastille, marque d'impact), décalée en profondeur */
const decal = (color: number, order: number): MeshBasicMaterial => new MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2 * order, polygonOffsetUnits: -6 * order });
const tint = (b: GeoBuilder, hex: number, k = 1): void => {
  const c = new Color(hex);
  b.color = [c.r * k, c.g * k, c.b * k];
};
const sparks = (ctx: TargetCtx, p: Vector3, n = 14): void =>
  ctx.fx.puff(p, { count: n, speed: 4.5, life: 0.45, size: [0.03, 0.07], color: 0xffd9a0, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.4 });

// ---------------------------------------------------------------------------------------------- voie
/** Voie : polyligne (x, y, z) parcourue par son abscisse curviligne. */
export class Track {
  readonly pts: Vector3[];
  private lens: number[] = [0];
  readonly total: number;
  constructor(pts: Vector3[]) {
    this.pts = pts;
    let t = 0;
    for (let i = 1; i < pts.length; i++) {
      t += pts[i].distanceTo(pts[i - 1]);
      this.lens.push(t);
    }
    this.total = t;
  }
  /** Point à l'abscisse `s` (bornée à la voie) ; `fwd` reçoit la tangente unitaire, dans le sens des abscisses. */
  at(s: number, out: Vector3, fwd?: Vector3): Vector3 {
    s = Math.min(this.total - 1e-3, Math.max(0, s));
    let lo = 1, hi = this.lens.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lens[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const f = (s - this.lens[lo - 1]) / (this.lens[lo] - this.lens[lo - 1]);
    out.lerpVectors(this.pts[lo - 1], this.pts[lo], f);
    if (fwd) fwd.copy(this.pts[lo]).sub(this.pts[lo - 1]).normalize();
    return out;
  }
  /** Abscisse du point de la voie le plus proche de (x, z). */
  nearest(x: number, z: number): number {
    let best = 1e18, bs = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
      const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
      if (d < best) { best = d; bs = this.lens[i - 1] + (this.lens[i] - this.lens[i - 1]) * t; }
    }
    return bs;
  }
}

// ---------------------------------------------------------------------------------------------- convoi
export interface CarDef {
  kind: 'loco' | 'tank' | 'box' | 'flat';
  length: number;
  color: number;
}
export interface TrainOpts {
  cars: CarDef[];
  /** vitesse de manœuvre (m/s), accélération et freinage (m/s²), arrêt à chaque bout de la navette (s) */
  speed: number;
  accel: number;
  pause: number;
  /** abscisses de la tête de convoi aux deux bouts de la navette, et au départ */
  shuttle: [number, number];
  start: number;
  /** wagon marqué (indice dans `cars`), côté de sa plaque (vers ce point), côté du carré (m), hauteur de son centre au-dessus du rail */
  marked: number;
  plateToward: { x: number; z: number };
  plateSize: number;
  plateY: number;
}
interface Motion { s: number; v: number; goal: number; wait: number; held: boolean; end: number }

const STEP = 1 / 120;
/** Cylindre couché le long de z (citerne) dans un GeoBuilder. */
function tank(gb: GeoBuilder, cy: number, r: number, len: number, sides = 12): void {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3(), n = new Vector3();
  const h = len / 2;
  for (let i = 0; i < sides; i++) {
    const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = Math.cos(t0) * r, y0 = cy + Math.sin(t0) * r, x1 = Math.cos(t1) * r, y1 = cy + Math.sin(t1) * r;
    a.set(x0, y0, -h); b.set(x1, y1, -h); c.set(x1, y1, h); d.set(x0, y0, h);
    n.set(Math.cos((t0 + t1) / 2), Math.sin((t0 + t1) / 2), 0);
    gb.quad(a, d, c, b, n, [0, 0, len, 0, len, 1, 0, 1]);
    // fonds
    for (const s of [-1, 1]) {
      const e = v3(0, cy, s * (h + 0.25)), p = v3(x0, y0, s * h), q = v3(x1, y1, s * h);
      if (s > 0) gb.quad(e, p, q, e, v3(0, 0, 1), [0, 0, 0, 0, 0, 0, 0, 0]);
      else gb.quad(e, q, p, e, v3(0, 0, -1), [0, 0, 0, 0, 0, 0, 0, 0]);
    }
  }
}

/**
 * Convoi sur une voie. Tant qu'on ne lui dit rien il fait la navette, au pas, entre deux abscisses ; `halt(s)` lui fait
 * ranger son wagon marqué à l'abscisse `s` et l'y immobilise pour de bon. La plaque du wagon marqué est la cible :
 * elle se tire à l'arrêt (`stopped`). Les caisses arrêtent les balles (partie « body », sans effet).
 */
export class Train extends Target {
  private cars: { g: Group; off: number }[] = [];
  private m: Motion;
  private acc = 0;
  private plate = new Object3D();
  private side = 1;
  private markOff = 0;
  private fwd = new Vector3();
  private leak: { on: boolean; pos: Vector3 } | null = null;
  constructor(engine: Engine, id: string, label: string, private track: Track, private o: TrainOpts) {
    super(id, label);
    const mat = painted(engine);
    let off = 0;
    o.cars.forEach((c, i) => {
      const g = new Group();
      const gb = new GeoBuilder();
      gb.useColor = true;
      const L = c.length - 1.1;
      // châssis, bogies, tampons
      tint(gb, 0x2a2b2d);
      gb.box(0, 1.02, 0, 2.7, 0.26, L, 2);
      for (const s of [-1, 1]) {
        gb.box(0, 0.5, s * (L / 2 - 1.9), 2.2, 0.62, 2.6, 2);
        for (const q of [-1, 1]) gb.box(q * 0.9, 1.02, s * (L / 2 + 0.3), 0.3, 0.3, 0.6, 2);
      }
      tint(gb, c.color);
      if (c.kind === 'tank') {
        tank(gb, 2.6, 1.38, L - 1.2);
        tint(gb, 0x3a3c3e);
        gb.box(0, 4.05, 0, 0.9, 0.3, 1.6, 2);
        for (const s of [-1, 1]) gb.box(0, 1.5, s * (L / 2 - 1.5), 2.5, 0.7, 0.5, 2);
      } else if (c.kind === 'box') {
        gb.box(0, 2.55, 0, 2.85, 2.8, L - 0.3, 2);
        tint(gb, c.color, 0.72);
        gb.box(0, 4.02, 0, 2.95, 0.16, L - 0.1, 2);
        gb.box(1.44, 2.5, 0, 0.06, 2.3, 2.4, 2);
        gb.box(-1.44, 2.5, 0, 0.06, 2.3, 2.4, 2);
      } else if (c.kind === 'flat') {
        gb.box(0, 1.9, -L * 0.22, 2.44, 1.5, L * 0.42, 2);
        tint(gb, 0x6d7f86);
        gb.box(0, 2.1, L * 0.24, 2.44, 1.9, L * 0.4, 2);
      } else {
        // locomotive de manœuvre : capot long, cabine, bandeau de visibilité
        gb.box(0, 2.3, -L * 0.14, 2.6, 2.3, L * 0.66, 2);
        gb.box(0, 2.75, L * 0.34, 2.9, 3.2, L * 0.28, 2);
        tint(gb, 0xe2b93b);
        gb.box(0, 1.35, 0, 2.94, 0.3, L + 0.05, 2);
        tint(gb, 0x15181b);
        gb.box(0, 3.55, L * 0.34, 2.94, 0.8, L * 0.2, 2);
        gb.box(0, 3.6, -L * 0.3, 0.5, 0.5, 0.5, 2);
      }
      const mesh = new Mesh(gb.build(), mat);
      mesh.castShadow = true;
      g.add(mesh);
      const body = new Object3D();
      body.position.set(0, 2.3, 0);
      g.add(body);
      this.addCollider(body, 'box', 'body', 0, new Vector3(1.44, 1.8, c.length / 2 - 0.25));
      this.group.add(g);
      this.cars.push({ g, off: off + c.length / 2 });
      if (i === o.marked) this.markOff = off + c.length / 2;
      off += c.length;
    });
    // côté de la plaque : celui qui regarde `plateToward` quand le wagon est rangé
    this.m = { s: o.start, v: 0, goal: o.shuttle[1], wait: 0, held: false, end: 1 };
    // plaque de danger : carré orange à liseré noir, sur une potence au flanc du wagon
    const S = o.plateSize;
    const pm = new Mesh(new BoxGeometry(S, S, 0.03), front(std(engine, 0xf2671a, 0.6, 0.1, 'sabPlate', 0.35), 2));
    this.plate.add(pm);
    const rimG = new Mesh(new BoxGeometry(S + 0.14, S + 0.14, 0.02), front(std(engine, 0x17191b, 0.7, 0.2, 'sabDark1'), 1));
    rimG.position.z = -0.02;
    this.plate.add(rimG);
    const bar = new Mesh(new BoxGeometry(S * 0.86, 0.05, 0.01), decal(0x17191b, 3));
    bar.position.z = 0.017;
    this.plate.add(bar);
    this.cars[o.marked].g.add(this.plate);
    this.addCollider(this.plate, 'box', 'plate', 0, new Vector3(S / 2, S / 2, 0.05));
    this.setSide(o.shuttle[0]);
    this.place();
  }
  /** Oriente la plaque vers `plateToward` pour un wagon marqué rangé à l'abscisse `s`. */
  private setSide(s: number): void {
    const p = this.track.at(s, new Vector3(), this.fwd);
    // axe x local du wagon dans le monde : (cos θ, 0, −sin θ) avec θ = atan2(fwd.x, fwd.z)
    const lx = this.fwd.z, lz = -this.fwd.x;
    this.side = lx * (this.o.plateToward.x - p.x) + lz * (this.o.plateToward.z - p.z) >= 0 ? 1 : -1;
    this.plate.position.set(this.side * 1.52, this.o.plateY, 0);
    this.plate.rotation.y = (this.side * Math.PI) / 2;
  }
  private place(): void {
    for (const c of this.cars) {
      this.track.at(this.m.s - c.off, c.g.position, this.fwd);
      c.g.rotation.y = Math.atan2(this.fwd.x, this.fwd.z);
    }
    this.group.updateMatrixWorld(true);
  }
  /** Un pas de la marche : vers `goal`, vitesse bornée par la distance de freinage ; arrêt et demi-tour aux bouts. */
  private stepMotion(m: Motion, h: number): void {
    if (m.wait > 0) { m.wait -= h; return; }
    const d = m.goal - m.s, a = this.o.accel;
    if (Math.abs(d) < 0.02 && Math.abs(m.v) < 0.06) {
      m.s = m.goal;
      m.v = 0;
      if (!m.held) { m.wait = this.o.pause; m.end = 1 - m.end; m.goal = this.o.shuttle[m.end]; }
      return;
    }
    const want = Math.sign(d) * Math.min(this.o.speed, Math.sqrt(2 * a * Math.abs(d)) * 0.92 + 0.03);
    const dv = want - m.v, lim = a * 1.6 * h;
    m.v += Math.abs(dv) > lim ? Math.sign(dv) * lim : dv;
    m.s += m.v * h;
  }
  /** Le convoi se range : wagon marqué à l'abscisse `s`, puis ne bouge plus. */
  halt(s: number): void {
    if (this.m.held) return;
    this.m.held = true;
    this.m.wait = 0;
    this.m.goal = s + this.markOff;
    this.setSide(s);
  }
  /** Reprend la navette (remise en état d'une carte). */
  release(): void {
    this.m.held = false;
    this.m.goal = this.o.shuttle[this.m.end];
  }
  get held(): boolean {
    return this.m.held;
  }
  /** immobile à sa place de rangement */
  get stopped(): boolean {
    return this.m.held && this.m.v === 0 && this.m.s === this.m.goal;
  }
  /** vitesse actuelle (m/s, signée) et distance restant à parcourir jusqu'à l'arrêt (m) */
  get velocity(): number {
    return this.m.v;
  }
  get remaining(): number {
    return Math.abs(this.m.goal - this.m.s);
  }
  /** position de la locomotive (son du convoi, repères) */
  get head(): Vector3 {
    return this.cars[0].g.position;
  }
  private plateAt(s: number, out: Vector3): Vector3 {
    this.track.at(s - this.markOff, out, this.fwd);
    out.x += this.fwd.z * this.side * 1.52;
    out.z += -this.fwd.x * this.side * 1.52;
    out.y += this.o.plateY;
    return out;
  }
  aimPoint(out: Vector3): Vector3 {
    return this.plateAt(this.m.s, out);
  }
  /** Position de la plaque dans `dt` secondes : la marche réelle déroulée à l'avance, au même pas que `update`. */
  predict(dt: number, out: Vector3): Vector3 {
    if (this.done || this.stopped) return this.aimPoint(out);
    const m = { ...this.m };
    const t = this.acc + dt;
    const n = Math.floor(t / STEP);
    for (let i = 0; i < n; i++) this.stepMotion(m, STEP);
    return this.plateAt(m.s + m.v * (t - n * STEP), out);
  }
  update(dt: number): void {
    if (this.stopped || dt <= 0) return;
    this.acc += dt;
    while (this.acc >= STEP) { this.acc -= STEP; this.stepMotion(this.m, STEP); }
    this.place();
    if (this.leak) this.plateAt(this.m.s, this.leak.pos);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (h.part !== 'plate') return { kind: 'metal', note: 'Tôle du wagon : sans effet. Visez la plaque orange.' };
    if (this.done) return { kind: 'metal' };
    this.hits++;
    this.done = true;
    const local = this.plate.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.05, 8), decal(0x1e2023, 4));
    mark.position.set(local.x, local.y, 0.02);
    this.plate.add(mark);
    sparks(ctx, h.point);
    // la citerne se vide : un panache clair, que le vent couche
    this.leak = ctx.fx.addEmitter(h.point, 9, { speed: 1.4, up: 0.6, life: 5, size: [0.4, 5], color: 0xe6e9da, alpha: 0.5, drag: 0.4, wind: 1 });
    if (!this.m.held) this.halt(this.m.s - this.markOff);
    return { kind: 'metal', success: true, note: 'Citerne percée : le chargement se répand.' };
  }
}

// ---------------------------------------------------------------------------------------------- signal
/**
 * Signal de voie sur son mât : une cible rectangulaire noire à liseré blanc et trois feux. Touchée, elle se décroche,
 * pend au bout de son câble et ses feux s'éteignent (`down`).
 */
export class RailSignal extends Target {
  private head = new Object3D();
  private lamps: Mesh[] = [];
  private angle = 0;
  private av = 0;
  down = false;
  /** `foot` : pied du mât ; `face` : point vers lequel la cible regarde ; `w`, `h` : cible ; `y` : hauteur de son centre. */
  constructor(engine: Engine, id: string, label: string, foot: Vector3, face: { x: number; z: number }, w: number, h: number, y: number) {
    super(id, label);
    this.group.position.copy(foot);
    this.group.rotation.y = Math.atan2(face.x - foot.x, face.z - foot.z);
    const gb = new GeoBuilder();
    const top = y + h / 2 + 0.5;
    // mât en treillis : quatre montants, des entretoises, une échelle, une passerelle de visite
    for (const [dx, dz] of [[-0.22, -0.5], [0.22, -0.5], [0.22, -0.94], [-0.22, -0.94]]) gb.box(dx, top / 2, dz, 0.07, top, 0.07);
    for (let yy = 0.8; yy < top; yy += 1.1) { gb.box(0, yy, -0.5, 0.5, 0.05, 0.05); gb.box(0, yy, -0.94, 0.5, 0.05, 0.05); gb.box(-0.22, yy, -0.72, 0.05, 0.05, 0.44); gb.box(0.22, yy, -0.72, 0.05, 0.05, 0.44); }
    gb.box(0, y - h / 2 - 0.25, -0.3, w + 0.9, 0.06, 0.9);
    gb.box(0, y + h / 2 + 0.2, -0.3, 0.1, 0.1, 0.5);
    gb.box(0, 0.25, -0.72, 1.1, 0.5, 1.1);
    const mast = new Mesh(gb.build(), std(engine, 0x43484b, 0.65, 0.4, 'sabSteel'));
    mast.castShadow = true;
    this.group.add(mast);
    // la cible : articulée par son bord supérieur
    this.head.position.set(0, y + h / 2, 0);
    this.group.add(this.head);
    const board = new Mesh(new BoxGeometry(w, h, 0.06), front(std(engine, 0x101214, 0.8, 0.1, 'sabDark2'), 2));
    board.position.y = -h / 2;
    board.castShadow = true;
    this.head.add(board);
    const rim = new Mesh(new BoxGeometry(w + 0.24, h + 0.24, 0.03), front(std(engine, 0xf1efe8, 0.6, 0, 'sabWhite1', 0.3), 1));
    rim.position.set(0, -h / 2, -0.03);
    this.head.add(rim);
    const colors = [new Color(0.2, 5, 0.9), new Color(6, 3.4, 0.3), new Color(7, 0.5, 0.3)];
    for (let i = 0; i < 3; i++) {
      const l = new Mesh(new CircleGeometry(Math.min(w, h / 3) * 0.34, 14), front(new MeshBasicMaterial({ color: i === 0 ? colors[0] : new Color(0.05, 0.05, 0.05) }), 3));
      l.position.set(0, -h / 2 + (1 - i) * h * 0.3, 0.035);
      this.head.add(l);
      this.lamps.push(l);
    }
    const node = new Object3D();
    node.position.set(0, -h / 2, 0);
    this.head.add(node);
    this.addCollider(node, 'box', 'signal', 0, new Vector3(w / 2, h / 2, 0.06));
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[0].node.getWorldPosition(out);
  }
  update(dt: number): void {
    if (!this.down || (this.av === 0 && this.angle === 0)) return;
    // pend et se balance autour de sa dernière attache
    this.av += (-7 * (this.angle - 0.42) - 1.1 * this.av) * dt;
    this.angle += this.av * dt;
    this.head.rotation.z = this.angle;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    sparks(ctx, h.point, 22);
    if (this.down) return { kind: 'metal' };
    this.down = this.done = true;
    this.av = 2.4;
    this.angle = 0.02;
    for (const l of this.lamps) (l.material as MeshBasicMaterial).color.setRGB(0.04, 0.04, 0.04);
    ctx.fx.puff(h.point, { count: 8, speed: 0.6, up: 0.9, life: 2.6, size: [0.2, 1.4], color: 0x4a4a4a, alpha: 0.5 });
    return { kind: 'electric', success: true, note: 'Signal abattu : la voie est fermée.' };
  }
}

// ---------------------------------------------------------------------------------------------- vanne
/** Volant de vanne (disque plein, rouge à moyeu blanc) au bout de sa tige. Touché, il saute : la conduite crache sa vapeur. */
export class Valve extends Target {
  private wheel = new Group();
  private pos: Vector3;
  private flyV = new Vector3();
  private flying = false;
  /** `pos` : centre du volant ; `face` : point vers lequel il regarde ; `d` : diamètre. */
  constructor(engine: Engine, id: string, label: string, pos: Vector3, face: { x: number; z: number }, private d: number) {
    super(id, label);
    this.pos = pos.clone();
    this.group.position.copy(pos);
    this.group.rotation.y = Math.atan2(face.x - pos.x, face.z - pos.z);
    const disc = new CylinderGeometry(d / 2, d / 2, 0.05, 20);
    disc.rotateX(Math.PI / 2);
    const m = new Mesh(disc, std(engine, 0xd2281e, 0.55, 0.2, 'sabValve', 0.3));
    m.castShadow = true;
    this.wheel.add(m);
    const hub = new Mesh(new CircleGeometry(d * 0.17, 14), decal(0xf4f1e8, 1));
    hub.position.z = 0.03;
    this.wheel.add(hub);
    this.group.add(this.wheel);
    const stem = new CylinderGeometry(0.05, 0.05, 0.5, 8);
    stem.rotateX(Math.PI / 2);
    const st = new Mesh(stem, std(engine, 0x43484b, 0.6, 0.5, 'sabSteel'));
    st.position.z = -0.27;
    this.group.add(st);
    this.addCollider(this.wheel, 'sphere', 'valve', d / 2);
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.pos);
  }
  update(dt: number, ctx: TargetCtx): void {
    if (!this.flying) return;
    this.flyV.y -= 9.8 * dt;
    this.wheel.position.addScaledVector(this.flyV, dt);
    this.wheel.rotation.x += dt * 7;
    this.wheel.rotation.y += dt * 4;
    const w = this.wheel.getWorldPosition(new Vector3());
    if (w.y < ctx.terrain.heightAt(w.x, w.z) + 0.05) { this.flying = false; this.wheel.rotation.set(Math.PI / 2, 0, 0); }
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (this.done) return { kind: 'metal' };
    this.hits++;
    this.done = true;
    this.active = false;
    this.flying = true;
    // le volant part vers l'arrière de la conduite (repère local de la cible : la balle arrive par +z)
    this.flyV.set((Math.random() - 0.5) * 2, 3.2, -2.5);
    sparks(ctx, h.point);
    // jet de vapeur sous pression, puis panache que le vent emporte
    ctx.fx.puff(this.pos, { count: 26, speed: 6, up: 2, life: 1.4, size: [0.3, 3], color: 0xf2f2ee, alpha: 0.8, drag: 1.2, wind: 0.6 });
    ctx.fx.addEmitter(this.pos, 12, { speed: 2.4, up: 2.6, life: 4.5, size: [0.35, 6], color: 0xf0f0ea, alpha: 0.55, drag: 0.45, wind: 1 });
    return { kind: 'metal', success: true, note: 'Volant arraché : la conduite se vide.' };
  }
}

// ---------------------------------------------------------------------------------------------- drone
/** Drone lourd en point fixe, strictement immobile (ni dérive ni balancement) : une cible fixe en plein ciel. */
export class HoverDrone extends Target {
  private body = new Group();
  private rot: Mesh[] = [];
  private vel = new Vector3();
  private crashed = false;
  /** `pos` : centre du corps ; `span` : envergure rotors compris ; `height` : hauteur du corps ; `floorY` : altitude où il s'écrase (toit), sinon le sol. */
  constructor(engine: Engine, id: string, label: string, pos: Vector3, face: { x: number; z: number }, span: number, height: number, private floorY: number | null = null) {
    super(id, label);
    const k = span / 1.6;
    const dark = std(engine, 0x1d1f22, 0.45, 0.5, 'sabDrone');
    const gb = new GeoBuilder();
    gb.box(0, 0, 0, 0.72 * k, height * 0.62, 0.72 * k);
    gb.box(0, -height * 0.42, 0, 0.36 * k, height * 0.3, 0.36 * k);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      gb.obox(v3(x * 0.3 * k, 0.04, z * 0.3 * k), v3(x, 0, z).normalize(), UP, v3(-z, 0, x).normalize(), 0.36 * k, 0.035, 0.035);
      gb.box(x * 0.55 * k, 0.1, z * 0.55 * k, 0.1 * k, 0.16, 0.1 * k);
    }
    for (const s of [-1, 1]) gb.box(s * 0.3 * k, -height * 0.5, 0, 0.03, height * 0.35, 0.6 * k);
    const hull = new Mesh(gb.build(), dark);
    hull.castShadow = true;
    this.body.add(hull);
    // bandeau clair : le corps se détache du ciel comme du toit
    const band = new Mesh(new BoxGeometry(0.78 * k, height * 0.22, 0.78 * k), front(std(engine, 0xe8e6de, 0.6, 0, 'sabWhite1', 0.3), 1));
    this.body.add(band);
    const blur = new MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.3, depthWrite: false, side: 2 });
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const r = new Mesh(new CircleGeometry(0.25 * k, 14), blur);
      r.rotation.x = -Math.PI / 2;
      r.position.set(x * 0.55 * k, 0.2, z * 0.55 * k);
      this.body.add(r);
      this.rot.push(r);
    }
    const led = new Mesh(new SphereGeometry(0.035, 6, 6), new MeshBasicMaterial({ color: new Color(6, 0.4, 0.3) }));
    led.position.set(0, -height * 0.3, 0.37 * k);
    this.body.add(led);
    this.body.position.copy(pos);
    this.body.rotation.y = Math.atan2(face.x - pos.x, face.z - pos.z);
    this.group.add(this.body);
    const node = new Object3D();
    node.position.set(0, -height * 0.08, 0);
    this.body.add(node);
    this.addCollider(node, 'box', 'drone', 0, new Vector3(0.52 * k, height / 2, 0.52 * k));
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[0].node.getWorldPosition(out);
  }
  update(dt: number, ctx: TargetCtx): void {
    if (!this.done || this.crashed) return;
    this.vel.y -= 9.8 * dt;
    this.body.position.addScaledVector(this.vel, dt);
    this.body.rotation.x += dt * 4.2;
    this.body.rotation.z += dt * 2.7;
    if (Math.random() < 0.5) ctx.fx.puff(this.body.position, { count: 1, speed: 0.3, life: 1.8, size: [0.2, 1.4], color: 0x333333, alpha: 0.5 });
    const floor = Math.max(this.floorY ?? -1e9, ctx.terrain.heightAt(this.body.position.x, this.body.position.z));
    if (this.body.position.y < floor + 0.2) {
      this.crashed = true;
      this.body.position.y = floor + 0.2;
      ctx.fx.puff(this.body.position, { count: 16, speed: 2.2, up: 1, life: 1.8, size: [0.3, 2], color: 0x8a7a66, alpha: 0.5 });
    }
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (this.done) return { kind: 'metal' };
    this.hits++;
    this.done = true;
    this.vel.copy(h.dir).multiplyScalar(1.5);
    for (const r of this.rot) r.visible = false;
    sparks(ctx, h.point, 18);
    return { kind: 'electric', success: true };
  }
  /** Plein centre : rapporté à la demi-hauteur du corps (sa plus petite dimension vue du tireur), pas à sa demi-envergure. */
  hitOffset(part: string, point: Vector3, dir: Vector3): number | null {
    const o = super.hitOffset(part, point, dir);
    const h = this.colliders[0].half;
    return o === null ? null : (o * h.x) / h.y;
  }
  get position(): Vector3 {
    return this.body.position;
  }
}

// ---------------------------------------------------------------------------------------------- lunette adverse
let flareTex: CanvasTexture | null = null;
function flareTexture(): CanvasTexture {
  if (flareTex) return flareTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,246,214,0.9)');
  grad.addColorStop(0.45, 'rgba(255,226,150,0.22)');
  grad.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // croix de diffraction
  g.fillStyle = 'rgba(255,250,230,0.55)';
  g.fillRect(0, 31, 64, 2);
  g.fillRect(31, 0, 2, 64);
  flareTex = new CanvasTexture(c);
  flareTex.colorSpace = SRGBColorSpace;
  return flareTex;
}

/**
 * Lunette de surveillance automatique sur trépied (du matériel : personne derrière). Elle balaie lentement ; chaque
 * fois que son objectif passe face au tireur, le soleil s'y reflète : un éclat, de taille constante à l'écran, visible
 * à l'œil nu comme à la lunette. Elle porte un délai (`arm`, `tick`) : au bout, le tireur est repéré.
 */
export class GlintScope extends Target {
  private head = new Group();
  private flare: Sprite;
  private baseYaw: number;
  /** temps restant avant d'être repéré (s) ; Infinity tant que le délai n'est pas lancé */
  left = Infinity;
  /** balayage arrêté, objectif face au tireur (essais, captures) */
  frozen = false;
  /** `pos` : centre du caisson ; `face` : le tireur ; `d` : diamètre du caisson (zone utile) ; `legs` : hauteur du trépied. */
  constructor(engine: Engine, id: string, label: string, pos: Vector3, face: { x: number; z: number }, private d: number, legs: number) {
    super(id, label);
    this.group.position.copy(pos);
    this.baseYaw = Math.atan2(face.x - pos.x, face.z - pos.z);
    const gb = new GeoBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const foot = v3(Math.cos(a) * legs * 0.42, -legs, Math.sin(a) * legs * 0.42), top = v3(0, -d * 0.36, 0);
      const dir = foot.clone().sub(top), len = dir.length();
      dir.divideScalar(len);
      const sx = new Vector3().crossVectors(dir, UP).normalize(), sz = new Vector3().crossVectors(sx, dir).normalize();
      gb.obox(top.clone().add(foot).multiplyScalar(0.5), sx, dir, sz, 0.035, len / 2, 0.035);
    }
    gb.box(0, -d * 0.36, 0, 0.16, 0.14, 0.16);
    const tripod = new Mesh(gb.build(), std(engine, 0x1a1c1e, 0.6, 0.4, 'sabDark'));
    tripod.castShadow = true;
    this.group.add(tripod);
    // caisson : deux tubes jumelés dans un carter clair, pare-soleil, objectifs sombres
    const hb = new GeoBuilder();
    hb.box(0, 0, -0.08, d, d * 0.62, d * 1.25);
    hb.box(0, d * 0.34, 0.1, d * 1.06, 0.04, d * 1.1);
    const box = new Mesh(hb.build(), std(engine, 0xb9bdb2, 0.6, 0.1, 'sabScope', 0.18));
    box.castShadow = true;
    this.head.add(box);
    for (const s of [-1, 1]) {
      const lens = new Mesh(new CircleGeometry(d * 0.2, 16), decal(0x0c1322, 1));
      lens.position.set(s * d * 0.25, 0, d * 0.55);
      this.head.add(lens);
    }
    this.group.add(this.head);
    this.flare = new Sprite(new SpriteMaterial({ map: flareTexture(), color: new Color(5, 4.5, 3.4), transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false, fog: false, toneMapped: false }));
    this.flare.position.set(0, 0, d * 0.6);
    // taille constante À L'ÉCRAN (part de la hauteur de l'image), quels que soient la distance et le grossissement :
    // sans atténuation, un sprite garde une taille angulaire fixe, que la lunette grossirait vingt-cinq fois
    this.flare.onBeforeRender = (_r, _s, cam) => {
      // élément [5] de la projection : 1 / tan(champ vertical / 2), grossissement de la lunette compris
      this.flare.scale.setScalar((2 * this.screen) / cam.projectionMatrix.elements[5]);
      this.flare.updateMatrixWorld();
    };
    this.head.add(this.flare);
    this.addCollider(this.head, 'sphere', 'scope', d / 2);
    this.head.rotation.y = this.baseYaw;
    this.group.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.head.getWorldPosition(out);
  }
  /** Lance (ou relance) le délai. */
  arm(seconds: number): void {
    this.left = seconds;
  }
  /** Décompte ; renvoie vrai à l'instant où le délai expire. */
  tick(dt: number): boolean {
    if (this.done || this.left === Infinity || this.left <= 0) return false;
    this.left -= dt;
    return this.left <= 0;
  }
  /** éclat de l'instant, de 0 à 1 ; taille de l'éclat à l'écran (part de la hauteur de l'image) */
  shine = 0;
  private screen = 0.01;
  update(_dt: number, ctx: TargetCtx): void {
    if (this.done) return;
    // balayage de ±32° en 11 s ; l'éclat culmine quand l'objectif est dans l'axe du tireur
    const sweep = this.frozen ? 0 : Math.sin(ctx.time * ((2 * Math.PI) / 11)) * 0.56;
    this.head.rotation.y = this.baseYaw + sweep;
    const on = Math.exp(-((sweep / 0.2) ** 2));
    this.shine = 0.16 + 0.84 * on * (0.85 + 0.15 * Math.sin(ctx.time * 23));
    (this.flare.material as SpriteMaterial).opacity = Math.min(1, 0.35 + this.shine);
    this.screen = 0.014 + 0.046 * this.shine;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    if (this.done) return { kind: 'metal' };
    this.hits++;
    this.done = true;
    this.flare.visible = false;
    this.head.rotation.set(0.5, this.baseYaw + 0.8, 0.3);
    ctx.fx.puff(h.point, { count: 30, speed: 4.5, life: 0.8, size: [0.015, 0.03], color: 0xe8f0ff, alpha: 1, gravity: 9, drag: 0.6, wind: 0, glow: 0.8 });
    sparks(ctx, h.point, 8);
    return { kind: 'glass', success: true, note: 'Lunette éteinte.' };
  }
}

// ---------------------------------------------------------------------------------------------- horloge
/**
 * Cadran d'horloge de façade : disque émaillé, chiffres en bâtons, aiguilles qui tournent (une heure de jeu par heure).
 * Touché, il sonne (nature d'impact « bell ») et s'arrête. La zone utile est le disque exact, pas son carré englobant.
 */
export class ClockFace extends Target {
  private hands: [Mesh, Mesh];
  private node = new Object3D();
  private tmp = new Vector3();
  /** `pos` : centre du cadran ; `yaw` : lacet de la façade (0 : le cadran regarde +z) ; `d` : diamètre ; `hour` : heure au début de la partie. */
  constructor(engine: Engine, id: string, label: string, pos: Vector3, yaw: number, private d: number, private hour = 14.6) {
    super(id, label);
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    const R = d / 2;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4efe2';
    g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1b1d'; g.lineWidth = 9;
    g.beginPath(); g.arc(128, 128, 119, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineWidth = i % 3 === 0 ? 11 : 6;
      g.beginPath(); g.moveTo(128 + Math.sin(a) * 84, 128 - Math.cos(a) * 84); g.lineTo(128 + Math.sin(a) * 108, 128 - Math.cos(a) * 108); g.stroke();
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    // cadran un peu lumineux : à 2 400 m, dans l'ombre de la corniche, il doit rester lisible à la lunette
    const face = new MeshStandardMaterial({ map: tex, roughness: 0.5, emissiveMap: tex, emissive: new Color(0xffffff), emissiveIntensity: 0.35 });
    const dial = new Mesh(new CircleGeometry(R, 40), front(engine.setupMaterial(face, undefined, 'sabClock'), 1));
    dial.position.z = 0.06;
    this.group.add(dial);
    const ring = new CylinderGeometry(R + 0.12, R + 0.12, 0.1, 40);
    ring.rotateX(Math.PI / 2);
    const bezel = new Mesh(ring, std(engine, 0x2a2622, 0.6, 0.4, 'sabDark'));
    this.group.add(bezel);
    const hand = (len: number, w: number): Mesh => {
      const geo = new BoxGeometry(w, len, 0.02);
      geo.translate(0, len * 0.4, 0);
      const m = new Mesh(geo, decal(0x151517, 2));
      m.position.z = 0.075;
      this.group.add(m);
      return m;
    };
    this.hands = [hand(R * 0.55, R * 0.09), hand(R * 0.82, R * 0.06)];
    this.node.position.z = 0.06;
    this.group.add(this.node);
    this.addCollider(this.node, 'box', 'dial', 0, new Vector3(R, R, 0.06));
    this.setHands(this.hour);
    this.group.updateMatrixWorld(true);
  }
  private setHands(hour: number): void {
    this.hands[0].rotation.z = -((hour % 12) / 12) * Math.PI * 2;
    this.hands[1].rotation.z = -(hour % 1) * Math.PI * 2;
  }
  aimPoint(out: Vector3): Vector3 {
    return this.node.getWorldPosition(out);
  }
  /** Le disque seulement : un impact dans un coin du carré englobant passe à côté du cadran. */
  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    const hit = super.segment(a, b);
    if (!hit) return null;
    const p = this.node.worldToLocal(this.tmp.lerpVectors(a, b, hit.t));
    return Math.hypot(p.x, p.y) <= this.d / 2 ? hit : null;
  }
  update(_dt: number, ctx: TargetCtx): void {
    if (!this.done) this.setHands(this.hour + ctx.time / 3600);
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    const local = this.node.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.07 + Math.min(0.05, h.weapon.bulletGr * 0.00008), 9), decal(0x1a1a1c, 3));
    mark.position.set(local.x, local.y, 0.085);
    this.group.add(mark);
    ctx.fx.puff(h.point, { count: 18, speed: 3.2, life: 1, size: [0.15, 1.2], color: 0xe9e4d6, alpha: 0.7, drag: 1.4, wind: 0.6 });
    const first = !this.done;
    this.done = true;
    return { kind: 'bell', success: first, note: first ? 'L’horloge sonne une dernière fois, puis s’arrête.' : undefined };
  }
}

// ---------------------------------------------------------------------------------------------- alerte
export interface StealthRules {
  /** points d'alerte pour un tir qui ne neutralise rien ; pour la seule détonation d'un tir */
  miss: number;
  shot: number;
  /** plafond de la jauge tant que l'alerte n'est pas donnée : une détonation seule ne la donne jamais */
  cap: number;
  /** niveau auquel l'alerte est ramenée quand on reprend un objectif manqué */
  retry: number;
}

/**
 * Suivi de l'alerte d'une carte de sabotage. Le jeu compte d'office la détonation de chaque tir selon le calibre
 * (`Mission.onShot`) : ici elle est ramenée à un coût fixe et faible (le tireur est loin), et c'est le tir manqué qui
 * pèse (`Mission.raiseAlert`). Brancher `shot` sur `LevelScene.onShot`, `impact` sur `onImpact`, `frame` sur `frame`
 * (qui garde la mission) et `retry` sur `retry`.
 */
export class Stealth {
  private mission: Mission | null = null;
  /** tirs manqués depuis le début de la mission, et pendant l'objectif en cours */
  misses = 0;
  stepMisses = 0;
  constructor(readonly rules: StealthRules) {}
  /** À chaque image. Renvoie vrai quand l'alerte vient d'être donnée (à la carte de décider : échec, perte de bonus…). */
  frame(mission: Mission): boolean {
    this.mission = mission;
    if (mission.alarm) return true;
    if (mission.alert > this.rules.cap) mission.alert = this.rules.cap;
    return false;
  }
  /** Un coup part : la détonation ne coûte que `rules.shot`, quel que soit le calibre. */
  shot(def: WeaponDef): void {
    const m = this.mission;
    if (!m || m.alarm) return;
    m.alert = Math.min(this.rules.cap, Math.max(0, m.alert - def.alert * 0.5) + this.rules.shot);
  }
  /** Un impact : renvoie vrai si c'est un tir manqué (rien de neutralisé), et monte l'alerte d'autant. */
  impact(r: ImpactReport): boolean {
    if (r.result?.success || (r.target && r.target.done && (r.kind === 'bell' || r.kind === 'steel'))) return false;
    this.misses++;
    this.stepMisses++;
    this.mission?.raiseAlert(this.rules.miss);
    return true;
  }
  /** Nouvel objectif : le compte des tirs manqués de l'objectif repart de zéro. */
  nextStep(): void {
    this.stepMisses = 0;
  }
  /** Reprise d'un objectif manqué : l'alerte retombe à un niveau jouable. */
  retry(): void {
    const m = this.mission;
    if (!m) return;
    m.alarm = false;
    m.alert = Math.min(m.alert, this.rules.retry);
  }
}
