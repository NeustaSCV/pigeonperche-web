// Vitres : la balle les traverse, mais elles se brisent. Les triangles vitrés (bâtiments de la banque, fenêtres du
// kit) sont regroupés en carreaux ; un BVH à part dit quels carreaux un segment de vol traverse. Rien ici n'arrête ni
// ne dévie la balle : c'est un retour visuel et sonore, gradué par l'énergie à l'impact (voir GlassFx).
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface Pane {
  center: Vector3;
  /** normale du carreau, puis axe horizontal et axe montant dans son plan */
  n: Vector3; u: Vector3; v: Vector3;
  /** demi-largeur et demi-hauteur, m */
  hu: number; hv: number;
  /** 0 intact, 1 fêlé, 2 brisé */
  state: 0 | 1 | 2;
  /** emplacement du visuel posé dessus (GlassFx), −1 si aucun */
  slot: number;
}

export class Glass {
  panes: Pane[] = [];
  private pos: number[] = [];
  private bvh: MeshBVH | null = null;
  /** carreau de chaque triangle, dans l'ordre d'origine */
  private paneOf!: Int32Array;
  private ray = new Ray();
  private tmp = new Vector3();

  /** Ajoute des triangles vitrés (géométrie indexée ou non), passés en espace monde par `m`. */
  add(g: BufferGeometry, m: Matrix4 | null): void {
    const p = g.getAttribute('position'), idx = g.getIndex(), v = this.tmp;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, idx ? idx.getX(i) : i);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
    }
  }

  /** Regroupe les triangles en carreaux (triangles qui se touchent) et construit le BVH. */
  build(): void {
    const P = this.pos, T = P.length / 9;
    this.pos = [];
    if (!T) return;
    // union des triangles qui partagent un sommet (au centimètre)
    const parent = new Int32Array(T).map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const seen = new Map<string, number>();
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${Math.round(P[o] * 100)},${Math.round(P[o + 1] * 100)},${Math.round(P[o + 2] * 100)}`;
      const other = seen.get(key);
      if (other === undefined) seen.set(key, t);
      else { const a = find(t), b = find(other); if (a !== b) parent[a] = b; }
    }
    const groups = new Map<number, number[]>();
    for (let t = 0; t < T; t++) { const r = find(t); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(t); }
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), q = new Vector3();
    const keep: number[] = [];
    const paneOf: number[] = [];
    for (const tris of groups.values()) {
      // normale : celle de la plus grande face
      let bestA = 0;
      const nn = new Vector3(0, 0, 1);
      for (const t of tris) {
        a.fromArray(P, t * 9); b.fromArray(P, t * 9 + 3); c.fromArray(P, t * 9 + 6);
        n.subVectors(b, a).cross(q.subVectors(c, a));
        const area = n.length();
        if (area > bestA) { bestA = area; nn.copy(n).divideScalar(area); }
      }
      // surface à plat (eau d'un bassin, verrière couchée) : pas un carreau à briser
      if (bestA < 1e-6 || Math.abs(nn.y) > 0.7) continue;
      const u = new Vector3(nn.z, 0, -nn.x).normalize(), v = new Vector3().crossVectors(nn, u);
      if (v.y < 0) v.negate();
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, d0 = Infinity, d1 = -Infinity;
      for (const t of tris) for (let k = 0; k < 3; k++) {
        q.fromArray(P, t * 9 + k * 3);
        const pu = q.dot(u), pv = q.dot(v), pd = q.dot(nn);
        u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); d0 = Math.min(d0, pd); d1 = Math.max(d1, pd);
      }
      const center = new Vector3().addScaledVector(u, (u0 + u1) / 2).addScaledVector(v, (v0 + v1) / 2).addScaledVector(nn, (d0 + d1) / 2);
      const pane: Pane = { center, n: nn, u, v, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, state: 0, slot: -1 };
      if (pane.hu < 0.05 || pane.hv < 0.05) continue;
      for (const t of tris) { keep.push(t); paneOf.push(this.panes.length); }
      this.panes.push(pane);
    }
    if (!keep.length) return;
    const arr = new Float32Array(keep.length * 9);
    keep.forEach((t, i) => { for (let k = 0; k < 9; k++) arr[i * 9 + k] = P[t * 9 + k]; });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(arr, 3));
    // le BVH réordonne les triangles par son index : `paneOf` se lit à travers lui
    this.paneOf = Int32Array.from(paneOf);
    this.bvh = new MeshBVH(g);
  }

  /**
   * Carreaux traversés par a→b sur les `max` premiers mètres, du plus proche au plus loin, chacun une fois.
   * `out` reçoit (carreau, distance depuis a) ; renvoie leur nombre.
   */
  cross(a: Vector3, b: Vector3, max: number, out: { pane: Pane; d: number }[]): number {
    out.length = 0;
    if (!this.bvh) return 0;
    const d = this.tmp.copy(b).sub(a), len = d.length();
    if (len < 1e-6) return 0;
    this.ray.origin.copy(a);
    this.ray.direction.copy(d).divideScalar(len);
    const hits = this.bvh.raycast(this.ray, DoubleSide, 0, Math.min(len, max)) as any[];
    if (!hits.length) return 0;
    const index = this.bvh.geometry.getIndex()!;
    hits.sort((p, q) => p.distance - q.distance);
    for (const h of hits) {
      const pane = this.panes[this.paneOf[index.getX(h.faceIndex * 3) / 3]];
      if (!out.some((o) => o.pane === pane)) out.push({ pane, d: h.distance });
    }
    return out.length;
  }
}
