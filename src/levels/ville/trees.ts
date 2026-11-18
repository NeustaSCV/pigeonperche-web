// Ville nouvelle : les arbres des données (un houppier irrégulier chacun, un tronc près des emplacements), instanciés
// par pavé d'un quart de dalle, chaque pavé avec sa sphère englobante.
import { BufferAttribute, Color, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry } from 'three';
import type { Engine } from '../../core/engine';
import { BASSIN, CANAL_W, MANEGE, hash, inPoly, type VilleWorld } from './data';
import { SUB } from './buildings';
import { lit } from './shade';

/** Houppier : icosaèdre déformé, plus sombre en dessous, normales lissées. */
function crown(detail: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);   // déjà sans index : trois sommets par face
  const p = g.attributes.position, col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.80 + 0.40 * hash(Math.round(x * 50), Math.round(z * 50), Math.round(y * 50));
    const yy = y < 0 ? y * 0.72 : y;
    p.setXYZ(i, x * k, yy * (0.9 + 0.2 * k), z * k);
    const sh = 0.50 + 0.50 * Math.min(1, Math.max(0, (y + 0.9) / 1.6));
    col.push(sh, sh, sh);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // moyenne des normales par position, pour éviter l'effet « boule à facettes »
  const acc = new Map<string, number[]>(), n = g.attributes.normal;
  const key = (i: number): string => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
  for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)) ?? [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(key(i), a); }
  for (let i = 0; i < p.count; i++) { const a = acc.get(key(i))!; const l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  return g;
}

export function buildTrees(engine: Engine, w: VilleWorld): { group: Group; kept: number; dropped: number } {
  const { raw, NT, TS, OX, OZ, bendY } = w;
  const trees = raw.arbres, nTrees = trees.length / 8;
  // tri et écartement d'après les positions d'origine du fichier (comme les arbres ont été relevés)
  const EMP = raw.emplacements;
  const posts: [number, number][] = [...Object.values(raw.meta.postes).map((p): [number, number] => [p[0], p[2]]), ...raw.meta.grues.map((c): [number, number] => [c.x, c.z])];
  const G = NT * SUB, CS = TS / SUB;
  const cells: { near: number[]; far: number[] }[] = Array.from({ length: G * G }, () => ({ near: [], far: [] }));
  let dropped = 0;
  for (let i = 0; i < nTrees; i++) {
    const x = trees[i * 8], z = trees[i * 8 + 2], r = trees[i * 8 + 4], g = trees[i * 8 + 5], b = trees[i * 8 + 6];
    // faux arbres (toits clairs, tuiles), arbres dans l'eau ou sur le manège
    if (((r + g + b) / 3 > 0.42 && !(g > r && g > b)) || (r > g * 1.25 && r > 0.35) || inPoly(x, z, BASSIN) || Math.hypot(x - MANEGE[0], z - MANEGE[1]) < MANEGE[2] + 3 || w.nearCanal(x, z, CANAL_W / 2 + 0.5)) { dropped++; continue; }
    // rien ne pousse contre un emplacement à hauteur du tireur
    if (EMP.some((e) => Math.hypot(x - e.x, z - e.z) < (e.type === 'arbre' ? 7 : 16) + trees[i * 8 + 3] * 0.3 && trees[i * 8 + 1] + trees[i * 8 + 3] > e.y - 5)) { dropped++; continue; }
    const near = posts.some((p) => Math.hypot(x - p[0], z - p[1]) < 650) || EMP.some((e) => Math.hypot(x - e.x, z - e.z) < 230);
    const ci = Math.min(G - 1, Math.max(0, Math.floor((z - OZ) / CS))) * G + Math.min(G - 1, Math.max(0, Math.floor((x - OX) / CS)));
    (near ? cells[ci].near : cells[ci].far).push(i);
  }
  const group = new Group();
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), t = new Vector3(), c = new Color(), UP = new Vector3(0, 1, 0);
  const greens = [new Color(0x4c6b34), new Color(0x5f7d3a), new Color(0x3f5f33), new Color(0x6b8540)];
  const crowns = [crown(0), crown(1)];
  const trunk = new CylinderGeometry(0.5, 0.7, 1, 6, 1, true).translate(0, 0.5, 0);
  const leafMat = lit(engine, { vertexColors: true }, 'arbre'), trunkMat = lit(engine, { color: 0x4a3c30 }, 'tronc');
  const finish = (im: InstancedMesh): void => { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; group.add(im); };
  for (const cell of cells) {
    for (const [list, detail] of [[cell.near, 1], [cell.far, 0]] as [number[], number][]) {
      if (!list.length) continue;
      const im = new InstancedMesh(crowns[detail], leafMat, list.length);
      const trunks = detail === 1 ? new InstancedMesh(trunk, trunkMat, list.length) : null;
      list.forEach((i, n) => {
        const x = trees[i * 8], y = trees[i * 8 + 1] + bendY(trees[i * 8], trees[i * 8 + 2]), z = trees[i * 8 + 2], h = trees[i * 8 + 3];
        const r = Math.max(1.8, h * (0.27 + 0.10 * hash(x, z)));
        const ch = Math.min(h * 0.58, r * 1.55);
        t.set(x, y + h - ch * 0.95, z);
        q.setFromAxisAngle(UP, hash(x, z, 3) * 6.28);
        s.set(r, ch, r);
        im.setMatrixAt(n, m.compose(t, q, s));
        c.setRGB(trees[i * 8 + 4], trees[i * 8 + 5], trees[i * 8 + 6], SRGBColorSpace).lerp(greens[Math.floor(hash(x, z, 9) * 4)], 0.6).multiplyScalar(0.95 + 0.35 * hash(x, z, 5));
        im.setColorAt(n, c);
        if (trunks) { t.set(x, y - 0.3, z); s.set(0.16 + h * 0.012, Math.max(1, h - ch * 1.6), 0.16 + h * 0.012); trunks.setMatrixAt(n, m.compose(t, q, s)); }
      });
      if (im.instanceColor) (im.instanceColor as BufferAttribute).needsUpdate = true;
      finish(im);
      if (trunks) finish(trunks);
    }
  }
  return { group, kept: nTrees - dropped, dropped };
}
