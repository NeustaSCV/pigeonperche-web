// Personnage procédural : squelette d'Object3D, poses analytiques (marche, accroupi, rampé, tir couché,
// discussion, chute), rendu soit en maillages (joueur), soit instancié (foule : une passe par partie du corps).
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  CylinderGeometry,
  BufferAttribute,
  type BufferGeometry,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Engine } from '../core/engine';

export type Stance = 'stand' | 'crouch' | 'prone';

export interface PoseInput {
  stance: Stance;
  /** 0 debout … 1 accroupi … 2 couché, lissé (transitions fluides) */
  stanceBlend: number;
  /** phase du cycle de marche (rad) */
  phase: number;
  /** 0 immobile … 1 marche … 2 course */
  move: number;
  /** en position de tir (bras vers l'arme) 0..1 */
  aim: number;
  /** manipulation du verrou 0..1 (0 = au repos) */
  bolt: number;
  /** gestes de discussion 0..1 et horloge */
  talk: number;
  time: number;
  /** chute 0..1 */
  fall: number;
  /** boiterie 0..1 */
  limp: number;
  /** regard : lacet de la tête (rad) */
  headYaw: number;
  /** inclinaison du buste vers l'avant (rad), ex. appui sur un créneau */
  lean: number;
}
export const defaultPose = (): PoseInput => ({ stance: 'stand', stanceBlend: 0, phase: 0, move: 0, aim: 0, bolt: 0, talk: 0, time: 0, fall: 0, limp: 0, headYaw: 0, lean: 0 });

/** Noms des parties rendues. */
export const PARTS = ['pelvis', 'torso', 'head', 'hat', 'armUL', 'armLL', 'armUR', 'armLR', 'legUL', 'legLL', 'legUR', 'legLR', 'footL', 'footR', 'pack'] as const;
export type PartName = (typeof PARTS)[number];

let GEO: Record<PartName, BufferGeometry> | null = null;
/** Teinte par sommet : permet gants, col, semelles et sangles sans matériau supplémentaire. */
function tint(g: BufferGeometry, k: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3).fill(k);
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}
function merge(...gs: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}
function geometries(): Record<PartName, BufferGeometry> {
  if (GEO) return GEO;
  const cap = (r: number, len: number, sx = 1, sz = 1): BufferGeometry => {
    const g = new CapsuleGeometry(r, len, 5, 12);
    g.translate(0, -len / 2, 0); // l'origine est l'articulation haute, le membre pend vers -Y
    g.scale(sx, 1, sz);
    return g;
  };
  const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): BufferGeometry => {
    const g = new SphereGeometry(r, 12, 9);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
  };
  // buste : veste ample, épaules marquées, col relevé, capuche rabattue dans le dos
  const chest = new CapsuleGeometry(0.175, 0.3, 6, 14);
  chest.scale(1.2, 1, 0.8);
  chest.translate(0, 0.27, 0);
  const collar = new CylinderGeometry(0.085, 0.105, 0.09, 12, 1, true);
  collar.translate(0, 0.53, 0.0);
  const hood = ball(0.12, 0, 0.47, -0.11, 1.15, 0.75, 0.8);
  const torso = merge(tint(chest, 1), tint(collar, 0.8), tint(hood, 0.9), tint(ball(0.085, 0.2, 0.44, 0, 1, 0.9, 1), 1), tint(ball(0.085, -0.2, 0.44, 0, 1, 0.9, 1), 1));
  // bassin : bas de veste légèrement évasé + ceinture
  const hem = new CylinderGeometry(0.2, 0.215, 0.2, 14, 1, false);
  hem.scale(1.08, 1, 0.78);
  hem.translate(0, 0.04, 0);
  const seat = new CapsuleGeometry(0.15, 0.1, 4, 10);
  seat.rotateZ(Math.PI / 2);
  seat.scale(1, 0.95, 0.82);
  seat.translate(0, -0.06, 0);
  const pelvis = merge(tint(hem, 1.02), tint(seat, 0.6));
  const skull = new SphereGeometry(0.105, 16, 12);
  skull.scale(0.9, 1.12, 1);
  skull.translate(0, 0.14, 0.012);
  const neck = new CylinderGeometry(0.048, 0.055, 0.1, 10);
  neck.translate(0, 0.03, 0);
  const head = merge(tint(skull, 1), tint(neck, 0.92));
  const cap2 = new SphereGeometry(0.113, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.56);
  cap2.scale(0.95, 1.08, 1.05);
  cap2.translate(0, 0.152, 0.008);
  const brim = new CylinderGeometry(0.1, 0.1, 0.012, 12, 1, false, -1.0, 2.0);
  brim.scale(0.85, 1, 1.3);
  brim.translate(0, 0.165, 0.07);
  const hat = merge(tint(cap2, 1), tint(brim, 0.85));
  const armU = (): BufferGeometry => tint(cap(0.06, 0.24), 1);
  const armL = (): BufferGeometry => merge(tint(cap(0.05, 0.22), 1), tint(new CylinderGeometry(0.052, 0.05, 0.035, 10).translate(0, -0.235, 0) as BufferGeometry, 0.75), tint(ball(0.05, 0, -0.305, 0.008, 0.85, 1.2, 1.05), 0.22));
  const legU = (): BufferGeometry => tint(cap(0.086, 0.35, 1, 1.05), 1);
  const legL = (): BufferGeometry => merge(tint(cap(0.064, 0.36), 1), tint(new CylinderGeometry(0.07, 0.066, 0.13, 10).translate(0, -0.4, 0) as BufferGeometry, 0.3));
  const sole = new BoxGeometry(0.105, 0.035, 0.29);
  sole.translate(0, -0.06, 0.065);
  const upper = new CapsuleGeometry(0.052, 0.15, 4, 8);
  upper.rotateX(Math.PI / 2);
  upper.scale(1, 0.85, 1);
  upper.translate(0, -0.015, 0.075);
  const foot = merge(tint(upper, 1), tint(sole, 0.45));
  // sac : corps, rabat, tapis roulé, sangles
  const body = new CapsuleGeometry(0.115, 0.2, 4, 10);
  body.scale(1.2, 1, 0.72);
  body.translate(0, 0.27, -0.2);
  const flap = ball(0.11, 0, 0.42, -0.2, 1.25, 0.5, 0.75);
  const roll = new CylinderGeometry(0.055, 0.055, 0.34, 10);
  roll.rotateZ(Math.PI / 2);
  roll.translate(0, 0.07, -0.21);
  const strapL = new BoxGeometry(0.035, 0.36, 0.012).translate(0.12, 0.33, 0.125) as BufferGeometry;
  const strapR = new BoxGeometry(0.035, 0.36, 0.012).translate(-0.12, 0.33, 0.125) as BufferGeometry;
  const pack = merge(tint(body, 1), tint(flap, 0.85), tint(roll, 0.55), tint(strapL, 0.5), tint(strapR, 0.5));
  GEO = {
    pelvis, torso, head, hat,
    armUL: armU(), armLL: armL(), armUR: armU(), armLR: armL(),
    legUL: legU(), legLL: legL(), legUR: legU(), legLR: legL(),
    footL: foot, footR: foot, pack,
  };
  return GEO;
}

export interface Outfit {
  jacket: number;
  trousers: number;
  skin: number;
  hat: number | null;
  pack: number | null;
  boots: number;
  /** échelle de taille */
  height: number;
}

/** longueurs du bras (épaule → coude) et de l'avant-bras (coude → paume), repère du buste */
const ARM_UPPER = 0.29, ARM_FORE = 0.3;
const _t = new Vector3(), _d = new Vector3(), _p = new Vector3(), _u = new Vector3(), _f = new Vector3(), _x = new Vector3(), _z = new Vector3();
const _q = new Quaternion(), _qw = new Quaternion(), _m = new Matrix4();

export class Rig {
  root = new Object3D();
  hips = new Object3D();
  spine = new Object3D();
  head = new Object3D();
  armL = new Object3D();
  foreL = new Object3D();
  armR = new Object3D();
  foreR = new Object3D();
  legL = new Object3D();
  shinL = new Object3D();
  legR = new Object3D();
  shinR = new Object3D();
  footL = new Object3D();
  footR = new Object3D();
  /** nœud → partie */
  nodes: Record<PartName, Object3D>;

  constructor(public outfit: Outfit) {
    const { root, hips, spine, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR, footL, footR } = this;
    root.add(hips);
    hips.add(spine, legL, legR);
    spine.add(head, armL, armR);
    armL.add(foreL);
    armR.add(foreR);
    legL.add(shinL);
    legR.add(shinR);
    shinL.add(footL);
    shinR.add(footR);
    spine.position.set(0, 0.06, 0);
    head.position.set(0, 0.5, 0);
    armL.position.set(0.215, 0.44, 0);
    armR.position.set(-0.215, 0.44, 0);
    foreL.position.set(0, -0.29, 0);
    foreR.position.set(0, -0.29, 0);
    legL.position.set(0.095, -0.04, 0);
    legR.position.set(-0.095, -0.04, 0);
    shinL.position.set(0, -0.43, 0);
    shinR.position.set(0, -0.43, 0);
    footL.position.set(0, -0.44, 0);
    footR.position.set(0, -0.44, 0);
    root.scale.setScalar(outfit.height);
    this.nodes = { pelvis: hips, torso: spine, head, hat: head, armUL: armL, armLL: foreL, armUR: armR, armLR: foreR, legUL: legL, legLL: shinL, legUR: legR, legLR: shinR, footL, footR, pack: spine };
  }

  /** Applique une pose. Le personnage regarde vers +Z, +X est sa gauche. */
  pose(p: PoseInput): void {
    const { hips, spine, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR, footL, footR } = this;
    const sb = p.stanceBlend;
    const cr = Math.min(1, sb); // 0..1 debout→accroupi
    const pr = Math.max(0, sb - 1); // 0..1 accroupi→couché
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    const mv = Math.min(1, p.move);
    const run = Math.max(0, p.move - 1);
    const amp = (0.5 + 0.35 * run) * mv * (1 - 0.35 * cr);

    // --- debout / accroupi ---
    const bob = Math.abs(c) * 0.035 * mv;
    let hipY = 0.93 - 0.42 * cr - bob;
    let hipPitch = 0.06 * mv + 0.3 * run + 0.12 * cr;
    let thL = -s * amp - 1.15 * cr, thR = s * amp - 1.15 * cr;
    let knL = Math.max(0, -c) * (0.9 + 0.5 * run) * mv + 1.95 * cr + 0.06, knR = Math.max(0, c) * (0.9 + 0.5 * run) * mv + 1.95 * cr + 0.06;
    if (p.limp > 0) {
      // boiterie : la jambe gauche plie peu, le buste plonge quand elle porte
      thL *= 1 - 0.55 * p.limp;
      knL *= 1 - 0.6 * p.limp;
      hipY -= Math.max(0, s) * 0.05 * p.limp * mv;
      hipPitch += Math.max(0, s) * 0.12 * p.limp * mv;
    }
    // (épaulé debout : le buste se penche un peu sur l'arme)
    let spPitch = 0.04 + 0.42 * cr * (1 - p.aim * 0.3) + p.lean + 0.14 * p.aim * (1 - cr) * (1 - pr);
    let aL = s * amp * 0.8 + 0.05, aR = -s * amp * 0.8 + 0.05;
    let eL = -0.25 - 0.5 * run * mv - 0.5 * cr, eR = -0.25 - 0.5 * run * mv - 0.5 * cr;
    let aLz = 0.09, aRz = -0.09;
    let headPitch = -0.1 * cr;
    // discussion : gestes des avant-bras
    if (p.talk > 0) {
      const t = p.time;
      aR += p.talk * (-0.5 + 0.25 * Math.sin(t * 2.3));
      eR += p.talk * (-0.9 + 0.5 * Math.sin(t * 3.1 + 1));
      aL += p.talk * (-0.15 + 0.12 * Math.sin(t * 1.7 + 2));
      eL += p.talk * (-0.5 + 0.3 * Math.sin(t * 2.6));
      headPitch += p.talk * 0.06 * Math.sin(t * 1.9);
    }
    // visée accroupie : la main gauche soutient le fût (bras presque tendu, à l'horizontale), la droite tient la
    // poignée, coude plié sous la crosse. Angles donnés par rapport à la verticale, d'où la correction du buste penché.
    if (p.aim > 0 && pr < 0.5) {
      const lean = spPitch + hipPitch;
      aL += p.aim * (-1.72 - lean - aL);
      aR += p.aim * (-0.5 - lean - aR);
      eL += p.aim * (-0.12 - eL);
      eR += p.aim * (-2.05 - eR);
      aLz += p.aim * -0.6;
      aRz += p.aim * 0.45;
      headPitch += p.aim * 0.1;
    }

    // --- couché ---
    if (pr > 0) {
      const crawl = mv;
      hipY += (0.15 - hipY) * pr;
      hipPitch += (Math.PI / 2 - 0.05 - hipPitch) * pr;
      spPitch += (-0.16 - 0.1 * p.aim - spPitch) * pr;
      const cl = s * 0.5 * crawl;
      thL += (0.04 + Math.max(0, cl) * 1.1 - thL) * pr;
      thR += (0.04 + Math.max(0, -cl) * 1.1 - thR) * pr;
      knL += (0.08 + Math.max(0, cl) * 1.3 - knL) * pr;
      knR += (0.08 + Math.max(0, -cl) * 1.3 - knR) * pr;
      // bras vers l'avant, coudes au sol
      const reach = -2.25;
      aL += (reach + 0.35 * cl - 0.1 * p.aim - aL) * pr;
      aR += (reach - 0.35 * cl + 0.25 * p.aim - aR) * pr;
      eL += (-0.75 - 0.3 * p.aim - eL) * pr;
      eR += (-1.25 - 0.45 * p.aim - eR) * pr;
      aLz += (0.5 - 0.75 * p.aim - aLz) * pr;
      aRz += (-0.5 + 0.2 * p.aim - aRz) * pr;
      headPitch += (-1.05 + 0.12 * p.aim - headPitch) * pr;
    }
    // verrou : la main droite quitte la poignée, recule puis revient
    if (p.bolt > 0) {
      const b = Math.sin(p.bolt * Math.PI);
      aR += b * 0.35;
      eR += b * -0.55;
      aRz += b * -0.25;
    }
    // chute sobre : le corps s'affaisse sur le côté
    if (p.fall > 0) {
      const f = p.fall * p.fall * (3 - 2 * p.fall);
      hipY += (0.16 - hipY) * f;
      hipPitch += (-Math.PI / 2 + 0.1 - hipPitch) * f;
      thL += (0.25 - thL) * f; thR += (-0.1 - thR) * f;
      knL += (0.5 - knL) * f; knR += (0.2 - knR) * f;
      aL += (-0.4 - aL) * f; aR += (0.5 - aR) * f;
      aLz += (0.9 - aLz) * f; aRz += (-0.7 - aRz) * f;
      spPitch += (-0.1 - spPitch) * f;
      headPitch += (0.3 - headPitch) * f;
    }

    hips.position.set(0, hipY, 0);
    hips.rotation.set(hipPitch, 0, (p.fall > 0 ? 0 : s * 0.04 * mv));
    spine.rotation.set(spPitch, -s * 0.12 * mv * (1 - pr), 0);
    head.rotation.set(headPitch, p.headYaw, 0);
    legL.rotation.set(thL, 0, 0.03 + 0.14 * pr);
    legR.rotation.set(thR, 0, -0.03 - 0.14 * pr);
    shinL.rotation.set(knL, 0, 0);
    shinR.rotation.set(knR, 0, 0);
    // pieds à plat debout, pointés couché
    footL.rotation.set(-thL - knL - hipPitch * (1 - pr) + 0.9 * pr, 0, 0);
    footR.rotation.set(-thR - knR - hipPitch * (1 - pr) + 0.9 * pr, 0, 0);
    armL.rotation.set(aL, 0, aLz);
    armR.rotation.set(aR, 0, aRz);
    foreL.rotation.set(eL, 0, 0);
    foreR.rotation.set(eR, 0, 0);
  }

  /**
   * Point `v` du repère local de `node` (un nœud du squelette), exprimé dans le repère du parent de `root` (le groupe
   * du personnage) pour la pose courante. Sert à poser l'arme par rapport à la tête et à l'épaule. Modifie et renvoie `v`.
   */
  toGroup(node: Object3D, v: Vector3): Vector3 {
    for (let o: Object3D | null = node; o; o = o === this.root ? null : o.parent) {
      o.updateMatrix();
      v.applyMatrix4(o.matrix);
    }
    return v;
  }

  /**
   * Ancre une main sur un point de l'espace (repère monde) : cinématique inverse à deux segments, épaule puis coude.
   * À appeler après `pose()`, qui remet les bras en pose analytique ; `w` (0..1) mélange la pose et l'ancrage.
   * Le coude part vers le bas et l'extérieur. Hors de portée, le bras se tend vers la cible sans l'atteindre.
   */
  reach(side: 'L' | 'R', worldTarget: Vector3, w: number): void {
    if (w <= 0.001) return;
    const arm = side === 'L' ? this.armL : this.armR, fore = side === 'L' ? this.foreL : this.foreR;
    const spine = this.spine;
    spine.updateWorldMatrix(true, false);
    const t = spine.worldToLocal(_t.copy(worldTarget)).sub(arm.position);
    const l1 = ARM_UPPER, l2 = ARM_FORE;
    const dist = Math.min(l1 + l2 - 0.004, Math.max(Math.abs(l1 - l2) + 0.02, t.length()));
    const d = _d.copy(t).normalize();
    // direction du coude : vers le bas et l'extérieur (repère monde), ramenée dans le repère du buste
    spine.getWorldQuaternion(_qw).invert();
    const out = side === 'L' ? 1 : -1;
    _p.set(0, -1, -0.25).applyQuaternion(_qw);
    _p.x += out * 0.55;
    _p.addScaledVector(d, -_p.dot(d));
    if (_p.lengthSq() < 1e-6) _p.set(out, 0, 0);
    _p.normalize();
    // triangle épaule – coude – main (loi des cosinus)
    const ca = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
    const sa = Math.sqrt(1 - ca * ca);
    const u = _u.copy(d).multiplyScalar(ca).addScaledVector(_p, sa); // épaule → coude
    const f = _f.copy(d).multiplyScalar(dist).addScaledVector(u, -l1).normalize(); // coude → main
    // repère du bras : le membre pend vers −Y, l'avant-bras plie vers +Z (rotation négative autour de X)
    _z.copy(f).addScaledVector(u, -f.dot(u));
    if (_z.lengthSq() < 1e-8) _z.copy(_p).negate();
    _z.normalize();
    _u.negate();
    _x.crossVectors(_u, _z);
    _q.setFromRotationMatrix(_m.makeBasis(_x, _u, _z));
    const bend = -Math.atan2(f.dot(_z), -f.dot(_u));
    if (w >= 0.999) { arm.quaternion.copy(_q); fore.rotation.set(bend, 0, 0); }
    else { arm.quaternion.slerp(_q, w); fore.rotation.set(fore.rotation.x + (bend - fore.rotation.x) * w, 0, 0); }
  }

  colorOf(part: PartName, out: Color): Color {
    const o = this.outfit;
    switch (part) {
      case 'head': return out.set(o.skin);
      case 'hat': return out.set(o.hat ?? o.skin);
      case 'pack': return out.set(o.pack ?? o.jacket);
      case 'torso': case 'armUL': case 'armUR': return out.set(o.jacket);
      case 'armLL': case 'armLR': return out.set(o.jacket).multiplyScalar(0.92);
      case 'footL': case 'footR': return out.set(o.boots);
      default: return out.set(o.trousers);
    }
  }
  visible(part: PartName): boolean {
    if (part === 'hat') return this.outfit.hat !== null;
    if (part === 'pack') return this.outfit.pack !== null;
    return true;
  }
}

/** Personnage rendu en maillages individuels (le joueur, la sentinelle). */
export class CharacterMesh {
  group = new Group();
  rig: Rig;
  constructor(engine: Engine, outfit: Outfit, cloth?: Texture) {
    this.rig = new Rig(outfit);
    this.group.add(this.rig.root);
    const g = geometries();
    const c = new Color();
    for (const part of PARTS) {
      if (!this.rig.visible(part)) continue;
      const skin = part === 'head';
      const mat = engine.setupMaterial(new MeshStandardMaterial({ color: this.rig.colorOf(part, c).clone(), roughness: skin ? 0.62 : 0.92, metalness: 0, vertexColors: true, normalMap: skin ? null : cloth ?? null }), undefined, 'char' + (skin ? 's' : ''));
      if (!skin && cloth) mat.normalScale.set(0.55, 0.55);
      const m = new Mesh(g[part], mat);
      m.castShadow = m.receiveShadow = true;
      this.rig.nodes[part].add(m);
    }
  }
}

/** Foule instanciée : un InstancedMesh par partie du corps pour tous les personnages. */
export class Crowd {
  group = new Group();
  rigs: Rig[] = [];
  private meshes = new Map<PartName, InstancedMesh>();
  private holder = new Object3D();
  private zero = new Matrix4().makeScale(0, 0, 0);

  constructor(engine: Engine, outfits: Outfit[]) {
    const g = geometries();
    const c = new Color();
    for (const o of outfits) {
      const r = new Rig(o);
      this.holder.add(r.root);
      this.rigs.push(r);
    }
    for (const part of PARTS) {
      const mat = engine.setupMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, vertexColors: true }), undefined, 'crowd');
      const im = new InstancedMesh(g[part], mat, outfits.length);
      this.rigs.forEach((r, i) => im.setColorAt(i, r.colorOf(part, c)));
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = true;
      this.meshes.set(part, im);
      this.group.add(im);
    }
  }

  /** À appeler après avoir posé et placé chaque rig. */
  sync(): void {
    this.holder.updateMatrixWorld(true);
    for (const part of PARTS) {
      const im = this.meshes.get(part)!;
      for (let i = 0; i < this.rigs.length; i++) {
        const r = this.rigs[i];
        im.setMatrixAt(i, r.visible(part) && r.root.visible ? r.nodes[part].matrixWorld : this.zero);
      }
      im.instanceMatrix.needsUpdate = true;
      if (!this.sphereDone) im.computeBoundingSphere();
    }
    if (!this.sphereDone) {
      // la foule reste sur la place : une sphère englobante large suffit, calculée une fois
      for (const im of this.meshes.values()) if (im.boundingSphere) im.boundingSphere.radius += 60;
      this.sphereDone = true;
    }
  }
  private sphereDone = false;
}

/** Accessoire simple : cylindre fin (canne, arme en bandoulière). */
export function stickGeometry(len: number, r = 0.015): BufferGeometry {
  const g = new CylinderGeometry(r, r, len, 6);
  return g;
}
