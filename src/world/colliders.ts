// Collisions : segments 2D pour le joueur, surfaces de marche, et un BVH unique pour balles et lignes de visée.
import { BufferAttribute, BufferGeometry, DoubleSide, Line3, Matrix4, Ray, Vector3, type Mesh } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Glass } from './glass';

export type SurfaceTag = 'stone' | 'wood' | 'metal' | 'dirt' | 'rock';
const TAGS: SurfaceTag[] = ['stone', 'wood', 'metal', 'dirt', 'rock'];

export interface Seg {
  ax: number; az: number; bx: number; bz: number;
  /** demi-épaisseur */
  r: number;
  y0: number; y1: number;
  /** extrémités droites (mur) au lieu d'arrondies : les embrasures gardent toute leur largeur */
  box?: boolean;
}
export interface WalkSurface {
  x0: number; x1: number; z0: number; z1: number;
  h: (x: number, z: number) => number;
  kind: 'stone' | 'wood';
}

export class Colliders {
  segs: Seg[] = [];
  surfaces: WalkSurface[] = [];
  /**
   * Objets visibles mais non solides (lierre, fanions…) : sphères englobantes. Ni les balles ni le joueur ne les
   * voient ; seul le plan proche de la lunette en tient compte, pour ne pas les couper.
   */
  soft: { x: number; y: number; z: number; r: number }[] = [];
  bvh: MeshBVH | null = null;
  /** vitres : traversées par la balle, mais elles se brisent (voir world/glass.ts) */
  glass = new Glass();
  private pos: number[] = [];
  private tag: number[] = [];
  private tagAttr!: Float32Array;
  private ray = new Ray();
  private tmp = new Vector3();

  /** Ajoute une géométrie (non indexée ou indexée) transformée en espace monde. */
  addGeometry(g: BufferGeometry, m: Matrix4 | null, tag: SurfaceTag): void {
    const p = g.getAttribute('position');
    const idx = g.getIndex();
    const v = this.tmp;
    const t = TAGS.indexOf(tag);
    const push = (i: number): void => {
      v.fromBufferAttribute(p, i);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      this.tag.push(t);
    };
    if (idx) for (let i = 0; i < idx.count; i++) push(idx.getX(i));
    else for (let i = 0; i < p.count; i++) push(i);
  }
  /** Triangles déjà en espace monde : neuf nombres par triangle. */
  addTriangles(xyz: number[], tag: SurfaceTag): void {
    const t = TAGS.indexOf(tag);
    for (let i = 0; i < xyz.length; i += 3) { this.pos.push(xyz[i], xyz[i + 1], xyz[i + 2]); this.tag.push(t); }
  }
  addMesh(mesh: Mesh, tag: SurfaceTag): void {
    mesh.updateWorldMatrix(true, false);
    this.addGeometry(mesh.geometry, mesh.matrixWorld, tag);
  }

  build(): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    this.tagAttr = new Float32Array(this.tag);
    this.bvh = new MeshBVH(g);
    this.pos = [];
    this.tag = [];
    this.glass.build();
  }

  /**
   * Second BVH, construit après le premier avec ce qui a été ajouté depuis (`addGeometry`, `addMesh`) : les décors
   * proches des cibles, connus seulement une fois celles-ci posées. Balles et lignes de visée voient les deux.
   */
  buildExtra(): number {
    const n = this.pos.length / 9;
    if (!n) return 0;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    this.tagAttr2 = new Float32Array(this.tag);
    this.bvh2 = new MeshBVH(g);
    this.pos = [];
    this.tag = [];
    return n;
  }
  private bvh2: MeshBVH | null = null;
  private tagAttr2!: Float32Array;

  /** Premier impact sur le segment a→b. Renvoie la distance depuis a, ou -1. */
  segment(a: Vector3, b: Vector3, outPoint?: Vector3, outTag?: { tag: SurfaceTag }): number {
    if (!this.bvh) return -1;
    const d = this.tmp.copy(b).sub(a);
    const len = d.length();
    if (len < 1e-6) return -1;
    this.ray.origin.copy(a);
    this.ray.direction.copy(d).divideScalar(len);
    let bvh = this.bvh, tags = this.tagAttr;
    let hit = bvh.raycastFirst(this.ray, DoubleSide, 0, len) as any;
    if (this.bvh2) {
      const h2 = this.bvh2.raycastFirst(this.ray, DoubleSide, 0, hit ? hit.distance : len) as any;
      if (h2 && (!hit || h2.distance < hit.distance)) { hit = h2; bvh = this.bvh2; tags = this.tagAttr2; }
    }
    if (!hit) return -1;
    if (outPoint) outPoint.copy(hit.point);
    if (outTag) {
      const index = bvh.geometry.getIndex()!;
      outTag.tag = TAGS[tags[index.getX(hit.faceIndex * 3)]] ?? 'stone';
    }
    return hit.distance;
  }

  /**
   * Distance, le long de l'axe, du premier triangle qui entre dans le cône d'axe (origine o, direction unitaire d) et
   * de demi-angle atan(tanA), jusqu'à `max` ; `max` si rien. Sert à placer le plan proche de la lunette : les objets
   * minces (garde-corps, mât) comptent, pas seulement ce que touche un rayon.
   */
  coneNearest(o: Vector3, d: Vector3, tanA: number, max: number): number {
    if (!this.bvh) return max;
    let best = max;
    const seg = this.coneSeg, c = this.tmp, p1 = this.coneP1, p2 = this.coneP2;
    seg.start.copy(o).addScaledVector(d, 0.3);
    this.bvh.shapecast({
      intersectsBounds: (box) => {
        box.getCenter(c);
        const r = c.distanceTo(box.max);
        c.sub(o);
        const t = c.dot(d);
        if (t - r > best || t + r < 0.3) return false;
        const lat = Math.sqrt(Math.max(0, c.lengthSq() - t * t));
        return lat <= r + (t + r) * tanA + 0.05;
      },
      intersectsTriangle: (tri) => {
        seg.end.copy(o).addScaledVector(d, best);
        const dist = (tri as any).closestPointToSegment(seg, p1, p2) as number;
        const t = p2.sub(o).dot(d);
        if (dist <= t * tanA + 0.03 && t < best) best = Math.max(0.3, t);
        return false;
      },
    });
    return best;
  }
  private coneSeg = new Line3();
  private coneP1 = new Vector3();
  private coneP2 = new Vector3();

  /** Hauteur de la surface de marche la plus haute sous (x, z) ne dépassant pas y + marge ; -Infinity si aucune. */
  surfaceAt(x: number, z: number, y: number, out?: { kind: 'stone' | 'wood' }): number {
    let best = -Infinity;
    for (const s of this.surfaces) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const h = s.h(x, z);
      if (h <= y + 0.55 && h > best) {
        best = h;
        if (out) out.kind = s.kind;
      }
    }
    return best;
  }

  /** Repousse un cercle (x, z, rayon) hors des segments qui recoupent la tranche verticale [y, y + hauteur]. */
  resolve(p: { x: number; z: number }, radius: number, y: number, height: number): void {
    for (let it = 0; it < 2; it++)
      for (const s of this.segs) {
        if (y + height < s.y0 || y + 0.35 > s.y1) continue;
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz;
        if (s.box) {
          const L = Math.sqrt(l2);
          const ux = dx / L, uz = dz / L;
          const u = (p.x - s.ax) * ux + (p.z - s.az) * uz;
          const v = -(p.x - s.ax) * uz + (p.z - s.az) * ux;
          const cu = u < 0 ? 0 : u > L ? L : u;
          const cv = v < -s.r ? -s.r : v > s.r ? s.r : v;
          let eu = u - cu, ev = v - cv;
          const d = Math.hypot(eu, ev);
          if (d >= radius) continue;
          let nu: number, nv: number;
          if (d < 1e-5) {
            // centre dans le mur : sortie par la face la plus proche
            const pu = Math.min(u, L - u), pv = s.r - Math.abs(v);
            if (pv <= pu) { eu = 0; ev = v >= 0 ? 1 : -1; nu = u; nv = (s.r + radius) * ev; }
            else { ev = 0; eu = u < L / 2 ? -1 : 1; nu = eu < 0 ? -radius : L + radius; nv = v; }
          } else { nu = cu + (eu / d) * radius; nv = cv + (ev / d) * radius; }
          p.x = s.ax + ux * nu - uz * nv;
          p.z = s.az + uz * nu + ux * nv;
          continue;
        }
        let t =((p.x - s.ax) * dx + (p.z - s.az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = s.ax + dx * t, qz = s.az + dz * t;
        let ex = p.x - qx, ez = p.z - qz;
        const d = Math.hypot(ex, ez);
        const min = radius + s.r;
        if (d < min) {
          if (d < 1e-5) { ex = -dz; ez = dx; const l = Math.hypot(ex, ez); ex /= l; ez /= l; } else { ex /= d; ez /= d; }
          p.x = qx + ex * min;
          p.z = qz + ez * min;
        }
      }
  }
}
