// Décors proches des cibles : tout ce qui s'y voit doit arrêter la balle et renvoyer le télémètre.
// Les niveaux n'enregistrent à la main que le gros œuvre (murs, bois, métal du kit) ; ce passage complète, une fois
// les cibles posées, avec les maillages opaques et fixes qui les entourent (toiles, mâts, rochers, mobilier, ornements
// des bâtiments…). Les vitres, translucides, restent traversables.
import { Matrix4, Sphere, Vector3, type InstancedMesh, type Material, type Mesh, type Object3D } from 'three';
import type { Colliders, SurfaceTag } from './colliders';

/** Matière qui n'arrête rien : translucide (vitre), sans écriture de profondeur, ou découpée (feuillage). */
const hollow = (mat: Material | undefined): boolean => !mat || mat.transparent || !mat.depthWrite || mat.alphaTest > 0;

/** Vrai pour ce qui ne doit pas entrer dans les collisions fixes : mobile, souple, masqué. */
function skipped(m: Mesh): boolean {
  if ((m as any).isSkinnedMesh) return true;
  if (!Array.isArray(m.material) && hollow(m.material)) return true;
  // bâtiment : sa version complète et sa version lointaine s'échangent selon la distance ; les deux comptent, quelle
  // que soit celle affichée au chargement
  let building = false;
  for (let o: Object3D | null = m; o; o = o.parent) if (o.name.startsWith('building')) building = true;
  for (let o: Object3D | null = m; o; o = o.parent) if ((!o.visible && !building) || o.userData.moving || o.userData.soft) return true;
  return false;
}

const tagOf = (m: Mesh): SurfaceTag => (/rock|stone|pierre/i.test(m.name + ' ' + ((m.material as Material)?.name ?? '')) ? 'rock' : 'metal');

/**
 * Ajoute aux collisions les triangles des maillages de `roots` situés à moins de `radius` d'un des `centers`.
 * À appeler après `col.build()` et avant `col.buildExtra()`. Renvoie le nombre de triangles ajoutés.
 */
export function solidifyAround(roots: Object3D[], centers: Vector3[], radius: number, col: Colliders): number {
  if (!centers.length) return 0;
  const sph = new Sphere(), a = new Vector3(), b = new Vector3(), c = new Vector3(), mid = new Vector3();
  const im = new Matrix4(), wm = new Matrix4();
  const tri: number[] = [];
  let added = 0;
  const near = (p: Vector3, r: number, list: Vector3[]): boolean => {
    for (const q of list) if (p.distanceToSquared(q) < (radius + r) * (radius + r)) return true;
    return false;
  };
  const addFrom = (m: Mesh, world: Matrix4, tag: SurfaceTag): void => {
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sph.copy(g.boundingSphere!).applyMatrix4(world);
    const close = centers.filter((q) => q.distanceTo(sph.center) < radius + sph.radius);
    if (!close.length) return;
    const pos = g.getAttribute('position'), idx = g.getIndex();
    if (!pos) return;
    const n = idx ? idx.count : pos.count;
    tri.length = 0;
    // plusieurs matières : les groupes translucides (vitres d'un bâtiment) restent traversables
    const mats = Array.isArray(m.material) ? m.material : null;
    const open = mats ? g.groups.filter((gr) => hollow(mats[gr.materialIndex ?? 0])) : [];
    for (let i = 0; i + 2 < n; i += 3) {
      if (open.some((gr) => i >= gr.start && i < gr.start + gr.count)) continue;
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(world);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(world);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(world);
      mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      if (!near(mid, Math.max(mid.distanceTo(a), mid.distanceTo(b), mid.distanceTo(c)), close)) continue;
      tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    if (tri.length) { col.addTriangles(tri, tag); added += tri.length / 9; }
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.geometry || skipped(m)) return;
      const tag = tagOf(m);
      const inst = m as unknown as InstancedMesh;
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, im);
          addFrom(m, wm.multiplyMatrices(m.matrixWorld, im), tag);
        }
      } else addFrom(m, m.matrixWorld, tag);
    });
  }
  return added;
}
