// Aide au tireur : solution de tir complète et décomposée, pour le carnet de tir et le point d'impact prédit.
// Fonctions pures : une arme, une distance, un vent, un azimut, un environnement → corrections en mrad.
//
// Conventions (celles du jeu) :
//   - élévation positive = monter la tourelle ; dérive positive = corriger à droite (l'impact part à droite) ;
//   - azimut en degrés, 0 = nord, sens horaire ; le vent est donné par l'azimut D'OÙ il vient ;
//   - écarts (`deflection`) en mètres à la cible, positifs vers le haut et vers la droite.
import { aeroJumpMil, spinDrift, twistSign, type BallisticEnv } from './environment';
import { machAt, makeFlight, stepFlight, type Flight, type Projectile } from './flight';
import { GRAIN_KG, ICAO, loadDrag, zeroAngle, type Atmosphere, type BulletState } from './solver';

/** Une arme vue par le calcul : une `WeaponDef` convient telle quelle. */
export type SolutionWeapon = Projectile & {
  /** distance de zérotage, m */
  zero: number;
  /** course d'élévation utilisable à la tourelle depuis le zéro, mrad (pour savoir si le tir est réglable) */
  turretMaxMil?: number;
};

export interface ShotSetup {
  /** distance tireur → cible le long de la ligne de visée, m */
  range: number;
  /** dénivelé cible − tireur, m (négatif : la cible est en contrebas) */
  heightDiff?: number;
  /** azimut de tir, degrés (sert à Coriolis et à projeter le vent) */
  azimuthDeg?: number;
  /** vitesse du vent, m/s */
  windSpeed?: number;
  /** azimut d'où vient le vent, degrés */
  windFromDeg?: number;
  /** environnement avancé ; absent = aucun effet avancé */
  env?: BallisticEnv;
  /** atmosphère de base : celle du zérotage, et celle du vol si `densityFromAltitude` est coupé (défaut : OACI) */
  air?: Atmosphere;
  /** hauteur de l'axe de la lunette au-dessus du canon, m (défaut 0,05 : SIGHT_HEIGHT du jeu) */
  sightHeight?: number;
  /** pas d'intégration, s (défaut 1/400 : celui du jeu) */
  dt?: number;
}

export interface SolutionParts {
  /** chute : gravité + traînée dans l'atmosphère du jour, pente comprise */
  drop: number;
  /** vent : composante latérale */
  wind: number;
  /** vent : effet vertical du vent de face ou de dos */
  windVertical: number;
  /** dérive gyroscopique */
  spinDrift: number;
  /** Coriolis horizontal (dépend de la latitude, pas de l'azimut) */
  coriolisH: number;
  /** Coriolis vertical, dit effet Eötvös (maximal en tirant plein est ou plein ouest) */
  coriolisV: number;
  /** saut aérodynamique dû au vent traversier à la bouche */
  aeroJump: number;
}

export interface FiringSolution {
  range: number;
  /** temps de vol jusqu'à la cible, s */
  tof: number;
  /** vitesse à l'impact, m/s, et nombre de Mach local */
  velocity: number;
  mach: number;
  /** énergie à l'impact, J */
  energy: number;
  /** réglages complets à afficher, mrad */
  elevMil: number;
  windMil: number;
  /**
   * part de chaque effet dans le réglage, mrad. `drop`, `windVertical`, `coriolisV` et `aeroJump` s'ajoutent à
   * l'élévation ; `wind`, `spinDrift` et `coriolisH` à la dérive. Leur somme vaut le réglage complet à mieux que
   * 0,05 mrad (les effets ne sont pas rigoureusement additifs).
   */
  parts: SolutionParts;
  /** écart que chaque effet produirait à la cible s'il n'était pas corrigé, m (haut et droite positifs) */
  deflection: SolutionParts;
  /** distance où le projectile passe sous Mach 1,2 (début du transsonique) ; null s'il y est encore au-delà de 20 s de vol ; 0 si subsonique dès la bouche */
  transonicRange: number | null;
  /** distance où il passe sous Mach 1 */
  subsonicRange: number | null;
  /** stabilité gyroscopique de Miller à la bouche (0 si pas de rayure ou dimensions du projectile inconnus) */
  sg: number;
  /** vrai si l'élévation tient dans la course de la tourelle */
  dialable: boolean;
  /** élévation restant à prendre au réticule (contre-visée) quand la tourelle est en butée, mrad */
  holdMil: number;
  /** vitesse initiale effective, m/s (température de la poudre comprise) */
  v0: number;
}

interface Hit { up: number; right: number; t: number; v: number; mach: number; ok: boolean; trans: number | null; sub: number | null }

const S: BulletState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };

/**
 * Tire un projectile et relève son écart à la ligne de visée (inclinée de `theta`) à la distance `range`.
 * `elev` et `windage` : angles du canon par rapport à la ligne de visée, rad. Vent horizontal : `wAlong` dans le
 * sens du tir, `wRight` vers la droite. Si `track`, le vol continue jusqu'à Mach 1 pour relever les passages.
 */
function shoot(f: Flight, elev: number, windage: number, theta: number, sh: number, range: number, wAlong: number, wRight: number, dt: number, track: boolean, out: Hit): Hit {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const E = theta + elev;
  const s = S;
  s.x = sh * st; s.y = -sh * ct; s.z = 0; s.t = 0;
  s.vx = f.v0 * Math.cos(E) * Math.cos(windage);
  s.vy = f.v0 * Math.sin(E);
  s.vz = f.v0 * Math.cos(E) * Math.sin(windage);
  out.ok = false; out.trans = null; out.sub = null;
  let pa = s.x * ct + s.y * st, pu = -s.x * st + s.y * ct, pz = 0, pt = 0, pv = f.v0;
  let m = machAt(f, f.v0, s.y);
  if (m < 1.2) out.trans = 0;
  if (m < 1) out.sub = 0;
  const maxSteps = Math.ceil(20 / dt);
  for (let n = 0; n < maxSteps; n++) {
    stepFlight(s, dt, f, wAlong, 0, wRight);
    const along = s.x * ct + s.y * st;
    const rx = s.vx - wAlong, rz = s.vz - wRight;
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    m = machAt(f, Math.sqrt(rx * rx + s.vy * s.vy + rz * rz), s.y);
    if (out.trans === null && m < 1.2) out.trans = along;
    if (out.sub === null && m < 1) out.sub = along;
    if (!out.ok && along >= range) {
      const k = (range - pa) / (along - pa);
      const up = -s.x * st + s.y * ct;
      out.up = pu + (up - pu) * k;
      out.right = pz + (s.z - pz) * k;
      out.t = pt + (s.t - pt) * k;
      out.v = pv + (v - pv) * k;
      out.mach = m;
      out.ok = true;
    }
    if (out.ok && (!track || out.sub !== null)) break;
    if (along <= pa || v < 20) break; // le projectile retombe ou s'arrête
    pa = along; pu = -s.x * st + s.y * ct; pz = s.z; pt = s.t; pv = v;
  }
  return out;
}

const zeroCache = new Map<string, number>();
function zeroOf(w: SolutionWeapon, sh: number, air: Atmosphere): number {
  const d = loadDrag(w);
  const key = `${w.v0}|${d.bc}|${d.drag}|${w.zero}|${sh}|${air.rho}|${air.sos}`;
  let z = zeroCache.get(key);
  if (z === undefined) {
    z = zeroAngle(w, w.zero, sh, air);
    zeroCache.set(key, z);
  }
  return z;
}

/** Projette le vent (vitesse, azimut d'origine) sur l'axe de tir : composantes dans le sens du tir et vers la droite. */
export function windComponents(windSpeed: number, windFromDeg: number, azimuthDeg: number): { along: number; right: number } {
  const a = ((windFromDeg - azimuthDeg) * Math.PI) / 180;
  return { along: -windSpeed * Math.cos(a), right: -windSpeed * Math.sin(a) };
}

const H0: Hit = { up: 0, right: 0, t: 0, v: 0, mach: 0, ok: false, trans: null, sub: null };
const H1: Hit = { ...H0 };

/**
 * Solution de tir complète pour une arme et une situation. Renvoie null si la cible est hors de portée
 * (le projectile n'atteint pas la distance en 20 s de vol).
 *
 * Méthode : on cherche d'abord l'élévation qui met au but sans vent ni effet avancé (la « chute ») ; autour de cette
 * trajectoire on mesure l'écart produit par chaque effet pris seul ; enfin on résout le réglage complet avec tous
 * les effets actifs ensemble. Six à neuf vols simulés : 3 à 4 ms à 2 500 m, moins de 1 ms à 1 000 m. À appeler quand
 * la situation change (cible, vent, arme), pas à chaque image ; pour un suivi image par image, voir `predictImpact`.
 */
export function firingSolution(w: SolutionWeapon, setup: ShotSetup): FiringSolution | null {
  const range = setup.range;
  const env = setup.env;
  const base = setup.air ?? ICAO;
  const sh = setup.sightHeight ?? 0.05;
  const dt = setup.dt ?? 1 / 400;
  const az = setup.azimuthDeg ?? 0;
  const theta = Math.asin(Math.max(-0.99, Math.min(0.99, (setup.heightDiff ?? 0) / range)));
  const wind = windComponents(setup.windSpeed ?? 0, setup.windFromDeg ?? 0, az);
  const zero = zeroOf(w, sh, base);

  // vol de référence : atmosphère du jour (densité, température de poudre) mais ni vent, ni rotation
  const calm: BallisticEnv | undefined = env ? { ...env, coriolis: false, spinDrift: false, aeroJump: false } : undefined;
  const fCalm = makeFlight(w, calm, { air: base, azimuthDeg: az });
  let e0 = zero;
  for (let i = 0; i < 6; i++) {
    shoot(fCalm, e0, 0, theta, sh, range, 0, 0, dt, false, H0);
    if (!H0.ok) return null;
    if (Math.abs(H0.up) < 1e-3) break; // H0 reste le vol de référence exact pour e0
    e0 -= H0.up / range;
  }
  const tofCalm = H0.t;
  const defl: SolutionParts = { drop: 0, wind: 0, windVertical: 0, spinDrift: 0, coriolisH: 0, coriolisV: 0, aeroJump: 0 };
  defl.drop = -(e0 - zero) * range;

  // vent seul
  if (wind.along !== 0 || wind.right !== 0) {
    shoot(fCalm, e0, 0, theta, sh, range, wind.along, wind.right, dt, false, H1);
    if (H1.ok) { defl.wind = H1.right - H0.right; defl.windVertical = H1.up - H0.up; }
  }
  // Coriolis seul
  if (env?.coriolis) {
    const fC = makeFlight(w, { ...calm!, coriolis: true }, { air: base, azimuthDeg: az });
    shoot(fC, e0, 0, theta, sh, range, 0, 0, dt, false, H1);
    if (H1.ok) { defl.coriolisH = H1.right - H0.right; defl.coriolisV = H1.up - H0.up; }
  }
  // dérive gyroscopique : fonction du seul temps de vol
  const fAll = makeFlight(w, env, { air: base, azimuthDeg: az });
  if (env?.spinDrift) defl.spinDrift = spinDrift(fAll.sg, tofCalm, twistSign(w));
  // saut aérodynamique : angle acquis à la bouche
  const jump = env?.aeroJump ? aeroJumpMil(w, fAll.sg, wind.right) * 0.001 : 0;
  defl.aeroJump = jump * range;

  // réglage complet, tous effets ensemble
  let e = e0 - (defl.windVertical + defl.coriolisV + defl.aeroJump) / range;
  let a = -(defl.wind + defl.spinDrift + defl.coriolisH) / range;
  for (let i = 0; i < 4; i++) {
    shoot(fAll, e + jump, a, theta, sh, range, wind.along, wind.right, dt, false, H1);
    if (!H1.ok) return null;
    if (Math.abs(H1.up) < 1e-3 && Math.abs(H1.right) < 1e-3) break;
    e -= H1.up / range;
    a -= H1.right / range;
  }
  shoot(fAll, e + jump, a, theta, sh, range, wind.along, wind.right, dt, true, H1);

  // correction (mrad) qui annule un écart (m) ; un écart nul donne un zéro franc, pas −0
  const mil = (d: number): number => (d === 0 ? 0 : (-1000 * d) / range);
  const parts: SolutionParts = {
    drop: mil(defl.drop), wind: mil(defl.wind), windVertical: mil(defl.windVertical), spinDrift: mil(defl.spinDrift),
    coriolisH: mil(defl.coriolisH), coriolisV: mil(defl.coriolisV), aeroJump: mil(defl.aeroJump),
  };
  const elevMil = (e - zero) * 1000;
  const max = w.turretMaxMil ?? Infinity;
  return {
    range, tof: H1.t, velocity: H1.v, mach: H1.mach, energy: 0.5 * w.bulletGr * GRAIN_KG * H1.v * H1.v,
    elevMil, windMil: a * 1000, parts, deflection: defl,
    transonicRange: H1.trans, subsonicRange: H1.sub, sg: fAll.sg,
    dialable: elevMil <= max + 1e-9, holdMil: Math.max(0, elevMil - max), v0: fAll.v0,
  };
}

/** Carnet de tir : une solution par distance (les distances hors de portée sont omises). */
export function solutionTable(w: SolutionWeapon, ranges: number[], setup: Omit<ShotSetup, 'range'>): FiringSolution[] {
  const rows: FiringSolution[] = [];
  for (const r of ranges) {
    const s = firingSolution(w, { ...setup, range: r });
    if (s) rows.push(s);
  }
  return rows;
}

export interface ImpactPrediction {
  /** écart du point d'impact par rapport au point visé, mrad (haut et droite positifs) */
  upMil: number;
  rightMil: number;
  /** le même écart en mètres à la cible */
  up: number;
  right: number;
  tof: number;
  velocity: number;
  mach: number;
}

/**
 * Point d'impact prédit pour les réglages de tourelle courants (modes assistés) : où le coup arrivera par rapport
 * au point visé, tous effets de l'environnement compris. Un seul vol simulé. Null si hors de portée.
 */
export function predictImpact(w: SolutionWeapon, setup: ShotSetup, elevMil: number, windMil: number): ImpactPrediction | null {
  const base = setup.air ?? ICAO;
  const sh = setup.sightHeight ?? 0.05;
  const az = setup.azimuthDeg ?? 0;
  const range = setup.range;
  const theta = Math.asin(Math.max(-0.99, Math.min(0.99, (setup.heightDiff ?? 0) / range)));
  const wind = windComponents(setup.windSpeed ?? 0, setup.windFromDeg ?? 0, az);
  const f = makeFlight(w, setup.env, { air: base, azimuthDeg: az });
  const jump = setup.env?.aeroJump ? aeroJumpMil(w, f.sg, wind.right) * 0.001 : 0;
  shoot(f, zeroOf(w, sh, base) + elevMil * 0.001 + jump, windMil * 0.001, theta, sh, range, wind.along, wind.right, setup.dt ?? 1 / 400, false, H1);
  if (!H1.ok) return null;
  return { up: H1.up, right: H1.right, upMil: (H1.up / range) * 1000, rightMil: (H1.right / range) * 1000, tof: H1.t, velocity: H1.v, mach: H1.mach };
}

/** Répartition de l'élévation entre la tourelle (en butée s'il le faut) et la contre-visée au réticule. */
export function splitElevation(elevMil: number, turretMaxMil: number, clickMil = 0.1): { dialMil: number; holdMil: number } {
  const dial = Math.min(turretMaxMil, Math.max(0, Math.round(elevMil / clickMil) * clickMil));
  return { dialMil: dial, holdMil: elevMil - dial };
}
