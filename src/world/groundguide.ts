// Guidage au sol, aux pieds du tireur : une flèche (chevrons dorés) vers le pas de tir conseillé tant qu'il marche ;
// arrivé au pas de tir, un cercle dont les pointes bleues donnent la direction des cibles de l'objectif en cours
// (pointes pâles et courtes : les cibles des objectifs suivants). Mêmes couleurs que la boussole.
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';

const GOLD = 0xe2b85c, BLUE = 0x7fd4f0, PALE = 0xe9e4d6;
const RING_R = 0.82;
const MAX_SPIKES = 28;
/** deux pointes à moins de cet écart (rad) n'en font qu'une */
const MERGE = 0.045;

const flat = (xz: number[]): BufferGeometry => {
  const g = new BufferGeometry();
  const p = new Float32Array((xz.length / 2) * 3);
  for (let i = 0; i < xz.length / 2; i++) { p[i * 3] = xz[i * 2]; p[i * 3 + 2] = xz[i * 2 + 1]; }
  g.setAttribute('position', new BufferAttribute(p, 3));
  return g;
};
/** Chevron pointant vers −Z (le nord de la carte), sommet en (0, −d). */
const chevron = (w: number, d: number, t: number): BufferGeometry => {
  const h = w / 2;
  return flat([
    -h, 0, -h, t, 0, -d + t, -h, 0, 0, -d + t, 0, -d,
    h, 0, 0, -d + t, h, t, h, 0, 0, -d, 0, -d + t,
  ]);
};
const mat = (color: number, opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });

export interface GroundGuideState {
  /** pieds du tireur */
  x: number; y: number; z: number;
  /** flèche : relèvement (rad, 0 = nord, sens horaire) et distance du prochain point de passage ; null = pas de flèche */
  arrow: { bearing: number; dist: number } | null;
  /** cercle : relèvements des cibles de l'objectif en cours et des objectifs suivants ; null = pas de cercle */
  ring: { now: number[]; later: number[] } | null;
}

export class GroundGuide {
  group = new Group();
  private arrow = new Group();
  private chevrons: Mesh[] = [];
  private ring = new Group();
  private spikes: Mesh[] = [];
  private spikesLater: Mesh[] = [];
  private t = 0;
  private fade = { arrow: 0, ring: 0 };
  private n = new Vector3();
  private used: number[] = [];
  /** `ground(x, z, nearY)` : hauteur du sol ou du plancher sous le point, au plus près de nearY */
  constructor(private ground: (x: number, z: number, nearY: number) => number) {
    const cg = chevron(0.95, 0.42, 0.2);
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(cg, mat(GOLD, 0));
      m.position.z = -(1.4 + i * 0.55);
      this.chevrons.push(m);
      this.arrow.add(m);
    }
    const rg = new RingGeometry(RING_R - 0.035, RING_R + 0.035, 56);
    rg.rotateX(-Math.PI / 2);
    this.ring.add(new Mesh(rg, mat(PALE, 0.7)));
    const big = flat([-0.13, -(RING_R + 0.07), 0.13, -(RING_R + 0.07), 0, -(RING_R + 0.55)]);
    const small = flat([-0.06, -(RING_R + 0.06), 0.06, -(RING_R + 0.06), 0, -(RING_R + 0.22)]);
    const blue = mat(BLUE, 0.95), pale = mat(PALE, 0.55);
    for (let i = 0; i < MAX_SPIKES; i++) {
      const a = new Mesh(big, blue), b = new Mesh(small, pale);
      this.spikes.push(a); this.spikesLater.push(b);
      this.ring.add(a, b);
    }
    for (const g of [this.arrow, this.ring]) { g.visible = false; g.renderOrder = 3; this.group.add(g); }
    this.group.traverse((o) => { o.frustumCulled = false; (o as Mesh).castShadow = false; });
  }

  /** Pose le groupe au sol en (x, z), incliné selon la pente relevée à `r` mètres autour. */
  private place(g: Group, x: number, y: number, z: number, r: number): void {
    const h = this.ground(x, z, y);
    const sx = (this.ground(x + r, z, y) - this.ground(x - r, z, y)) / (2 * r);
    const sz = (this.ground(x, z + r, y) - this.ground(x, z - r, y)) / (2 * r);
    // marche ou bord de plancher : pas de pente à suivre, on reste à plat
    const steep = Math.abs(sx) > 0.7 || Math.abs(sz) > 0.7;
    this.n.set(steep ? 0 : -sx, 1, steep ? 0 : -sz).normalize();
    g.position.set(x, (Math.abs(h - y) < 1.2 ? h : y) + 0.045, z);
    g.quaternion.setFromUnitVectors(UP, this.n);
  }

  update(dt: number, s: GroundGuideState | null): void {
    this.t += dt;
    const k = Math.min(1, dt * 6);
    this.fade.arrow += ((s?.arrow ? 1 : 0) - this.fade.arrow) * k;
    this.fade.ring += ((s?.ring ? 1 : 0) - this.fade.ring) * k;
    this.arrow.visible = this.fade.arrow > 0.02;
    this.ring.visible = this.fade.ring > 0.02;
    if (!s) return;
    if (s.arrow) {
      this.place(this.arrow, s.x, s.y, s.z, 0.9);
      this.arrow.rotateY(-s.arrow.bearing);
      // tout près du but, les chevrons se resserrent pour ne pas le dépasser
      const reach = Math.max(0.45, Math.min(1, (s.arrow.dist - 0.4) / 2.2));
      for (let i = 0; i < 3; i++) this.chevrons[i].position.z = -(1.4 + i * 0.55) * reach;
    }
    if (this.arrow.visible) for (let i = 0; i < 3; i++) {
      // onde qui court vers l'avant
      const w = 0.5 + 0.5 * Math.sin(this.t * 5 - i * 1.1);
      (this.chevrons[i].material as MeshBasicMaterial).opacity = this.fade.arrow * (0.45 + 0.5 * w);
    }
    if (s.ring) {
      this.place(this.ring, s.x, s.y, s.z, RING_R);
      this.used.length = 0;
      const set = (pool: Mesh[], list: number[]): void => {
        let n = 0;
        for (const b of list) {
          if (n >= pool.length) break;
          if (this.used.some((u) => Math.abs(Math.atan2(Math.sin(u - b), Math.cos(u - b))) < MERGE)) continue;
          this.used.push(b);
          pool[n].visible = true;
          pool[n++].rotation.y = -b;
        }
        for (; n < pool.length; n++) pool[n].visible = false;
      };
      set(this.spikes, s.ring.now);
      set(this.spikesLater, s.ring.later);
    }
    if (this.ring.visible) {
      const f = this.fade.ring;
      (this.ring.children[0] as Mesh<any, MeshBasicMaterial>).material.opacity = 0.7 * f;
      (this.spikes[0].material as MeshBasicMaterial).opacity = 0.95 * f;
      (this.spikesLater[0].material as MeshBasicMaterial).opacity = 0.55 * f;
    }
  }
}
const UP = new Vector3(0, 1, 0);
