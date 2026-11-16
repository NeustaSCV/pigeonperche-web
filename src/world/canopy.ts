// Feuillage : une balle qui traverse la couronne d'un arbre fait tomber feuilles et brindilles, ce qui montre où elle
// est passée. Rien n'est arrêté ni dévié. Les couronnes sont relevées sur les arbres déjà posés (instances au
// feuillage découpé), approchées par des ellipsoïdes droits et rangées dans une grille.
import { Box3, Matrix4, Vector3, type InstancedMesh, type Material, type Mesh, type Object3D } from 'three';

const CELL = 16;
/** en dessous de cette hauteur (m), ce n'est pas un arbre (touffe, arbuste, herbe) */
const MIN_HEIGHT = 3.2;

export class Canopies {
  /** x, y, z du centre, rayon horizontal, rayon vertical : cinq nombres par couronne */
  data: number[] = [];
  private grid = new Map<number, number[]>();
  private key = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

  get count(): number { return this.data.length / 5; }

  /** Relève les couronnes des arbres de `root` (maillages instanciés dont la matière est découpée). */
  collect(root: Object3D): void {
    const m4 = new Matrix4(), box = new Box3(), size = new Vector3(), c = new Vector3();
    const seen = new Map<string, number>();
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const im = o as InstancedMesh;
      if (!im.isInstancedMesh) return;
      const mat = (Array.isArray(im.material) ? im.material[0] : im.material) as Material | undefined;
      if (!mat || !(mat.alphaTest > 0)) return;
      const g = (im as unknown as Mesh).geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        box.copy(g.boundingBox!).applyMatrix4(m4.premultiply(im.matrixWorld));
        box.getSize(size);
        if (size.y < MIN_HEIGHT) continue;
        box.getCenter(c);
        // un imposteur couvre l'arbre entier, tronc compris : la couronne en est les deux tiers hauts
        const top = box.max.y, bottom = box.min.y + size.y * 0.3;
        const ry = (top - bottom) / 2, rh = Math.max(size.x, size.z) * 0.36;
        const k = `${Math.round(c.x)},${Math.round(c.z)}`;
        const at = seen.get(k);
        // détail et imposteur du même arbre : un seul volume, le plus grand
        if (at !== undefined) { if (rh > this.data[at + 3]) { this.data[at + 3] = rh; this.data[at + 1] = bottom + ry; this.data[at + 4] = ry; } continue; }
        seen.set(k, this.data.length);
        this.data.push(c.x, bottom + ry, c.z, rh, ry);
      }
    });
    this.grid.clear();
    for (let i = 0; i < this.data.length; i += 5) {
      const x = this.data[i], z = this.data[i + 2], r = this.data[i + 3];
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
        for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
          const key = this.key(cx, cz);
          let l = this.grid.get(key);
          if (!l) this.grid.set(key, l = []);
          l.push(i / 5);
        }
    }
  }

  /**
   * Couronnes où le segment a→b entre (a dehors, segment sécant), hors celles de `skip`. Appelle `cb(index, point
   * d'entrée)`. Le segment est supposé court devant la maille (un pas de vol).
   */
  enter(a: Vector3, b: Vector3, skip: Set<number> | null, cb: (index: number, x: number, y: number, z: number) => void): void {
    if (!this.data.length) return;
    const l = this.grid.get(this.key(Math.floor(b.x / CELL), Math.floor(b.z / CELL)));
    if (!l) return;
    const D = this.data;
    for (const i of l) {
      if (skip?.has(i)) continue;
      const o = i * 5, rh = D[o + 3], ry = D[o + 4];
      // espace où l'ellipsoïde est une sphère unité
      const ax = (a.x - D[o]) / rh, ay = (a.y - D[o + 1]) / ry, az = (a.z - D[o + 2]) / rh;
      const dx = (b.x - a.x) / rh, dy = (b.y - a.y) / ry, dz = (b.z - a.z) / rh;
      const A = dx * dx + dy * dy + dz * dz, B = ax * dx + ay * dy + az * dz, C = ax * ax + ay * ay + az * az - 1;
      if (A < 1e-12) continue;
      const disc = B * B - A * C;
      if (disc < 0) continue;
      const t = C <= 0 ? 0 : (-B - Math.sqrt(disc)) / A;
      if (t < 0 || t > 1) continue;
      cb(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
  }
}
