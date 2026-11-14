// Balistique extérieure : masse ponctuelle, traînée G1 ou G7, intégration numérique pas à pas (RK4).
// TypeScript pur, sans dépendance : utilisé par le jeu et par les tests unitaires.
// Les effets avancés (Coriolis, dérive gyroscopique, densité variable…) sont dans flight.ts et environment.ts ;
// ce fichier reste le noyau : `stepBullet` (G1, air uniforme) n'a pas changé d'un bit.

/** Coefficient de traînée de référence G1 en fonction du nombre de Mach (table standard Ingalls / BRL). */
const G1: [number, number][] = [
  [0, 0.2629], [0.05, 0.2558], [0.1, 0.2487], [0.15, 0.2413], [0.2, 0.2344], [0.25, 0.2278], [0.3, 0.2214], [0.35, 0.2155],
  [0.4, 0.2104], [0.45, 0.2061], [0.5, 0.2032], [0.55, 0.202], [0.6, 0.2034], [0.7, 0.2165], [0.725, 0.223], [0.75, 0.2313],
  [0.775, 0.2417], [0.8, 0.2546], [0.825, 0.2706], [0.85, 0.2901], [0.875, 0.3136], [0.9, 0.3415], [0.925, 0.3734], [0.95, 0.4084],
  [0.975, 0.4448], [1.0, 0.4805], [1.025, 0.5136], [1.05, 0.5427], [1.075, 0.5677], [1.1, 0.5883], [1.125, 0.6053], [1.15, 0.6191],
  [1.2, 0.6393], [1.25, 0.6518], [1.3, 0.6589], [1.35, 0.6621], [1.4, 0.6625], [1.45, 0.6607], [1.5, 0.6573], [1.55, 0.6528],
  [1.6, 0.6474], [1.65, 0.6413], [1.7, 0.6347], [1.75, 0.628], [1.8, 0.621], [1.85, 0.6141], [1.9, 0.6072], [1.95, 0.6003],
  [2.0, 0.5934], [2.05, 0.5867], [2.1, 0.5804], [2.15, 0.5743], [2.2, 0.5685], [2.25, 0.563], [2.3, 0.5577], [2.35, 0.5527],
  [2.4, 0.5481], [2.45, 0.5438], [2.5, 0.5397], [2.6, 0.5325], [2.7, 0.5264], [2.8, 0.5211], [2.9, 0.5168], [3.0, 0.5133],
  [3.1, 0.5105], [3.2, 0.5084], [3.3, 0.5067], [3.4, 0.5054], [3.5, 0.504], [3.6, 0.503], [3.7, 0.5022], [3.8, 0.5016],
  [3.9, 0.501], [4.0, 0.5006], [5.0, 0.4988],
];

export function cdG1(mach: number): number {
  if (mach <= 0) return G1[0][1];
  let lo = 0;
  let hi = G1.length - 1;
  if (mach >= G1[hi][0]) return G1[hi][1];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (G1[m][0] <= mach) lo = m;
    else hi = m;
  }
  const a = G1[lo];
  const b = G1[hi];
  return a[1] + ((b[1] - a[1]) * (mach - a[0])) / (b[0] - a[0]);
}

/**
 * Coefficient de traînée de référence G7 (projectile long à culot rétreint, ogive sécante) en fonction du nombre de
 * Mach. Table standard BRL, telle que reproduite par McCoy (« Modern Exterior Ballistics ») et par les calculateurs
 * libres (JBM, py-ballisticcalc : drag_tables.py, TableG7). C'est le modèle dans lequel Berger, Hornady et Applied
 * Ballistics publient les coefficients des balles de tir à longue distance.
 */
const G7: [number, number][] = [
  [0, 0.1198], [0.05, 0.1197], [0.1, 0.1196], [0.15, 0.1194], [0.2, 0.1193], [0.25, 0.1194], [0.3, 0.1194], [0.35, 0.1194],
  [0.4, 0.1193], [0.45, 0.1193], [0.5, 0.1194], [0.55, 0.1193], [0.6, 0.1194], [0.65, 0.1197], [0.7, 0.1202], [0.725, 0.1207],
  [0.75, 0.1215], [0.775, 0.1226], [0.8, 0.1242], [0.825, 0.1266], [0.85, 0.1306], [0.875, 0.1368], [0.9, 0.1464], [0.925, 0.166],
  [0.95, 0.2054], [0.975, 0.2993], [1.0, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034], [1.1, 0.4014], [1.125, 0.3987],
  [1.15, 0.3955], [1.2, 0.3884], [1.25, 0.381], [1.3, 0.3732], [1.35, 0.3657], [1.4, 0.358], [1.5, 0.344], [1.55, 0.3376],
  [1.6, 0.3315], [1.65, 0.326], [1.7, 0.3209], [1.75, 0.316], [1.8, 0.3117], [1.85, 0.3078], [1.9, 0.3042], [1.95, 0.301],
  [2.0, 0.298], [2.05, 0.2951], [2.1, 0.2922], [2.15, 0.2892], [2.2, 0.2864], [2.25, 0.2835], [2.3, 0.2807], [2.35, 0.2779],
  [2.4, 0.2752], [2.45, 0.2725], [2.5, 0.2697], [2.55, 0.267], [2.6, 0.2643], [2.65, 0.2615], [2.7, 0.2588], [2.75, 0.2561],
  [2.8, 0.2533], [2.85, 0.2506], [2.9, 0.2479], [2.95, 0.2451], [3.0, 0.2424], [3.1, 0.2368], [3.2, 0.2313], [3.3, 0.2258],
  [3.4, 0.2205], [3.5, 0.2154], [3.6, 0.2106], [3.7, 0.206], [3.8, 0.2017], [3.9, 0.1975], [4.0, 0.1935], [4.2, 0.1861],
  [4.4, 0.1793], [4.6, 0.173], [4.8, 0.1672], [5.0, 0.1618],
];

/** Interpolation linéaire dans une table (Mach, Cd) triée ; valeurs figées hors de la table. */
function cdFrom(table: [number, number][], mach: number): number {
  if (mach <= 0) return table[0][1];
  let lo = 0;
  let hi = table.length - 1;
  if (mach >= table[hi][0]) return table[hi][1];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (table[m][0] <= mach) lo = m;
    else hi = m;
  }
  const a = table[lo];
  const b = table[hi];
  return a[1] + ((b[1] - a[1]) * (mach - a[0])) / (b[0] - a[0]);
}

export function cdG7(mach: number): number {
  return cdFrom(G7, mach);
}

/** Modèle de traînée d'un projectile : G1 (balle courte à culot plat, référence historique) ou G7 (balle longue). */
export type DragModel = 'G1' | 'G7';

export function dragCd(model: DragModel, mach: number): number {
  return model === 'G7' ? cdFrom(G7, mach) : cdG1(mach);
}

export interface Atmosphere {
  /** masse volumique de l'air, kg/m³ */
  rho: number;
  /** vitesse du son, m/s */
  sos: number;
  g: number;
}
/** Atmosphère standard OACI au niveau de la mer (15 °C, 1013,25 hPa). */
export const ICAO: Atmosphere = { rho: 1.225, sos: 340.3, g: 9.80665 };
/** Conditions du jeu : sommet vers 1 600 m d'altitude fictive ramené à un air de montagne doux (≈ 600 m, 18 °C). */
export const GAME_AIR: Atmosphere = { rho: 1.14, sos: 342, g: 9.80665 };

/** Le projectile de référence (G1 comme G7) : 1 lb, 1 pouce de diamètre → densité de section de 703,07 kg/m². */
export const SD_REF = 703.0696;

/** Décélération de traînée / v, pour une vitesse relative à l'air v (m/s) : a = k(v) · v, dirigée contre la vitesse. */
export function dragK(v: number, bc: number, air: Atmosphere): number {
  return (air.rho * Math.PI * cdG1(v / air.sos) * v) / (8 * SD_REF * bc);
}

export interface BulletState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number;
}

/** Un pas RK4. Vent (wx, wy, wz) en m/s dans le même repère ; Y vers le haut. */
export function stepBullet(s: BulletState, dt: number, bc: number, air: Atmosphere, wx: number, wy: number, wz: number): void {
  const acc = (vx: number, vy: number, vz: number, o: number[]): void => {
    const rx = vx - wx, ry = vy - wy, rz = vz - wz;
    const k = dragK(Math.sqrt(rx * rx + ry * ry + rz * rz), bc, air);
    o[0] = -k * rx;
    o[1] = -k * ry - air.g;
    o[2] = -k * rz;
  };
  const a1 = A1, a2 = A2, a3 = A3, a4 = A4;
  acc(s.vx, s.vy, s.vz, a1);
  const h = dt / 2;
  const v2x = s.vx + a1[0] * h, v2y = s.vy + a1[1] * h, v2z = s.vz + a1[2] * h;
  acc(v2x, v2y, v2z, a2);
  const v3x = s.vx + a2[0] * h, v3y = s.vy + a2[1] * h, v3z = s.vz + a2[2] * h;
  acc(v3x, v3y, v3z, a3);
  const v4x = s.vx + a3[0] * dt, v4y = s.vy + a3[1] * dt, v4z = s.vz + a3[2] * dt;
  acc(v4x, v4y, v4z, a4);
  s.x += (dt / 6) * (s.vx + 2 * v2x + 2 * v3x + v4x);
  s.y += (dt / 6) * (s.vy + 2 * v2y + 2 * v3y + v4y);
  s.z += (dt / 6) * (s.vz + 2 * v2z + 2 * v3z + v4z);
  s.vx += (dt / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
  s.vy += (dt / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
  s.vz += (dt / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
  s.t += dt;
}
const A1 = [0, 0, 0], A2 = [0, 0, 0], A3 = [0, 0, 0], A4 = [0, 0, 0];

export interface Load {
  /** vitesse initiale, m/s */
  v0: number;
  bcG1: number;
  /** masse du projectile en grains */
  bulletGr: number;
  /** modèle de traînée à utiliser ; absent = G1 (comportement d'origine) */
  dragModel?: DragModel;
  /** coefficient balistique G7 publié ; obligatoire si dragModel vaut 'G7' */
  bcG7?: number;
}

/** Coefficient balistique et modèle réellement utilisés pour une charge. */
export function loadDrag(load: Load): { bc: number; drag: DragModel } {
  return load.dragModel === 'G7' && load.bcG7 ? { bc: load.bcG7, drag: 'G7' } : { bc: load.bcG1, drag: 'G1' };
}

/**
 * Un pas RK4 avec le modèle de traînée de son choix, air uniforme. Même schéma que `stepBullet` (qui reste la voie
 * G1 d'origine, inchangée) ; sert aux tables à plat des charges G7.
 */
export function stepDrag(s: BulletState, dt: number, bc: number, drag: DragModel, air: Atmosphere, wx: number, wy: number, wz: number): void {
  if (drag === 'G1') {
    stepBullet(s, dt, bc, air, wx, wy, wz);
    return;
  }
  const c = (air.rho * Math.PI) / (8 * SD_REF * bc);
  const sos = air.sos, g = air.g;
  const h = dt / 2;
  let rx = s.vx - wx, ry = s.vy - wy, rz = s.vz - wz;
  let v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let k = c * cdFrom(G7, v / sos) * v;
  const a1x = -k * rx, a1y = -k * ry - g, a1z = -k * rz;
  const v2x = s.vx + a1x * h, v2y = s.vy + a1y * h, v2z = s.vz + a1z * h;
  rx = v2x - wx; ry = v2y - wy; rz = v2z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * cdFrom(G7, v / sos) * v;
  const a2x = -k * rx, a2y = -k * ry - g, a2z = -k * rz;
  const v3x = s.vx + a2x * h, v3y = s.vy + a2y * h, v3z = s.vz + a2z * h;
  rx = v3x - wx; ry = v3y - wy; rz = v3z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * cdFrom(G7, v / sos) * v;
  const a3x = -k * rx, a3y = -k * ry - g, a3z = -k * rz;
  const v4x = s.vx + a3x * dt, v4y = s.vy + a3y * dt, v4z = s.vz + a3z * dt;
  rx = v4x - wx; ry = v4y - wy; rz = v4z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * cdFrom(G7, v / sos) * v;
  const a4x = -k * rx, a4y = -k * ry - g, a4z = -k * rz;
  const d6 = dt / 6;
  s.x += d6 * (s.vx + 2 * v2x + 2 * v3x + v4x);
  s.y += d6 * (s.vy + 2 * v2y + 2 * v3y + v4y);
  s.z += d6 * (s.vz + 2 * v2z + 2 * v3z + v4z);
  s.vx += d6 * (a1x + 2 * a2x + 2 * a3x + a4x);
  s.vy += d6 * (a1y + 2 * a2y + 2 * a3y + a4y);
  s.vz += d6 * (a1z + 2 * a2z + 2 * a3z + a4z);
  s.t += dt;
}
export const GRAIN_KG = 6.479891e-5;

export interface TableRow {
  range: number;
  /** position par rapport à la ligne de visée, m (négatif = sous la visée) */
  path: number;
  /** dérive due au vent, m (positive dans le sens du vent) */
  drift: number;
  velocity: number;
  time: number;
  energy: number;
  /** correction d'élévation à afficher (mrad, positive = monter) */
  elevMil: number;
  /** correction de dérive (mrad) pour annuler le vent traversier donné */
  windMil: number;
}

export interface TableOptions {
  zero: number;
  /** hauteur de l'axe de la lunette au-dessus du canon, m */
  sightHeight: number;
  /** vent traversier plein, m/s */
  crosswind?: number;
  ranges: number[];
  air?: Atmosphere;
  dt?: number;
}

/** Tir à plat : x vers la cible, y vers le haut, z à droite. Renvoie la hauteur y à la distance demandée. */
function fly(load: Load, angle: number, sightHeight: number, crosswind: number, ranges: number[], air: Atmosphere, dt: number, each: (r: number, s: BulletState) => void): void {
  const s: BulletState = { x: 0, y: -sightHeight, z: 0, vx: load.v0 * Math.cos(angle), vy: load.v0 * Math.sin(angle), vz: 0, t: 0 };
  const prev: BulletState = { ...s };
  let i = 0;
  const sorted = ranges;
  const g7 = load.dragModel === 'G7' && !!load.bcG7;
  if (sorted[0] === 0) {
    each(0, s);
    i = 1;
  }
  for (let n = 0; n < 200000 && i < sorted.length; n++) {
    Object.assign(prev, s);
    if (g7) stepDrag(s, dt, load.bcG7!, 'G7', air, 0, 0, crosswind);
    else stepBullet(s, dt, load.bcG1, air, 0, 0, crosswind);
    while (i < sorted.length && s.x >= sorted[i]) {
      const f = (sorted[i] - prev.x) / (s.x - prev.x);
      const it: BulletState = {
        x: sorted[i], y: prev.y + (s.y - prev.y) * f, z: prev.z + (s.z - prev.z) * f,
        vx: prev.vx + (s.vx - prev.vx) * f, vy: prev.vy + (s.vy - prev.vy) * f, vz: prev.vz + (s.vz - prev.vz) * f, t: prev.t + (s.t - prev.t) * f,
      };
      each(sorted[i], it);
      i++;
    }
    if (s.vx < 30 || s.y < -3000) break;
  }
}

/** Angle du canon au-dessus de la ligne de visée pour un zérotage à la distance donnée (rad). */
export function zeroAngle(load: Load, zero: number, sightHeight: number, air: Atmosphere = ICAO, dt = 0.0005): number {
  let lo = -0.01, hi = 0.2;
  for (let k = 0; k < 44; k++) {
    const mid = (lo + hi) / 2;
    let y = -1e9;
    fly(load, mid, sightHeight, 0, [zero], air, dt, (_r, s) => (y = s.y));
    if (y < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Table de tir à plat. */
export function ballisticTable(load: Load, opt: TableOptions): TableRow[] {
  const air = opt.air ?? ICAO;
  const dt = opt.dt ?? 0.0005;
  const ang = zeroAngle(load, opt.zero, opt.sightHeight, air, dt);
  const rows: TableRow[] = [];
  const m = load.bulletGr * GRAIN_KG;
  const cw = opt.crosswind ?? 0;
  fly(load, ang, opt.sightHeight, cw, opt.ranges, air, dt, (r, s) => {
    const v = Math.hypot(s.vx, s.vy, s.vz);
    rows.push({ range: r, path: s.y, drift: s.z, velocity: v, time: s.t, energy: 0.5 * m * v * v, elevMil: r > 0 ? (-s.y / r) * 1000 : 0, windMil: r > 0 ? (s.z / r) * 1000 : 0 });
  });
  return rows;
}
