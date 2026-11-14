// Vol d'un projectile avec les effets avancés : traînée G1 ou G7, densité de l'air variable avec l'altitude,
// force de Coriolis (dérive horizontale + effet Eötvös), dérive gyroscopique.
//
// Usage : préparer un `Flight` une fois par tir (`makeFlight`), puis appeler `stepFlight` à chaque sous-pas à la
// place de `stepBullet`. Si aucun effet n'est actif et que le projectile est en G1, `stepFlight` délègue à
// `stepBullet` : le résultat est identique au bit près à celui du solveur d'origine.
import {
  DENSITY_EXP, LAPSE, atmosphereFor, earthRateFlat, earthRateWorld, millerStability, muzzleVelocity, spinDriftCoef, twistSign,
  type BallisticEnv, type SpinData,
} from './environment';
import { ICAO, SD_REF, dragCd, loadDrag, stepBullet, type Atmosphere, type BulletState, type DragModel, type Load } from './solver';

/** Ce qu'il faut savoir d'un projectile pour le faire voler : une `WeaponDef` convient telle quelle. */
export type Projectile = Load & SpinData;

export interface Flight {
  bc: number;
  drag: DragModel;
  /** atmosphère au poste de tir (à la hauteur y0) */
  air: Atmosphere;
  /** vitesse initiale effective (température de la poudre comprise), m/s */
  v0: number;
  /** vrai : G1, air uniforme, aucun effet → `stepBullet` d'origine */
  plain: boolean;
  /** densité et vitesse du son variables avec la hauteur */
  lapse: boolean;
  /** hauteur (coordonnée y du repère) du poste de tir, où `air` est valable */
  y0: number;
  /** température au poste de tir, K */
  tK: number;
  /** vecteur rotation de la Terre dans le repère de calcul, rad/s (nul si Coriolis coupé) */
  ox: number; oy: number; oz: number;
  /** coefficient de dérive gyroscopique : dérive(t) = sd·t^1,83 mètres vers la droite (nul si coupé) */
  sd: number;
  /** stabilité gyroscopique de Miller à la bouche (0 si les données de rotation manquent) */
  sg: number;
}

export interface FlightOptions {
  /** atmosphère de base, utilisée telle quelle si `densityFromAltitude` est coupé (défaut : OACI) */
  air?: Atmosphere;
  /** coordonnée y du poste de tir dans le repère de calcul (défaut 0) */
  y0?: number;
  /**
   * repère de calcul : 'world' = monde du jeu (X est, Y haut, nord = −Z) ; 'flat' = tir à plat du solveur
   * (x vers la cible, y haut, z droite), auquel cas `azimuthDeg` donne l'azimut de tir. Défaut : 'flat'.
   */
  frame?: 'world' | 'flat';
  /** azimut de tir, degrés (0 = nord, sens horaire) ; utile seulement en repère 'flat' avec Coriolis */
  azimuthDeg?: number;
}

const OMEGA = { x: 0, y: 0, z: 0 };

/** Prépare le vol d'un projectile dans un environnement donné. À appeler une fois par tir. */
export function makeFlight(p: Projectile, env?: BallisticEnv, opt: FlightOptions = {}): Flight {
  const { bc, drag } = loadDrag(p);
  const air = atmosphereFor(env, opt.air ?? ICAO);
  const v0 = muzzleVelocity(p.v0, env);
  const sg = millerStability(p, v0, air.rho);
  let ox = 0, oy = 0, oz = 0;
  if (env?.coriolis) {
    if (opt.frame === 'world') earthRateWorld(env.latitudeDeg, OMEGA);
    else earthRateFlat(env.latitudeDeg, opt.azimuthDeg ?? 0, OMEGA);
    ox = OMEGA.x; oy = OMEGA.y; oz = OMEGA.z;
  }
  const sd = env?.spinDrift ? spinDriftCoef(sg, twistSign(p)) : 0;
  const lapse = !!env?.densityFromAltitude;
  const coriolis = ox !== 0 || oy !== 0 || oz !== 0;
  return {
    bc, drag, air, v0, sg, lapse, y0: opt.y0 ?? 0, tK: (env?.temperatureC ?? 15) + 273.15, ox, oy, oz, sd,
    plain: drag === 'G1' && !lapse && !coriolis && sd === 0,
  };
}

/** Masse volumique locale / masse volumique au poste, pour une hauteur y (atmosphère type, gradient de 6,5 K/km). */
export function densityRatio(f: Flight, y: number): number {
  if (!f.lapse) return 1;
  const r = 1 - (LAPSE * (y - f.y0)) / f.tK;
  return Math.pow(r > 0.5 ? r : 0.5, DENSITY_EXP);
}

/** Nombre de Mach local d'un projectile de vitesse v (m/s, par rapport à l'air) à la hauteur y. */
export function machAt(f: Flight, v: number, y: number): number {
  if (!f.lapse) return v / f.air.sos;
  const r = 1 - (LAPSE * (y - f.y0)) / f.tK;
  return v / (f.air.sos * Math.sqrt(r > 0.5 ? r : 0.5));
}

/**
 * Un pas RK4 avec tous les effets du `Flight`. Vent (wx, wy, wz) en m/s dans le même repère ; Y vers le haut.
 * - traînée : a = −k(v)·v_relative, k = ρ·π·Cd(Mach)·v / (8·SD_ref·BC) ;
 * - densité : ρ et vitesse du son évaluées à la hauteur du projectile au début du pas (elles varient de moins de
 *   0,01 % sur un pas de quelques millisecondes) ;
 * - Coriolis : a = −2·Ω × v (vitesse par rapport au sol) ;
 * - dérive gyroscopique : la formule de Litz donne une dérive en fonction du temps de vol ; son accroissement sur le
 *   pas est ajouté à la position, vers la droite de la trajectoire (à l'horizontale).
 */
export function stepFlight(s: BulletState, dt: number, f: Flight, wx: number, wy: number, wz: number): void {
  if (f.plain) {
    stepBullet(s, dt, f.bc, f.air, wx, wy, wz);
    return;
  }
  let rho = f.air.rho, sos = f.air.sos;
  if (f.lapse) {
    let r = 1 - (LAPSE * (s.y - f.y0)) / f.tK;
    if (r < 0.5) r = 0.5;
    rho *= Math.pow(r, DENSITY_EXP);
    sos *= Math.sqrt(r);
  }
  const c = (rho * Math.PI) / (8 * SD_REF * f.bc);
  const g = f.air.g, drag = f.drag;
  const ox2 = 2 * f.ox, oy2 = 2 * f.oy, oz2 = 2 * f.oz;
  const h = dt / 2;
  const v1x = s.vx, v1y = s.vy, v1z = s.vz;

  let rx = v1x - wx, ry = v1y - wy, rz = v1z - wz;
  let v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let k = c * dragCd(drag, v / sos) * v;
  const a1x = -k * rx - (oy2 * v1z - oz2 * v1y);
  const a1y = -k * ry - g - (oz2 * v1x - ox2 * v1z);
  const a1z = -k * rz - (ox2 * v1y - oy2 * v1x);

  const v2x = v1x + a1x * h, v2y = v1y + a1y * h, v2z = v1z + a1z * h;
  rx = v2x - wx; ry = v2y - wy; rz = v2z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * dragCd(drag, v / sos) * v;
  const a2x = -k * rx - (oy2 * v2z - oz2 * v2y);
  const a2y = -k * ry - g - (oz2 * v2x - ox2 * v2z);
  const a2z = -k * rz - (ox2 * v2y - oy2 * v2x);

  const v3x = v1x + a2x * h, v3y = v1y + a2y * h, v3z = v1z + a2z * h;
  rx = v3x - wx; ry = v3y - wy; rz = v3z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * dragCd(drag, v / sos) * v;
  const a3x = -k * rx - (oy2 * v3z - oz2 * v3y);
  const a3y = -k * ry - g - (oz2 * v3x - ox2 * v3z);
  const a3z = -k * rz - (ox2 * v3y - oy2 * v3x);

  const v4x = v1x + a3x * dt, v4y = v1y + a3y * dt, v4z = v1z + a3z * dt;
  rx = v4x - wx; ry = v4y - wy; rz = v4z - wz;
  v = Math.sqrt(rx * rx + ry * ry + rz * rz);
  k = c * dragCd(drag, v / sos) * v;
  const a4x = -k * rx - (oy2 * v4z - oz2 * v4y);
  const a4y = -k * ry - g - (oz2 * v4x - ox2 * v4z);
  const a4z = -k * rz - (ox2 * v4y - oy2 * v4x);

  const d6 = dt / 6;
  s.x += d6 * (v1x + 2 * v2x + 2 * v3x + v4x);
  s.y += d6 * (v1y + 2 * v2y + 2 * v3y + v4y);
  s.z += d6 * (v1z + 2 * v2z + 2 * v3z + v4z);
  s.vx += d6 * (a1x + 2 * a2x + 2 * a3x + a4x);
  s.vy += d6 * (a1y + 2 * a2y + 2 * a3y + a4y);
  s.vz += d6 * (a1z + 2 * a2z + 2 * a3z + a4z);

  if (f.sd !== 0) {
    const t1 = s.t + dt;
    const d = f.sd * (Math.pow(t1, 1.83) - (s.t > 0 ? Math.pow(s.t, 1.83) : 0));
    const hv = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    if (hv > 1e-6) {
      // droite de la trajectoire, à l'horizontale : v × ŷ, valable dans les deux repères (directs, Y vers le haut)
      s.x += (d * -s.vz) / hv;
      s.z += (d * s.vx) / hv;
    }
  }
  s.t += dt;
}
