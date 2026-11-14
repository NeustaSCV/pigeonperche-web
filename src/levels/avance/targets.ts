// Cibles du niveau « avancé » : plaques d'acier de compétition sur portique (au sol ou sur un plancher de bâtiment)
// et cible mobile sur rail. La plaque de réglage réutilise la plaque commune du jeu.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { GeoBuilder } from '../../core/builder';
import type { Engine } from '../../core/engine';
import { SteelPlate, Target, type HitInfo, type HitResult, type TargetCtx } from '../../game/targets';
import type { Terrain } from '../../world/terrain';
import type { LevelHost } from '../types';
import { BUILDINGS, DECKS, MOVER, POSTS, TARGETS, targetXZ, type TargetDef } from './map';

const std = (engine: Engine, color: number, rough = 0.7, metal = 0, key = 'tgt', emissive = 0): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (emissive > 0) { m.emissive.set(color); m.emissiveIntensity = emissive; }
  return engine.setupMaterial(m, undefined, key);
};

const ORANGE = 0xf2551a, WHITE = 0xf3f0e8, FRAME = 0x2b2e31;
/**
 * Peinture posée à 12 mm de la plaque (pastille, marque d'impact), décalée en profondeur. Le plan proche adaptatif de
 * la lunette donne 1 cm de résolution à 2 500 m au grossissement ×25, mais 5 cm à ×5 et 1,9 m à l'œil nu : pour deux
 * surfaces presque confondues, le décalage reste la bonne méthode à toutes les distances de vue.
 */
const decal = (color: number, order: number): MeshBasicMaterial => new MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2 * order, polygonOffsetUnits: -6 * order });

/** Plaque (ou gong rond) suspendue à un portique d'acier, tournée vers son poste de tir. */
export class RangePlate extends Target {
  private plate = new Object3D();
  private angle = 0;
  private av = 0;
  private half: number;
  /**
   * `foot` : point du sol (ou du plancher) à l'aplomb du centre ; `centre` : hauteur du centre au-dessus ;
   * `face` : point vers lequel la plaque regarde (le poste) ; `color` : peinture.
   */
  constructor(engine: Engine, d: TargetDef, foot: Vector3, face: { x: number; z: number }, color: number) {
    super(d.id, d.label);
    const { w, h } = d;
    this.half = h / 2;
    this.group.position.copy(foot);
    this.group.rotation.y = Math.atan2(face.x - foot.x, face.z - foot.z);
    const top = d.centre + h / 2 + 0.22;
    const gb = new GeoBuilder();
    const px = w / 2 + 0.28;
    for (const s of [-1, 1]) {
      gb.box(s * px, top / 2 + 0.05, 0, 0.1, top + 0.1, 0.1);
      // jambes de force, vers l'arrière
      gb.obox(new Vector3(s * px, top * 0.3, -top * 0.22), new Vector3(1, 0, 0), new Vector3(0, 0.8, 0.6).normalize(), new Vector3(0, -0.6, 0.8).normalize(), 0.04, top * 0.38, 0.04);
    }
    gb.box(0, top + 0.05, 0, w + 0.76, 0.1, 0.1);
    const frame = new Mesh(gb.build(), std(engine, FRAME, 0.6, 0.4, 'tgtFrame'));
    frame.castShadow = true;
    this.group.add(frame);
    this.plate.position.set(0, top, 0);
    this.group.add(this.plate);
    const geo = d.round ? new CylinderGeometry(w / 2, w / 2, 0.02, 28) : new BoxGeometry(w, h, 0.02);
    if (d.round) geo.rotateX(Math.PI / 2);
    // peinture légèrement lumineuse : une plaque à contre-jour reste lisible à la lunette
    const m = new Mesh(geo, std(engine, color, 0.6, 0.1, 'tgtPaint' + color, 0.32));
    m.position.y = -0.22 - h / 2;
    m.castShadow = true;
    this.plate.add(m);
    const dot = new Mesh(new CircleGeometry(Math.min(w, h) * 0.17, 18), decal(color === WHITE ? 0xd9541e : 0xfaf6ee, 1));
    dot.position.set(0, -0.22 - h / 2, 0.012);
    this.plate.add(dot);
    const node = new Object3D();
    node.position.set(0, -0.22 - h / 2, 0);
    this.plate.add(node);
    if (d.round) this.addCollider(node, 'sphere', 'plate', w / 2);
    else this.addCollider(node, 'box', 'plate', 0, new Vector3(w / 2, h / 2, 0.03));
  }
  aimPoint(out: Vector3): Vector3 {
    return this.colliders[0].node.getWorldPosition(out);
  }
  update(dt: number): void {
    if (this.av === 0 && this.angle === 0) return;
    this.av += (-(9.8 / (0.22 + this.half)) * this.angle - 0.9 * this.av) * dt;
    this.angle += this.av * dt;
    this.plate.rotation.x = this.angle;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.av -= Math.min(5, 0.5 + h.energy / 900);
    this.hits++;
    const local = this.plate.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.03 + Math.min(0.03, h.weapon.bulletGr * 0.00006), 8), decal(0x1e2023, 2));
    mark.position.set(local.x, local.y, 0.013);
    this.plate.add(mark);
    // éclat de plomb et de peinture : visible à la lunette avant que le son n'arrive
    ctx.fx.puff(h.point, { count: 16, speed: 3.2, life: 0.9, size: [0.12, 0.9], color: 0xe6e0d2, alpha: 0.75, drag: 1.4, wind: 0.6 });
    ctx.fx.puff(h.point, { count: 10, speed: 5, life: 0.35, size: [0.03, 0.07], color: 0xffd9a0, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.4 });
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first };
  }
}

/** Plaque portée par un chariot qui va et vient sur un rail en travers de la ligne de visée, à vitesse constante. */
export class RailMover extends Target {
  private cart = new Object3D();
  private node = new Object3D();
  private s = 0;
  private dir = 1;
  private wait = 0;
  private half: number;
  private tilt = 0;
  private av = 0;
  private plate = new Object3D();
  constructor(engine: Engine, d: TargetDef, terrain: Terrain, face: { x: number; z: number }) {
    super(d.id, d.label);
    const p = targetXZ(d.id);
    const y = terrain.heightAt(p.x, p.z);
    this.group.position.set(p.x, y, p.z);
    this.group.rotation.y = Math.atan2(face.x - p.x, face.z - p.z);
    const L = MOVER.length;
    this.half = L / 2 - 1.2;
    // voie : deux rails, traverses, butoirs (un seul maillage)
    const gb = new GeoBuilder();
    for (const s of [-1, 1]) gb.box(0, 0.16, s * 0.45, L, 0.1, 0.07);
    for (let x = -L / 2 + 0.6; x <= L / 2; x += 1.5) gb.box(x, 0.07, 0, 0.22, 0.12, 1.5);
    for (const s of [-1, 1]) { gb.box(s * (L / 2 + 0.1), 0.5, 0, 0.25, 0.9, 1.3); gb.box(s * (L / 2 + 1.2), 1.6, 0, 0.12, 3.2, 0.12); }
    const track = new Mesh(gb.build(), std(engine, 0x4a4138, 0.8, 0.2, 'tgtTrack'));
    track.castShadow = track.receiveShadow = true;
    this.group.add(track);
    // chariot : châssis, mât
    const cb = new GeoBuilder();
    cb.box(0, 0.36, 0, 1.6, 0.26, 1.1);
    cb.box(0, d.centre / 2 + 0.3, -0.12, 0.09, d.centre + 0.2, 0.09);
    const cart = new Mesh(cb.build(), std(engine, FRAME, 0.6, 0.4, 'tgtFrame'));
    cart.castShadow = true;
    this.cart.add(cart);
    this.plate.position.set(0, d.centre - d.h / 2, 0);
    const m = new Mesh(new BoxGeometry(d.w, d.h, 0.02), std(engine, ORANGE, 0.6, 0.1, 'tgtPaint' + ORANGE, 0.32));
    m.position.y = d.h / 2;
    m.castShadow = true;
    this.plate.add(m);
    const dot = new Mesh(new CircleGeometry(d.w * 0.17, 18), decal(0xfaf6ee, 1));
    dot.position.set(0, d.h / 2, 0.012);
    this.plate.add(dot);
    this.node.position.set(0, d.h / 2, 0);
    this.plate.add(this.node);
    this.cart.add(this.plate);
    this.group.add(this.cart);
    this.addCollider(this.node, 'box', 'plate', 0, new Vector3(d.w / 2, d.h / 2, 0.03));
    this.group.updateMatrixWorld(true);
  }
  /** Avance l'état (abscisse, sens, arrêt en bout de voie) de dt secondes. */
  private advance(st: { s: number; dir: number; wait: number }, dt: number): void {
    let left = dt;
    for (let n = 0; n < 8 && left > 0; n++) {
      if (st.wait > 0) {
        const w = Math.min(st.wait, left);
        st.wait -= w;
        left -= w;
        continue;
      }
      const room = st.dir > 0 ? this.half - st.s : st.s + this.half;
      const run = Math.min(room, MOVER.speed * left);
      st.s += st.dir * run;
      left -= run / MOVER.speed;
      if (run >= room - 1e-6) { st.dir = -st.dir; st.wait = MOVER.pause; }
    }
  }
  aimPoint(out: Vector3): Vector3 {
    return this.node.getWorldPosition(out);
  }
  predict(dt: number, out: Vector3): Vector3 {
    this.aimPoint(out);
    if (this.done) return out;
    const st = { s: this.s, dir: this.dir, wait: this.wait };
    this.advance(st, dt);
    const c = Math.cos(this.group.rotation.y), sn = Math.sin(this.group.rotation.y);
    out.x += (st.s - this.s) * c;
    out.z -= (st.s - this.s) * sn;
    return out;
  }
  update(dt: number): void {
    if (!this.done) {
      const st = { s: this.s, dir: this.dir, wait: this.wait };
      this.advance(st, dt);
      this.s = st.s; this.dir = st.dir; this.wait = st.wait;
      this.cart.position.x = this.s;
    }
    if (this.av !== 0 || this.tilt !== 0) {
      this.av += (-30 * this.tilt - 2.2 * this.av) * dt;
      this.tilt += this.av * dt;
      this.plate.rotation.x = this.tilt;
    }
  }
  /** vitesse du chariot en ce moment (m/s) */
  get moving(): boolean {
    return !this.done && this.wait <= 0;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.av -= Math.min(3, 0.4 + h.energy / 1500);
    this.hits++;
    const local = this.plate.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.035, 8), decal(0x1e2023, 2));
    mark.position.set(local.x, local.y, 0.013);
    this.plate.add(mark);
    ctx.fx.puff(h.point, { count: 16, speed: 3.2, life: 0.9, size: [0.12, 0.9], color: 0xe6e0d2, alpha: 0.75, drag: 1.4, wind: 0.6 });
    ctx.fx.puff(h.point, { count: 10, speed: 5, life: 0.35, size: [0.03, 0.07], color: 0xffd9a0, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.4 });
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first, note: first ? 'Touché : le chariot s’arrête.' : undefined };
  }
}

export interface AvanceTargets {
  list: Target[];
  mover: RailMover;
}

/** Point du plancher d'un bâtiment de la banque sous une cible, dans le monde (bâtiment posé, sinon position calculée). */
function deckFoot(h: LevelHost, name: keyof typeof DECKS): Vector3 {
  const D = DECKS[name];
  const b = h.buildings?.get(name);
  if (b) return b.toWorld(D.x, D.y, D.z);
  const p = targetXZ(name);
  const spot = BUILDINGS.find((s) => s.name === name)!;
  return new Vector3(p.x, spot.groundY + D.y, p.z);
}

export function buildTargets(h: LevelHost): AvanceTargets {
  const e = h.engine, T = TARGETS;
  const ground = (id: string): Vector3 => { const p = targetXZ(id); return new Vector3(p.x, h.terrain.heightAt(p.x, p.z), p.z); };
  const zp = ground('zero');
  const mover = new RailMover(e, T.mover, h.terrain, POSTS[T.mover.post]);
  const plate = (id: string, foot: Vector3, color: number): RangePlate => new RangePlate(e, T[id], foot, POSTS[T[id].post], color);
  const list: Target[] = [
    new SteelPlate(e, 'zero', T.zero.label, zp, T.zero.w, false),
    plate('chateau', deckFoot(h, 'chateau'), ORANGE),
    mover,
    plate('mine', deckFoot(h, 'mine'), ORANGE),
    plate('mile', ground('mile'), ORANGE),
    plate('fourneau', deckFoot(h, 'fourneau'), WHITE),
    plate('deuxMille', ground('deuxMille'), ORANGE),
    plate('siege', deckFoot(h, 'siege'), ORANGE),
    plate('extreme', ground('extreme'), ORANGE),
  ];
  return { list, mover };
}
