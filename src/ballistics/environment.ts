// Environnement balistique du niveau avancé : atmosphère réelle (altitude, température, pression), rotation
// terrestre, stabilité gyroscopique du projectile. Fonctions pures, sans dépendance.
//
// Chaque effet s'active séparément dans `BallisticEnv`. Tout désactivé (`NEUTRAL_ENV`), le jeu retrouve exactement
// le calcul d'origine : traînée + gravité dans un air uniforme.
import { ICAO, type Atmosphere } from './solver';

export interface BallisticEnv {
  /** latitude du pas de tir, degrés (positive au nord) : règle l'intensité et le sens de la force de Coriolis */
  latitudeDeg: number;
  /** altitude du poste de tir, m (sert si `densityFromAltitude`) */
  altitudeM: number;
  /** température au poste de tir, °C */
  temperatureC: number;
  /** pression « station » au poste de tir, hPa ; absente = pression de l'atmosphère type à cette altitude */
  pressureHPa?: number;
  /** humidité relative, % (0 par défaut) : l'air humide est un peu moins dense */
  humidityPct?: number;
  /** force de Coriolis : dérive horizontale (selon la latitude) et effet Eötvös vertical (selon l'azimut de tir) */
  coriolis: boolean;
  /** dérive gyroscopique (formule de Litz, stabilité de Miller à partir du pas de rayure) */
  spinDrift: boolean;
  /** saut aérodynamique : déviation verticale due au vent traversier à la bouche */
  aeroJump: boolean;
  /** densité et vitesse du son calculées d'après altitude / température / pression, et variant le long de la trajectoire */
  densityFromAltitude: boolean;
  /**
   * sensibilité de la poudre à la température, m/s par °C d'écart à 15 °C (0 ou absent = désactivé).
   * Ordre de grandeur réel : 0,2 (poudres dites « insensibles ») à 0,9 m/s par °C ; aucune valeur par munition n'est
   * publiée de façon fiable, c'est donc un réglage de niveau et non une donnée d'arme.
   */
  powderTempSens?: number;
}

/** Environnement neutre : aucun effet avancé, résultats identiques au solveur d'origine. */
export const NEUTRAL_ENV: BallisticEnv = {
  latitudeDeg: 45, altitudeM: 0, temperatureC: 15, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false,
};

/** Tous les effets activés, pour un pas de tir donné (valeurs par défaut : 45° N, niveau de la mer, 15 °C). */
export function fullEnv(over: Partial<BallisticEnv> = {}): BallisticEnv {
  return { latitudeDeg: 45, altitudeM: 0, temperatureC: 15, coriolis: true, spinDrift: true, aeroJump: true, densityFromAltitude: true, ...over };
}

/** vitesse angulaire de rotation de la Terre, rad/s (jour sidéral) */
export const EARTH_RATE = 7.292115e-5;
/** gradient thermique de l'atmosphère type OACI dans la troposphère, K/m */
export const LAPSE = 0.0065;
/** exposant de la loi de densité de l'atmosphère type : ρ/ρ₀ = (T/T₀)^(g/(R·L) − 1) */
export const DENSITY_EXP = 4.25588;
const R_DRY = 287.05287;
const R_VAPOR = 461.495;
const KELVIN = 273.15;
export const REF_TEMP_C = 15;

/** Pression de l'atmosphère type OACI à l'altitude donnée, hPa. */
export function standardPressure(altitudeM: number): number {
  return 1013.25 * Math.pow(1 - (LAPSE * altitudeM) / 288.15, 5.25588);
}

/** Pression de vapeur saturante de l'eau, hPa (formule de Magnus-Tetens). */
function saturationVapor(tC: number): number {
  return 6.1078 * Math.pow(10, (7.5 * tC) / (tC + 237.3));
}

/** Masse volumique de l'air (kg/m³) pour une température (°C), une pression (hPa) et une humidité relative (%). */
export function airDensity(tC: number, pHPa: number, humidityPct = 0): number {
  const T = tC + KELVIN;
  const pv = (Math.min(100, Math.max(0, humidityPct)) / 100) * saturationVapor(tC);
  return ((pHPa - pv) * 100) / (R_DRY * T) + (pv * 100) / (R_VAPOR * T);
}

/** Vitesse du son dans l'air sec, m/s. */
export function speedOfSound(tC: number): number {
  return 20.04680 * Math.sqrt(tC + KELVIN);
}

/**
 * Atmosphère au poste de tir. Si `densityFromAltitude` est coupé (ou `env` absent), c'est l'atmosphère de base qui
 * est rendue telle quelle (même objet) : le calcul d'origine n'est pas perturbé.
 */
export function atmosphereFor(env: BallisticEnv | undefined, base: Atmosphere = ICAO): Atmosphere {
  if (!env || !env.densityFromAltitude) return base;
  const p = env.pressureHPa ?? standardPressure(env.altitudeM);
  return { rho: airDensity(env.temperatureC, p, env.humidityPct ?? 0), sos: speedOfSound(env.temperatureC), g: base.g };
}

/** Altitude-densité (m) : altitude de l'atmosphère type où l'air a cette masse volumique. Pratique pour un carnet de tir. */
export function densityAltitude(rho: number): number {
  return (288.15 / LAPSE) * (1 - Math.pow(rho / 1.225, 1 / DENSITY_EXP));
}

/** Vitesse initiale corrigée de la température de la poudre (m/s). */
export function muzzleVelocity(v0: number, env?: BallisticEnv): number {
  const k = env?.powderTempSens ?? 0;
  return k === 0 ? v0 : v0 + k * (env!.temperatureC - REF_TEMP_C);
}

// --- stabilité gyroscopique -------------------------------------------------------------------------------------

/** Données de rotation d'un projectile : absentes, la dérive gyroscopique et le saut aérodynamique valent zéro. */
export interface SpinData {
  /** masse du projectile, grains */
  bulletGr: number;
  /** diamètre du projectile, mm */
  bulletDiaMm?: number;
  /** longueur du projectile, mm */
  bulletLenMm?: number;
  /** pas de rayure en pouces par tour ; positif = à droite (cas général), négatif = à gauche */
  twistIn?: number;
}

const MM_IN = 25.4;
const FPS = 0.3048;

/**
 * Coefficient de stabilité gyroscopique Sg par la règle de Miller (D. Miller, « A New Rule for Estimating Rifling
 * Twist », Precision Shooting, 2005), avec ses corrections de vitesse et de densité d'air :
 *   Sg = 30·m / (t²·d³·l·(1 + l²)) × (v / 2800 ft/s)^(1/3) × (ρ type / ρ)
 * m en grains, d en pouces, l longueur en calibres, t pas en calibres par tour.
 * Renvoie 0 si les données manquent. Sg ≥ 1,5 : pleinement stable ; 1,0 à 1,5 : marginal ; < 1 : instable.
 */
export function millerStability(p: SpinData, v0: number, rho = 1.225): number {
  if (!p.bulletDiaMm || !p.bulletLenMm || !p.twistIn) return 0;
  const d = p.bulletDiaMm / MM_IN;
  const l = p.bulletLenMm / p.bulletDiaMm;
  const t = Math.abs(p.twistIn) / d;
  const sg = (30 * p.bulletGr) / (t * t * d * d * d * l * (1 + l * l));
  return sg * Math.cbrt(v0 / (2800 * FPS)) * (1.225 / rho);
}

/** +1 pas à droite, −1 pas à gauche, 0 si inconnu. */
export function twistSign(p: SpinData): number {
  return !p.twistIn ? 0 : p.twistIn > 0 ? 1 : -1;
}

/**
 * Dérive gyroscopique en mètres après un temps de vol `tof` (s), formule empirique de Bryan Litz
 * (« Applied Ballistics for Long Range Shooting ») : dérive [pouces] = 1,25·(Sg + 1,2)·tof^1,83.
 * Positive vers la droite pour un pas à droite.
 */
export function spinDrift(sg: number, tof: number, sign = 1): number {
  return sg <= 0 ? 0 : sign * 0.0254 * 1.25 * (sg + 1.2) * Math.pow(tof, 1.83);
}

/** Coefficient K tel que dérive(t) = K·t^1,83 (m), signé selon le sens du pas. */
export function spinDriftCoef(sg: number, sign = 1): number {
  return sg <= 0 ? 0 : sign * 0.0254 * 1.25 * (sg + 1.2);
}

const MOA_MRAD = 0.2908882;
const MPH = 0.44704;

/**
 * Saut aérodynamique dû au vent traversier, en mrad vers le HAUT (formule empirique de Litz, même ouvrage) :
 *   déviation verticale [MOA par mph de vent traversier] = 0,01·Sg − 0,0024·L + 0,032   (L : longueur en calibres)
 * Avec un pas à droite, un vent venant de la droite fait monter l'impact, un vent venant de la gauche le fait
 * descendre (la diagonale « 10 h – 4 h » des tireurs de benchrest).
 * `crosswindRight` : composante du vent qui pousse vers la droite du tireur (vent venant de la gauche), m/s.
 * C'est un écart angulaire acquis à la bouche : il vaut le même nombre de mrad à toutes les distances.
 */
export function aeroJumpMil(p: SpinData, sg: number, crosswindRight: number): number {
  if (sg <= 0 || crosswindRight === 0 || !p.bulletDiaMm || !p.bulletLenMm) return 0;
  const perMph = 0.01 * sg - 0.0024 * (p.bulletLenMm / p.bulletDiaMm) + 0.032;
  return -twistSign(p) * perMph * (crosswindRight / MPH) * MOA_MRAD;
}

// --- rotation terrestre ---------------------------------------------------------------------------------------

/**
 * Vecteur rotation de la Terre (rad/s) dans le repère de tir à plat du solveur : x vers la cible, y vers le haut,
 * z à droite. `azimuthDeg` : azimut de tir (0 = nord, sens horaire).
 */
export function earthRateFlat(latitudeDeg: number, azimuthDeg: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const lat = (latitudeDeg * Math.PI) / 180, az = (azimuthDeg * Math.PI) / 180;
  out.x = EARTH_RATE * Math.cos(lat) * Math.cos(az);
  out.y = EARTH_RATE * Math.sin(lat);
  out.z = -EARTH_RATE * Math.cos(lat) * Math.sin(az);
  return out;
}

/**
 * Vecteur rotation de la Terre (rad/s) dans le repère du monde du jeu (conventions de src/levels/README.md) :
 * X = est, Y = haut, Z = sud (le nord est −Z).
 */
export function earthRateWorld(latitudeDeg: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const lat = (latitudeDeg * Math.PI) / 180;
  out.x = 0;
  out.y = EARTH_RATE * Math.sin(lat);
  out.z = -EARTH_RATE * Math.cos(lat);
  return out;
}
