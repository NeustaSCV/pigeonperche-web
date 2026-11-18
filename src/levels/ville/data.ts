// Ville nouvelle : données de la carte (public/ville/) et tout ce qui s'en calcule sans rien dessiner — relief,
// emprises creusées (bassin, canal), courbure de la carte, emplacements à leur place définitive. Aucun accès au
// réseau ni au DOM ici : les fichiers sont lus par l'appelant (le jeu par `fetch`, les tests par le disque).
import { placeEmplacements } from './emplacements';

/** la carte est légèrement convexe : le centre reste en place, les bords descendent de BOMBE mètres */
export const BOMBE = 16;
/** hauteur de l'œil du tireur debout au-dessus de son plancher (m) */
export const EYE = 1.6;
/** hauteur des grues à tour (m) */
export const CRANE_H = 46;

export interface Grue { nom: string; x: number; z: number; sol: number; cap: number }
export interface VilleMeta {
  /** côté de la carte (m), pas du relief (m), coin nord-ouest, nombre de dalles par côté */
  taille: number; pas: number; ox: number; oz: number; dalles: number;
  /** côté de la photographie lointaine (m), altitude moyenne du sol */
  lointain: number; altSol: number;
  eiffel: { azimut: number; distance: number; angleSommet: number; angleHorizon: number };
  postes: Record<string, [number, number, number]>;
  grues: Grue[];
}
export type Ring = [number, number][];
export interface Batiment {
  /** polygones : contour puis cours intérieures */
  p: Ring[][];
  /** altitudes du pied et du toit */
  b: number; r: number;
  /** usage, surface, centre */
  u: string; a: number; x: number; z: number;
  /** volumes de toiture : [x, z, largeur, profondeur, angle, altitude du dessus] */
  k: [number, number, number, number, number, number][];
}
export interface RawEmplacement { n: number; nom: string; type: string; x: number; y: number; z: number; sol: number; toit: number }
/** Emplacement à sa place définitive (coordonnées « à plat », sans la courbure). */
export interface Emplacement extends RawEmplacement {
  /** au sommet d'une grue */
  grue: boolean;
  /** décalage du tireur par rapport au centre du perchoir (cabane dans l'arbre, bord de la cuve) */
  ox: number; oz: number;
  /** position d'origine dans emplacements.json */
  x0: number; z0: number;
}
export interface Voie { p: Ring; w: number; n: string; i: number; s: string }
export interface StyleLabel { x: number; z: number; s: number; c: number | null; h: number }
export interface Eau { y: number; a: number; r: Ring[] }

export interface VilleRaw {
  meta: VilleMeta;
  bats: Batiment[];
  relief: Float32Array;
  /** huit nombres par arbre : x, y, z, hauteur, r, v, b, (réservé) */
  arbres: Float32Array;
  eau: Eau[];
  styles: StyleLabel[];
  voirie: Voie[];
  emplacements: RawEmplacement[];
  /** pour chaque emplacement (dans l'ordre), les numéros de ceux qu'il voit */
  visibles: number[][];
  /** voûte du centre aquatique : triangles (neuf nombres chacun) */
  dome: Float32Array;
}

/** fichiers de public/ville/ lus au chargement (images des dalles en plus : voir `tileImages`) */
export const FILES = { meta: 'ville/meta.json', bats: 'ville/batiments.json', relief: 'ville/relief.bin', arbres: 'ville/arbres.bin', eau: 'ville/eau.json', styles: 'ville/styles.json', voirie: 'ville/voirie.json', emplacements: 'ville/emplacements.json', dome: 'ville/dome_piscine.bin' };
export const tileImages = (n: number): string[] => { const out: string[] = []; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) out.push(`ville/dessin_${a}${b}.jpg`); return out; };

/** Lit les fichiers de la carte avec les deux lecteurs fournis (chemins relatifs à public/). */
export async function readVille(json: (path: string) => Promise<any>, bin: (path: string) => Promise<ArrayBuffer>): Promise<VilleRaw> {
  const [meta, bats, relief, arbres, eau, styles, voirie, emp, dome] = await Promise.all([
    json(FILES.meta), json(FILES.bats), bin(FILES.relief), bin(FILES.arbres), json(FILES.eau), json(FILES.styles), json(FILES.voirie), json(FILES.emplacements), bin(FILES.dome),
  ]);
  return { meta, bats, relief: new Float32Array(relief), arbres: new Float32Array(arbres), eau, styles, voirie, emplacements: emp.emplacements, visibles: emp.visibles, dome: new Float32Array(dome) };
}

// ---------------------------------------------------------------- petites fonctions de géométrie plane
export const hash = (x: number, z: number, k = 0): number => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
export function inPoly(x: number, z: number, P: Ring): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
}
const median = (a: number[]): number => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];

// ---------------------------------------------------------------- emprises du premier plan, au centre de la carte
/** bassin d'agrément (relevé à la main : il n'est pas dans les données) */
export const BASSIN: Ring = [[22, 54.8], [40.5, 83], [40, 97], [28, 123.5], [-8.5, 130], [-38.5, 118], [-21.5, 84.5], [-12, 71.5], [1, 68.5]];
/** manège au bord du bassin : x, z, rayon */
export const MANEGE: [number, number, number] = [-6, 74.5, 6.5];
/** canal urbain : axe et largeur */
export const CANAL: Ring = [[-200, 28], [-140, 66], [-80, 108], [-45, 132], [15, 150], [90, 170], [142, 190], [205, 217]];
export const CANAL_W = 8.5;

/**
 * La carte, prête à être dessinée et jouée. Toutes les coordonnées sont « à plat » (celles des fichiers) ; la courbure
 * s'ajoute à l'altitude au moment de poser un sommet ou un objet : `y + bendY(x, z)`.
 */
export class VilleWorld {
  readonly meta: VilleMeta;
  readonly N: number; readonly OX: number; readonly OZ: number;
  /** dalles par côté et côté d'une dalle */
  readonly NT: number; readonly TS: number;
  /** centre de la carte et demi-côté */
  readonly BCX: number; readonly BCZ: number; readonly BH: number;
  private RN: number;
  /** niveau de l'eau du bassin, et du canal à chaque point de son axe */
  readonly LB: number;
  readonly canalLv: number[];
  /** emplacements à leur place définitive, dans l'ordre du fichier, et grues (celles des emplacements comprises) */
  readonly emp: Emplacement[];
  readonly grues: Grue[];

  constructor(readonly raw: VilleRaw) {
    const m = (this.meta = raw.meta);
    this.N = m.taille; this.OX = m.ox; this.OZ = m.oz; this.NT = m.dalles; this.TS = this.N / this.NT;
    this.BCX = this.OX + this.N / 2; this.BCZ = this.OZ + this.N / 2; this.BH = this.N / 2;
    this.RN = this.N / m.pas + 1;
    this.LB = median(BASSIN.map((p) => this.groundY(p[0], p[1])));
    this.canalLv = CANAL.map((p) => { let lo = 1e9; for (let a = -6; a <= 6; a += 3) for (let b = -6; b <= 6; b += 3) lo = Math.min(lo, this.groundY(p[0] + a, p[1] + b)); return lo - 0.3; });
    // centre aquatique : sa toiture est une voûte (dome_piscine.bin) à la place des volumes en gradins des données
    for (const b of raw.bats) if (Math.hypot(b.x + 197, b.z - 2124) < 55 && b.a > 300) { b.k = []; b.r = Math.min(b.r, b.b + 3.5); }
    const placed = placeEmplacements(this);
    this.emp = placed.emp;
    this.grues = placed.grues;
  }

  /** Courbure : 0 au centre, −BOMBE aux bords (et au-delà). */
  bendY = (x: number, z: number): number => {
    const u = Math.max(-1, Math.min(1, (x - this.BCX) / this.BH)), v = Math.max(-1, Math.min(1, (z - this.BCZ) / this.BH));
    return -BOMBE * (1 - (1 - u * u) * (1 - v * v));
  };

  /** Altitude du relief relevé (à plat). */
  groundY = (x: number, z: number): number => {
    const RN = this.RN, pas = this.meta.pas, relief = this.raw.relief;
    const fx = Math.min(RN - 1.001, Math.max(0, (x - this.OX) / pas)), fz = Math.min(RN - 1.001, Math.max(0, (z - this.OZ) / pas));
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
    return (relief[j * RN + i] * (1 - a) + relief[j * RN + i + 1] * a) * (1 - b) + (relief[(j + 1) * RN + i] * (1 - a) + relief[(j + 1) * RN + i + 1] * a) * b;
  };

  /** Distance à l'axe du canal et niveau de l'eau à cet endroit. */
  canalProj(x: number, z: number): { d: number; lv: number } {
    let d = 1e9, lv = 0;
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
      const dd = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
      if (dd < d) { d = dd; lv = this.canalLv[i] + (this.canalLv[i + 1] - this.canalLv[i]) * t; }
    }
    return { d, lv };
  }
  nearCanal(x: number, z: number, m: number): boolean {
    for (let i = 0; i < CANAL.length - 1; i++) if (segDist(x, z, CANAL[i][0], CANAL[i][1], CANAL[i + 1][0], CANAL[i + 1][1]) < m) return true;
    return false;
  }

  /** Altitude du sol dessiné (à plat) : le relief, creusé sous le bassin et le canal. */
  terrainY = (x: number, z: number): number => {
    // le bassin et le canal tiennent dans ce rectangle : ailleurs, le relief tel quel
    if (x > -225 && x < 230 && z > 0 && z < 245) {
      if (inPoly(x, z, BASSIN) || this.polyDist(x, z, BASSIN) < 9.5) return this.LB - 0.9;
      const c = this.canalProj(x, z);
      if (c.d < CANAL_W / 2 + 9.5) return c.lv - 0.8;
    }
    return this.groundY(x, z);
  };
  private polyDist(x: number, z: number, P: Ring): number {
    let d = 1e9;
    for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; d = Math.min(d, segDist(x, z, P[i][0], P[i][1], q[0], q[1])); }
    return d;
  }

  /** Indice (ligne × NT + colonne) de la dalle qui contient le point. */
  tileIndex(x: number, z: number): number {
    const NT = this.NT;
    return Math.min(NT - 1, Math.max(0, Math.floor((z - this.OZ) / this.TS))) * NT + Math.min(NT - 1, Math.max(0, Math.floor((x - this.OX) / this.TS)));
  }

  private grid: Map<number, Batiment[]> | null = null;
  /** Bâtiments dont le centre est à moins de 200 m du point en x et en z (au moins ceux-là) : grille de 200 m. */
  batsNear(x: number, z: number): Batiment[] {
    const C = 200, key = (i: number, j: number): number => i * 4096 + j;
    if (!this.grid) {
      this.grid = new Map();
      for (const b of this.raw.bats) { const k = key(Math.floor(b.x / C), Math.floor(b.z / C)); let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(b); }
    }
    const i = Math.floor(x / C), j = Math.floor(z / C), out: Batiment[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = this.grid.get(key(i + a, j + b)); if (l) for (const q of l) out.push(q); }
    return out;
  }

  /** Altitude du toit du modèle au point donné (à plat) ; −1e9 s'il n'y a pas de volume. */
  roofAt(x: number, z: number): number {
    let best = -1e9;
    for (const b of this.batsNear(x, z)) {
      if (Math.abs(b.x - x) > 200 || Math.abs(b.z - z) > 200) continue;
      for (const rings of b.p) if (inPoly(x, z, rings[0]) && !rings.slice(1).some((h) => inPoly(x, z, h))) best = Math.max(best, b.r);
      for (const k of b.k) { const dx = x - k[0], dz = z - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]); if (Math.abs(dx * ct + dz * st) <= k[2] / 2 && Math.abs(-dx * st + dz * ct) <= k[3] / 2) best = Math.max(best, k[5]); }
    }
    return best;
  }

  /** Le point (à plat) est-il dans le volume d'un bâtiment du modèle ? */
  inBuilding(x: number, y: number, z: number): boolean {
    for (const b of this.batsNear(x, z)) {
      if (Math.abs(b.x - x) > 200 || Math.abs(b.z - z) > 200 || y < b.b - 1.5) continue;
      if (y <= b.r) for (const rings of b.p) if (inPoly(x, z, rings[0]) && !rings.slice(1).some((h) => inPoly(x, z, h))) return true;
      for (const k of b.k) { if (y > k[5]) continue; const dx = x - k[0], dz = z - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]); if (Math.abs(dx * ct + dz * st) <= k[2] / 2 && Math.abs(-dx * st + dz * ct) <= k[3] / 2) return true; }
    }
    return false;
  }

  /**
   * Œil du tireur de l'emplacement, dans le monde du jeu. La courbure est prise au centre du perchoir, qui descend
   * d'un bloc : le plancher dessiné est ainsi exactement à `EYE` sous l'œil.
   */
  eyeOf(e: Emplacement): { x: number; y: number; z: number } {
    return { x: e.x + e.ox, y: e.y + this.bendY(e.x, e.z), z: e.z + e.oz };
  }
  /** cap (radians, 0 = nord, sens horaire) de l'emplacement vers le centre de la carte */
  yawToCentre(e: Emplacement): number {
    return Math.atan2(this.BCX - (e.x + e.ox), -(this.BCZ - (e.z + e.oz)));
  }
}
