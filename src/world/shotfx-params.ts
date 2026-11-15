// Intensité des effets visuels du coup de feu, dérivée de la fiche de l'arme : fonctions pures, sans dépendance au
// moteur de rendu (testées dans tests/shotfx.test.ts). Le rendu est dans src/world/shotfx.ts.
//
// Tout part d'une « énergie visuelle » e, de 0 (.22 LR, 1,2 grain de poudre) à 1 (.50 BMG, 230 grains), qui suit le
// logarithme de la charge : chaque grandeur est une fonction croissante de e, donc monotone avec la charge.
// La forme de la flamme suit la bouche de l'arme (`build.muzzle`, à défaut `suppressed` puis `look.brake`).

export type MuzzleKind = 'none' | 'brake2' | 'brake3' | 'tank' | 'suppressor';
/** forme de la flamme : aucune (modérateur, .22 LR), axiale (canon nu), gerbes latérales (frein à chambres), gros frein */
export type FlameShape = 'none' | 'axial' | 'side' | 'tank';

/** ce que la dérivation lit de la fiche (sous-ensemble de WeaponDef : les tests peuvent passer une fiche partielle) */
export interface ShotFxSource {
  chargeGr: number;
  suppressed: boolean;
  bulletDiaMm?: number;
  look?: { brake: boolean };
  build?: { muzzle: MuzzleKind };
}

export interface ShotFxParams {
  /** bouche de l'arme retenue */
  muzzle: MuzzleKind;
  /** énergie visuelle 0..1 */
  energy: number;
  shape: FlameShape;
  /** nombre d'évents latéraux de chaque côté (0 : canon nu ou modérateur) */
  ports: number;
  /** taille de la flamme, 0 (aucune) à 1,25 (.50 BMG) : multiplie les longueurs en mètres du maillage */
  flame: number;
  /** nombre d'images où la flamme reste visible (1 ou 2 ; la seconde à 20 %) */
  flameFrames: number;
  /** éclair du départ du coup (halo autour de la flamme), 0..1 */
  glow: number;
  /** fumée à la bouche, 0..1 (taille et opacité) et nombre de particules */
  smoke: number;
  smokeCount: number;
  /** poussière soulevée quand la bouche est au ras du sol, 0..1 ; voir `dustAt` pour l'effet de la hauteur */
  dust: number;
  /** particules de poussière par vague, au ras du sol */
  dustCount: number;
  /** seconde vague de poussière (60 ms plus tard, plus loin) : coupée en version allégée */
  dustWaves: number;
  /** recul vu de l'extérieur, 0..1 : arme, tireur, saut du bipied */
  recoil: number;
  /** facteur appliqué à l'impulsion du saut du champ de la lunette (1 = saut d'origine) */
  scopeJump: number;
  /** voile dans la lunette : opacité maximale 0..1 et constante de temps (s) de sa dissipation */
  veil: number;
  veilTau: number;
  /** éclair d'une image dans le bas du champ de la lunette, 0..1 */
  scopeFlash: number;
  /** douille : longueur et rayon, m */
  caseLen: number;
  caseR: number;
  /** version allégée (téléphone, qualité basse) */
  lite: boolean;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const CHARGE_MIN = 1.2, CHARGE_MAX = 230;

/** Énergie visuelle 0..1 : logarithme de la charge de poudre, de la .22 LR (0) au .50 BMG (1). */
export function shotEnergy(chargeGr: number): number {
  const s = clamp01(Math.log(Math.max(chargeGr, CHARGE_MIN) / CHARGE_MIN) / Math.log(CHARGE_MAX / CHARGE_MIN));
  return Math.pow(s, 1.5);
}

/** Bouche de l'arme : celle du modèle 3D si la fiche la décrit, sinon déduite de `suppressed` et de `look.brake`. */
export function muzzleOf(w: ShotFxSource): MuzzleKind {
  if (w.suppressed) return 'suppressor';
  return w.build?.muzzle ?? (w.look?.brake ? 'brake3' : 'none');
}

/** seuil sous lequel la flamme n'est pas dessinée (la .22 LR et les très petites charges) */
const FLAME_MIN = 0.08;

/**
 * Paramètres des effets d'un tir pour une arme. `lite` : version allégée (téléphone) : 30 % de particules en moins,
 * flamme d'une seule image, une seule vague de poussière ; les intensités visibles
 * (flamme, recul, saut de lunette, voile) sont inchangées.
 */
export function shotFxParams(w: ShotFxSource, lite = false): ShotFxParams {
  const muzzle = muzzleOf(w);
  const sup = muzzle === 'suppressor';
  const e = shotEnergy(w.chargeGr);
  const flame = sup || e < FLAME_MIN ? 0 : 1.25 * e;
  const shape: FlameShape = flame === 0 ? 'none' : muzzle === 'none' ? 'axial' : muzzle === 'tank' ? 'tank' : 'side';
  const ports = shape === 'side' ? (muzzle === 'brake3' ? 3 : 2) : shape === 'tank' ? 2 : 0;
  // modérateur : les gaz sont détendus dans le tube, il ne reste qu'un filet de fumée et un souffle très amorti
  const gas = sup ? 0.1 : 1;
  const dust = e < FLAME_MIN ? 0 : e * gas;
  const pk = lite ? 0.7 : 1;
  const veil = 0.85 * Math.pow(e, 2.5) * (sup ? 0.15 : 1);
  return {
    muzzle, energy: e, shape, ports, flame,
    flameFrames: lite || flame === 0 ? (flame === 0 ? 0 : 1) : 2,
    glow: flame === 0 ? 0 : 0.2 + 0.8 * e,
    smoke: (0.12 + 0.88 * e) * (sup ? 0.3 : 1),
    smokeCount: Math.round((2 + 9 * e) * (sup ? 0.4 : 1) * pk),
    dust,
    dustCount: Math.round(44 * dust * pk),
    dustWaves: lite ? 1 : 2,
    recoil: (0.05 + 0.95 * e) * (sup ? 0.6 : 1),
    scopeJump: 1 + 0.25 * e * (sup ? 0 : 1),
    veil,
    veilTau: 0.06 + 0.2 * e * e,
    scopeFlash: flame === 0 ? 0 : 0.5 * e,
    caseLen: Math.min(0.1, Math.max(0.015, 0.012 + w.chargeGr * 0.00042)),
    caseR: Math.max(0.0029, Math.min(0.0102, (w.bulletDiaMm ?? 7.8) * 0.00078)),
    lite,
  };
}

/**
 * Poussière réellement soulevée, 0..1, pour une bouche à `height` mètres du sol : entière au ras du sol (tir couché
 * sur bipied, 0,2 à 0,3 m), nulle dès que le souffle n'atteint plus le sol (0,7 m pour un .223, 1,1 m pour un .308,
 * 2,1 m pour le .50 BMG, dont le frein rabat le souffle vers le sol).
 * La portée du souffle grandit avec la charge.
 */
export function dustAt(p: ShotFxParams, height: number): number {
  if (p.dust <= 0) return 0;
  const reach = 0.3 + 1.5 * p.energy * p.energy;
  return p.dust * clamp01(1 - (height - 0.3) / reach);
}

/**
 * Opacité du voile de la lunette `t` secondes après le tir. `dust` : poussière soulevée (`dustAt`), qui prolonge le
 * voile ; sans elle (tir accroupi, sol dur) il ne reste que le souffle, plus pâle et deux fois plus bref.
 * Bornes voulues : calibres standards, moins de 10 % après 0,4 s ; tous, moins de 3 % après 1 s.
 */
export function veilAt(p: ShotFxParams, t: number, dust: number): number {
  if (t < 0 || p.veil <= 0) return 0;
  const k = p.dust > 0 ? clamp01(dust / p.dust) : 0;
  const peak = p.veil * (0.55 + 0.45 * k);
  const tau = p.veilTau * (0.5 + 0.5 * k);
  // montée en une image et demie (le souffle arrive), puis dissipation
  return peak * Math.min(1, t / 0.025) * Math.exp(-Math.max(0, t - 0.025) / tau);
}

/**
 * Recul vu de l'extérieur, `t` secondes après le tir : courbes sans dimension à multiplier par `recoil`.
 * `back` : l'arme part en arrière et revient (maximum 1 vers 45 ms) ; `hop` : saut du bipied (tir couché), une
 * parabole de 0,14 s suivie d'un petit rebond ; `body` : buste et tête du tireur, oscillation amortie.
 * Tout est nul à t = 0 (l'image de la flamme montre l'arme encore en place) et après 0,7 s.
 */
export function recoilAt(t: number): { back: number; hop: number; body: number } {
  if (t <= 0 || t > 0.7) return { back: 0, hop: 0, body: 0 };
  const back = (1 - Math.exp(-t / 0.018)) * Math.exp(-t / 0.11) * 1.52;
  const hop = t < 0.14 ? Math.sin((Math.PI * t) / 0.14) : t < 0.22 ? 0.22 * Math.sin((Math.PI * (t - 0.14)) / 0.08) : 0;
  const body = (1 - Math.exp(-t / 0.03)) * Math.exp(-t / 0.09) * Math.cos(t * 14) * 1.6;
  return { back: Math.min(1, back), hop, body };
}
