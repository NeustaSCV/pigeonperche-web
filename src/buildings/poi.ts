// Points d'intérêt d'un bâtiment pour un tireur : ouvertures où poster une sentinelle ou une cible, toits plats et
// passerelles, sommet, points au sol relevés dans la fiche, et lisibilité des quatre faces vues de loin.
// Tout est calculé dans le repère local du bâtiment (origine au centre du lot, +x est, +z sud, y = 0 au sol).
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CollisionPart } from './convert';

/**
 * 'window', 'door', 'breach', 'opening' : ouvertures de mur ; 'roof' : plancher à ciel ouvert (toit-terrasse, plate-forme) ;
 * 'gallery' : plancher couvert d'où l'on voit dehors (galerie, balcon, passerelle, étage ouvert, clocher) ;
 * 'ground' : point au sol de la fiche ; 'summit' : point le plus haut.
 */
export type PoiKind = 'window' | 'door' | 'breach' | 'opening' | 'roof' | 'gallery' | 'ground' | 'summit';
export interface Poi {
  kind: PoiKind;
  /** ouverture : son centre ; toit, sol : là où poser les pieds ; sommet : le point le plus haut */
  x: number; y: number; z: number;
  /** direction horizontale vers l'extérieur (unitaire, locale) ; (0, 0) si sans objet */
  nx: number; nz: number;
  /** la même direction en cap du jeu, radians : avant = (sin, −cos), 0 = −z local */
  bearing: number;
  /** taille de l'ouverture ; pour un toit ou une galerie, étendue du plancher en x et en z (m) */
  width: number; height: number;
  /** où poser les pieds d'une sentinelle (derrière l'ouverture, ou sur le replat) ; null si rien de praticable */
  stand: { x: number; y: number; z: number } | null;
  /** hauteur de l'appui au-dessus des pieds (ouvertures) : entre 0,6 et 1,3 m on voit le buste */
  sill?: number;
  /**
   * part de l'ouverture qu'une balle traverse (ouvertures) : 5 tirs d'essai, au centre et aux quatre quarts.
   * 0 : bouchée (planches, grille pleine, menuiserie du modèle) ; 0,8 : libre sauf au centre (meneau de pierre).
   */
  clear?: number;
  /** part des vitres encore en place (fenêtres) */
  glass?: number;
  /** rectangle local englobant le plancher (toits, galeries) : pour en faire une surface de marche */
  rect?: { x0: number; x1: number; z0: number; z1: number };
  /** surface du plancher (toits, galeries), m² */
  area?: number;
  note?: string;
  source: 'auto' | 'fiche' | 'manual';
}
export interface FaceInfo {
  /** face vue depuis ce côté : 'S' = on regarde la façade sud (normale +z) */
  side: 'N' | 'E' | 'S' | 'W';
  nx: number; nz: number;
  /** largeur et hauteur de la silhouette (m) */
  width: number; height: number;
  /** part de la silhouette réellement pleine (0 à 1) */
  fill: number;
  /** ouvertures donnant sur l'extérieur de ce côté */
  openings: number;
  /** note de lisibilité de loin (surface pleine × ouvertures) : la plus haute en premier */
  score: number;
}
export interface PoiSet {
  points: Poi[];
  faces: FaceInfo[];
}
export interface OpeningRecord {
  type: string;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  l: number; h: number;
  ep?: number;
  vitre?: number;
}
export interface FichePoint { x: number; z: number; note: string; kind: 'ground' | 'door' }

/** points d'essai dans une ouverture, en fractions de sa largeur et de sa hauteur */
export const PROBES: [number, number][] = [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
const bearingOf = (nx: number, nz: number): number => Math.atan2(nx, -nz);

export function computePoi(collision: CollisionPart[], openings: OpeningRecord[], fichePoints: FichePoint[], maxOpenings = 48): PoiSet {
  // un seul BVH sur tout ce qui arrête une balle (sans les vitres)
  let n = 0;
  for (const p of collision) if (p.tag !== 'glass') n += p.geometry.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of collision) {
    if (p.tag === 'glass') continue;
    const a = p.geometry.getAttribute('position').array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const points: Poi[] = [];
  const faces: FaceInfo[] = [];
  if (!n) return { points, faces };
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const bvh = new MeshBVH(g);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const ray = new Ray();
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): any => {
    ray.origin.set(ox, oy, oz);
    ray.direction.set(dx, dy, dz);
    return bvh.raycastFirst(ray, DoubleSide, 0, far);
  };
  const floorUnder = (x: number, y: number, z: number): number => {
    const h = cast(x, y, z, 0, -1, 0, y + 0.5);
    return h ? h.point.y : 0;
  };

  // --- ouvertures relevées par mur() ---
  const ops: Poi[] = [];
  for (const r of openings) {
    if (r.l < 0.45 || r.h < 0.45) continue;
    let nx = r.nx, nz = r.nz;
    const len = Math.hypot(nx, nz);
    if (len < 0.5) continue;
    nx /= len; nz /= len;
    const e = (r.ep ?? 0.3) / 2 + 0.25;
    // de quel côté est le dehors ? 25 m libres devant l'ouverture
    const out = !cast(r.x + nx * e, r.y, r.z + nz * e, nx, 0, nz, 25);
    const back = !cast(r.x - nx * e, r.y, r.z - nz * e, -nx, 0, -nz, 25);
    if (!out && !back) continue;
    if (!out && back) { nx = -nx; nz = -nz; }
    // une balle passe-t-elle ? au centre et aux quatre quarts, de 3 m dehors à 0,5 m derrière le mur
    let clear = 0;
    for (const [fu, fv] of PROBES) {
      const ox = r.x - nz * fu * r.l, oy = r.y + fv * r.h, oz = r.z + nx * fu * r.l;
      if (!cast(ox + nx * 3, oy, oz + nz * 3, -nx, 0, -nz, 3 + e + 0.25)) clear++;
    }
    clear /= PROBES.length;
    const sx = r.x - nx * (e + 0.35), sz = r.z - nz * (e + 0.35);
    const bottom = r.y - r.h / 2;
    const fy = floorUnder(sx, bottom + 0.3, sz);
    const sill = bottom - fy;
    const practicable = clear > 0 && sill <= 1.45 && bottom + r.h - fy >= 1.15 && fy > -0.5;
    const kind: PoiKind = r.type === 'fenetre' ? 'window' : r.type === 'porte' ? 'door' : r.type === 'breche' ? 'breach' : 'opening';
    ops.push({
      kind, x: r.x, y: r.y, z: r.z, nx, nz, bearing: bearingOf(nx, nz), width: r.l, height: r.h,
      stand: practicable ? { x: sx, y: fy, z: sz } : null, sill, clear, glass: r.vitre ?? 0, source: 'auto',
    });
  }
  // les plus hautes et les plus grandes d'abord
  ops.sort((a, b) => (b.stand ? 1 : 0) - (a.stand ? 1 : 0) || b.y * 2 + b.width * b.height - (a.y * 2 + a.width * a.height));
  points.push(...ops.slice(0, maxOpenings));

  // --- planchers en hauteur d'où l'on voit dehors : toits-terrasses, galeries, balcons, passerelles, étages ouverts ---
  // Sur une grille de 1 m, un rayon descend du ciel et traverse tout : chaque face horizontale tournée vers le haut,
  // avec 1,9 m libres au-dessus, est un plancher. On garde les cases d'où un regard à hauteur de buste part vers
  // l'extérieur sans rien toucher sur 40 m (8 directions, légèrement montantes : le tireur est plus haut que la cible).
  const x0 = Math.floor(bb.min.x), z0 = Math.floor(bb.min.z);
  const w = Math.max(1, Math.ceil(bb.max.x) - x0), d = Math.max(1, Math.ceil(bb.max.z) - z0);
  const top = bb.max.y + 1;
  const DIRS: [number, number][] = [[0, 1], [0.707, 0.707], [1, 0], [0.707, -0.707], [0, -1], [-0.707, -0.707], [-1, 0], [-0.707, 0.707]];
  interface Cell { i: number; j: number; y: number; open: boolean; mask: number }
  const cells: Cell[] = [];
  const byColumn = new Map<number, Cell[]>();
  let sx = 0, sy = -1e3, sz = 0;
  for (let j = 0; j < d; j++)
    for (let i = 0; i < w; i++) {
      const px = x0 + i + 0.5, pz = z0 + j + 0.5;
      let from = top, above = Infinity, first = true;
      for (let guard = 0; guard < 12 && from > 2.2; guard++) {
        const h = cast(px, from, pz, 0, -1, 0, from - 2.1);
        if (!h) break;
        const y = h.point.y;
        if (first) { first = false; if (y > sy) { sy = y; sx = px; sz = pz; } }
        const up = h.face ? h.face.normal.y : 0;
        if (up > 0.97 && above - y >= 1.9) {
          let mask = 0;
          for (let k = 0; k < 8; k++) if (!cast(px, y + 1.35, pz, DIRS[k][0] * 0.995, 0.1, DIRS[k][1] * 0.995, 40)) mask |= 1 << k;
          if (mask) {
            const c: Cell = { i, j, y, open: above === Infinity, mask };
            cells.push(c);
            const key = j * w + i;
            const list = byColumn.get(key);
            if (list) list.push(c); else byColumn.set(key, [c]);
          }
        }
        above = y;
        from = y - 0.06;
      }
    }
  const done = new Set<Cell>();
  const decks: Poi[] = [];
  for (const seed of cells) {
    if (done.has(seed)) continue;
    const group: Cell[] = [seed];
    done.add(seed);
    for (let q = 0; q < group.length; q++) {
      const c = group[q];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = c.i + di, nj = c.j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
        for (const n2 of byColumn.get(nj * w + ni) ?? []) {
          if (done.has(n2) || Math.abs(n2.y - c.y) > 0.25 || n2.open !== c.open) continue;
          done.add(n2);
          group.push(n2);
        }
      }
    }
    if (group.length < (seed.open ? 6 : 2)) continue;
    // direction dominante vers l'extérieur
    const votes = new Array(8).fill(0);
    let mi = 0, mj = 0, my = 0, i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
    for (const c of group) {
      for (let k = 0; k < 8; k++) if (c.mask & (1 << k)) votes[k]++;
      mi += c.i; mj += c.j; my += c.y;
      i0 = Math.min(i0, c.i); i1 = Math.max(i1, c.i); j0 = Math.min(j0, c.j); j1 = Math.max(j1, c.j);
    }
    mi /= group.length; mj /= group.length; my /= group.length;
    let kd = 0;
    for (let k = 1; k < 8; k++) if (votes[k] > votes[kd]) kd = k;
    // la case qui voit dans cette direction la plus proche du centre du plancher
    let best: Cell | null = null, bd = 1e9;
    for (const c of group) {
      if (!(c.mask & (1 << kd))) continue;
      const dd = Math.hypot(c.i - mi, c.j - mj);
      if (dd < bd) { bd = dd; best = c; }
    }
    if (!best) continue;
    const px = x0 + best.i + 0.5, pz = z0 + best.j + 0.5;
    const open8 = votes.filter((v) => v > group.length * 0.3).length;
    decks.push({
      kind: seed.open ? 'roof' : 'gallery', x: px, y: best.y, z: pz,
      nx: open8 >= 7 ? 0 : DIRS[kd][0], nz: open8 >= 7 ? 0 : DIRS[kd][1], bearing: open8 >= 7 ? 0 : bearingOf(DIRS[kd][0], DIRS[kd][1]),
      width: i1 - i0 + 1, height: j1 - j0 + 1, stand: { x: px, y: best.y, z: pz }, area: group.length,
      rect: { x0: x0 + i0, x1: x0 + i1 + 1, z0: z0 + j0, z1: z0 + j1 + 1 }, source: 'auto',
    });
  }
  decks.sort((a, b) => b.y * Math.sqrt(b.area!) - a.y * Math.sqrt(a.area!));
  points.push(...decks.filter((p) => p.kind === 'roof').slice(0, 10), ...decks.filter((p) => p.kind === 'gallery').slice(0, 14));
  if (sy > 3) points.push({ kind: 'summit', x: sx, y: sy, z: sz, nx: 0, nz: 0, bearing: 0, width: 0, height: 0, stand: null, source: 'auto' });

  // --- points au sol de la fiche (apparitions du jeu d'origine, entrées) ---
  for (const f of fichePoints) {
    if (f.x < bb.min.x - 2 || f.x > bb.max.x + 2 || f.z < bb.min.z - 2 || f.z > bb.max.z + 2) continue;
    const fy = floorUnder(f.x, 2.2, f.z);
    points.push({ kind: f.kind, x: f.x, y: fy, z: f.z, nx: 0, nz: 0, bearing: 0, width: 0, height: 0, stand: { x: f.x, y: fy, z: f.z }, note: f.note, source: 'fiche' });
  }

  // --- lisibilité des quatre faces : rayons horizontaux sur une grille de 1 m ---
  const sides: [FaceInfo['side'], number, number][] = [['S', 0, 1], ['E', 1, 0], ['N', 0, -1], ['W', -1, 0]];
  const hTop = Math.max(1, Math.ceil(bb.max.y));
  for (const [side, nx, nz] of sides) {
    const alongX = nx === 0;
    const a0 = alongX ? bb.min.x : bb.min.z, a1 = alongX ? bb.max.x : bb.max.z;
    const depth = (alongX ? bb.max.z - bb.min.z : bb.max.x - bb.min.x) + 2;
    const startC = alongX ? (nz > 0 ? bb.max.z + 1 : bb.min.z - 1) : nx > 0 ? bb.max.x + 1 : bb.min.x - 1;
    let hit = 0, tot = 0, maxY = 0;
    for (let a = Math.floor(a0) + 0.5; a < a1; a += 1)
      for (let y = 0.75; y < hTop; y += 1) {
        tot++;
        const h = alongX ? cast(a, y, startC, 0, 0, -nz, depth) : cast(startC, y, a, -nx, 0, 0, depth);
        if (h) { hit++; if (y > maxY) maxY = y; }
      }
    const openingsHere = ops.filter((p) => p.nx * nx + p.nz * nz > 0.7).length;
    const width = a1 - a0, height = maxY + 0.25;
    const fill = tot ? hit / tot : 0;
    faces.push({ side, nx, nz, width, height, fill, openings: openingsHere, score: Math.round(hit * (1 + 0.12 * Math.min(openingsHere, 16))) });
  }
  faces.sort((a, b) => b.score - a.score);
  return { points, faces };
}
