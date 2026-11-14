// Terrain libre autour du site de tir : au-delà des zones dessinées à la main (cour, dalles, brèches), le joueur
// marche partout où le sol le porte, jusqu'à une limite PHYSIQUE et lisible — le rebord où la pente casse, un mur,
// un rocher — et, là où rien de naturel ne l'arrête (plateau ouvert derrière le site), une clôture posée ici.
import { Vector3 } from 'three';
import type { GeoBuilder } from '../core/builder';
import type { Colliders } from './colliders';
import type { Terrain } from './terrain';

export interface RoamSpec {
  /** rayon de la zone autour de l'origine (m) : au-delà, clôture si le terrain reste praticable */
  radius: number;
  /** pente (m/m) à partir de laquelle on ne s'engage plus : le bord d'une corniche, d'un coteau (défaut 0,45 ≈ 24°) */
  maxSlope?: number;
  /** dénivelé maximal sous le sol du site (m ; défaut 9) */
  drop?: number;
}

export interface Roam {
  spec: Required<RoamSpec>;
  /** le point est-il praticable (pente, dénivelé, rayon) ? */
  allowed(x: number, z: number): boolean;
  /** nature de la limite en un point non praticable : pente trop raide, ou clôture du site */
  limit(x: number, z: number): 'pente' | 'cloture' | null;
  slope(x: number, z: number): number;
  /** à-pic : sol à plus de 4,2 m sous le site — même le cœur du site (ses postes en contrebas compris) s'arrête là */
  cliff(x: number, z: number): boolean;
}

/**
 * `core(x, z)` : le cœur du site, praticable quoi qu'en dise le relief (cour, dalles, postes) ; `from` : un point
 * du cœur. Seul le terrain qu'on peut REJOINDRE à pied depuis là est praticable : un replat isolé derrière un
 * ressaut (le pied d'un cône de vue, par exemple) ne l'est pas, et ne reçoit pas de clôture.
 */
export function makeRoam(terrain: Terrain, baseY: number, spec: RoamSpec, core: (x: number, z: number) => boolean = () => false, from: { x: number; z: number } = { x: 0, z: 0 }): Roam {
  const S: Required<RoamSpec> = { radius: spec.radius, maxSlope: spec.maxSlope ?? 0.45, drop: spec.drop ?? 9 };
  const slope = (x: number, z: number): number => {
    const e = 0.6;
    return Math.hypot(terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z), terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
  };
  const steep = (x: number, z: number): boolean => terrain.heightAt(x, z) < baseY - S.drop || slope(x, z) > S.maxSlope;
  // terrain joignable : remplissage par diffusion sur une grille de 1 m, depuis le cœur du site
  const G = 1, half = Math.ceil(S.radius / G) + 2, W = 2 * half + 1;
  const reach = new Uint8Array(W * W);
  const ok = (i: number, j: number): boolean => {
    const x = (i - half) * G, z = (j - half) * G;
    return core(x, z) || (Math.hypot(x, z) < S.radius && !steep(x, z));
  };
  {
    const si = Math.round(from.x / G) + half, sj = Math.round(from.z / G) + half;
    const stack = [sj * W + si];
    reach[sj * W + si] = 1;
    while (stack.length) {
      const k = stack.pop()!, i = k % W, j = (k - i) / W;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= W || nj >= W || reach[nj * W + ni] || !ok(ni, nj)) continue;
        reach[nj * W + ni] = 1;
        stack.push(nj * W + ni);
      }
    }
  }
  const joined = (x: number, z: number): boolean => {
    const i = Math.round(x / G) + half, j = Math.round(z / G) + half;
    return i >= 0 && j >= 0 && i < W && j < W && reach[j * W + i] === 1;
  };
  return {
    spec: S,
    slope,
    cliff: (x, z) => terrain.heightAt(x, z) < baseY - 4.2,
    allowed: (x, z) => Math.hypot(x, z) < S.radius && !steep(x, z) && joined(x, z),
    limit: (x, z) => (steep(x, z) ? 'pente' : Math.hypot(x, z) >= S.radius ? 'cloture' : joined(x, z) ? null : 'pente'),
  };
}

/**
 * Clôture du site : piquets et trois fils, posés sur le cercle de rayon `radius` partout où le terrain y est encore
 * praticable (ailleurs, c'est le relief qui arrête). Géométrie ajoutée au bâtisseur `b` du site (aucun appel de
 * dessin de plus) ; chaque travée entre dans les collisions de marche. `skip(x, z)` laisse un point sans clôture.
 * Renvoie la longueur posée (m).
 */
export function buildRoamFence(b: GeoBuilder, terrain: Terrain, col: Colliders, roam: Roam, skip: (x: number, z: number) => boolean = () => false): number {
  const R = roam.spec.radius - 0.7;
  const n = Math.round((2 * Math.PI * R) / 2.6);
  const UP = new Vector3(0, 1, 0);
  const pt = (i: number): Vector3 => {
    const a = (i / n) * Math.PI * 2;
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    return new Vector3(x, terrain.heightAt(x, z), z);
  };
  // une travée est posée si ses deux bouts sont praticables juste en deçà du cercle
  const open = (p: Vector3): boolean => roam.allowed(p.x * 0.985, p.z * 0.985) && !skip(p.x, p.z);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const a = pt(i), c = pt(i + 1);
    const oa = open(a), oc = open(c);
    if (oa) b.box(a.x, a.y + 0.6, a.z, 0.1, 1.4, 0.1, 1.2, (i / n) * Math.PI * 2);
    if (!oa || !oc) continue;
    const d = c.clone().sub(a), len = d.length();
    d.divideScalar(len);
    const side = new Vector3().crossVectors(UP, d).normalize(), up = new Vector3().crossVectors(d, side).normalize();
    for (const h of [0.45, 0.8, 1.15]) b.obox(a.clone().add(c).multiplyScalar(0.5).add(new Vector3(0, h, 0)), side, up, d, 0.012, 0.012, len / 2, 1.2);
    col.segs.push({ ax: a.x, az: a.z, bx: c.x, bz: c.z, r: 0.12, y0: Math.min(a.y, c.y) - 3, y1: Math.max(a.y, c.y) + 1.35 });
    length += len;
  }
  return length;
}
