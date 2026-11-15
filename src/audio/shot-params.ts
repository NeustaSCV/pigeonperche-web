// Paramètres sonores d'un coup de feu, dérivés de la fiche de l'arme (src/config/weapons.ts) : masse de balle,
// vitesse, charge de poudre, type de bouche. Fonctions pures, sans Web Audio : testées dans tests/shot-audio.test.ts.
//
// Le tir est « hybride » : une courte attaque enregistrée (0,3 s, stéréo, une par classe de calibre), puis le grave,
// la queue et les échos synthétisés. Les dosages sont ceux de la maquette retenue (attaque au premier plan, grave
// d'appoint, queue vers −21 à −15 dB, premier écho d'un versant à 230 m à −17 dB) : ne pas les « assagir ». Cinq attaques pour dix-sept armes : ce qui sépare deux armes d'une même classe est
// calculé ici (hauteur de lecture de l'attaque, poids et durée du coup sourd, niveau, queue, écho, gerbes du frein).

export type MuzzleKind = 'none' | 'brake2' | 'brake3' | 'tank' | 'suppressor';
export type AttackClass = 'small' | 'intermediate' | 'medium' | 'magnum' | 'suppressed';

/** Ce que le calcul lit dans une fiche d'arme (un `WeaponDef` convient tel quel). */
export interface ShotSource {
  id: string;
  bulletGr: number;
  v0: number;
  chargeGr: number;
  suppressed: boolean;
  build?: { muzzle: MuzzleKind };
  look?: { brake: boolean };
}

export interface ShotSound {
  id: string;
  /** énergie à la bouche, J */
  energyJ: number;
  /** 0 (.22 LR) à 1 (.50 BMG) : échelle logarithmique de la charge de poudre — durée et grave du souffle */
  s: number;
  /** 0 (.22 LR) à 1 (.50 BMG) : puissance perçue, moyenne des échelles logarithmiques de l'énergie et de la charge */
  power: number;
  muzzle: MuzzleKind;
  /** frein de bouche (2 ou 3 chambres, ou gros frein) : gerbes latérales, image stéréo élargie */
  brake: boolean;
  suppressed: boolean;
  /** balle supersonique à la bouche : bang de la balle au départ */
  supersonic: boolean;
  /** attaque enregistrée employée, et vitesse de lecture (< 1 : plus grave et plus longue) */
  attack: AttackClass;
  rate: number;
  /** durée de la phase positive de l'onde de souffle, s (racine cubique de la charge) : synthèse de repli */
  blastT: number;
  /** coup sourd synthétisé : fréquences de départ et d'arrivée (Hz), constantes de temps (s), gain */
  thump: { f0: number; f1: number; fTau: number; tau: number; gain: number };
  /** jet de gaz grave ajouté sous l'attaque (gros calibres) : gain et constante de temps (s) */
  body: { gain: number; tau: number };
  /** gerbes latérales du frein : gain, retard du second front (s), coupure haute (Hz) */
  side: { gain: number; delay: number; lowpass: number };
  /** niveau du tir dans le mixage, dB sous le .50 BMG, et son facteur linéaire */
  levelDb: number;
  level: number;
  /** saturation douce appliquée au tampon (densité des gros calibres) */
  drive: number;
  /** allongement de la queue diffuse (1 ≈ .308) et brillance de cette queue (0..1) */
  tailK: number;
  tailBright: number;
  /** niveau de la queue, dB sous la détonation ; supplément d'écho des gros calibres, dB */
  tailDb: number;
  echoBoostDb: number;
  /** 0..1 : creux de l'ambiance après le tir (oreilles) */
  duck: number;
}

const GR_KG = 6.479891e-5;
const SOUND_SPEED = 343;
// bornes de la gamme : .22 LR (1,2 gr de poudre, 139 J) et .50 BMG (230 gr, 17 900 J)
const CHARGE_MIN = 1.2, CHARGE_MAX = 230, ENERGY_MIN = 139, ENERGY_MAX = 17888;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const logScale = (v: number, lo: number, hi: number): number => clamp01(Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * clamp01(u);

export function muzzleOf(w: ShotSource): MuzzleKind {
  if (w.suppressed) return 'suppressor';
  return w.build?.muzzle ?? (w.look?.brake ? 'brake3' : 'none');
}

/** Bornes de puissance des classes d'attaque (arme sans modérateur). */
const CLASS_RANGE: Record<Exclude<AttackClass, 'suppressed'>, [number, number]> = {
  small: [0, 0.2],
  intermediate: [0.2, 0.6],
  medium: [0.6, 0.72],
  magnum: [0.72, 1],
};
/** Vitesse de lecture de l'attaque aux deux bornes de sa classe : la plus petite arme de la classe sonne plus haut. */
const CLASS_RATE: Record<Exclude<AttackClass, 'suppressed'>, [number, number]> = {
  small: [1, 1],
  intermediate: [1.04, 0.98],
  medium: [1.06, 0.94],
  // l'attaque « magnum » est une prise de .30-06 : lue telle quelle vers le .300, abaissée de quatre demi-tons pour le .50
  magnum: [1.05, 0.84],
};

export function shotSound(w: ShotSource): ShotSound {
  const energyJ = 0.5 * w.bulletGr * GR_KG * w.v0 * w.v0;
  const s = logScale(w.chargeGr, CHARGE_MIN, CHARGE_MAX);
  const power = 0.45 * s + 0.55 * logScale(energyJ, ENERGY_MIN, ENERGY_MAX);
  const muzzle = muzzleOf(w);
  const suppressed = muzzle === 'suppressor';
  const brake = muzzle === 'brake2' || muzzle === 'brake3' || muzzle === 'tank';
  const supersonic = w.v0 > SOUND_SPEED * 1.03;

  let attack: AttackClass = 'suppressed';
  let rate = 1;
  if (!suppressed) {
    attack = power < CLASS_RANGE.small[1] ? 'small' : power < CLASS_RANGE.intermediate[1] ? 'intermediate' : power < CLASS_RANGE.medium[1] ? 'medium' : 'magnum';
    const [lo, hi] = CLASS_RANGE[attack];
    rate = lerp(CLASS_RATE[attack][0], CLASS_RATE[attack][1], (power - lo) / (hi - lo));
  }

  // Niveau de crête du tir dans le mixage, relevé sur la maquette : .22 LR à −7,6 dB, du .223 au .50 presque à
  // égalité (c'est la durée, le grave et la queue qui font la différence de force), modérateur à −10,7 dB.
  let levelDb = -7.6 * Math.pow(1 - power, 2.5);
  if (suppressed) levelDb = -10.7;

  const heavy = clamp01((power - 0.5) / 0.5);
  return {
    id: w.id, energyJ, s, power, muzzle, brake, suppressed, supersonic, attack, rate,
    blastT: 0.0002 * Math.cbrt(w.chargeGr / CHARGE_MIN),
    // coup sourd : de 260 Hz (.22 LR) à 130 Hz (.50 BMG) au départ, il chute d'une octave ; simple appoint sous
    // l'attaque enregistrée (cube de la charge, rien sous le .223) : c'est lui qui sépare un .338 d'un .50
    thump: {
      f0: 260 - 130 * s, f1: 110 - 50 * s, fTau: 0.025 + 0.04 * s, tau: 0.02 + 0.065 * s,
      gain: suppressed || s <= 0.3 ? 0 : 0.4 * s * s * s,
    },
    body: { gain: 0, tau: 0.02 + 0.07 * heavy * heavy },
    side: {
      gain: muzzle === 'tank' ? 0.34 : muzzle === 'brake3' ? 0.26 : muzzle === 'brake2' ? 0.2 : 0,
      delay: muzzle === 'tank' ? 0.0009 : 0.0005,
      lowpass: muzzle === 'tank' ? 5200 : 9000,
    },
    levelDb, level: Math.pow(10, levelDb / 20),
    drive: 1.15 + 0.9 * s,
    tailK: (0.5 + 1.15 * s) * (suppressed ? 0.5 : 1),
    tailBright: suppressed ? 0.1 : 0.55,
    tailDb: -21 + 6 * s - (suppressed ? 8 : 0),
    echoBoostDb: 5 * s - (suppressed ? 8 : 0),
    duck: suppressed ? 0.03 : clamp01(0.1 + 0.72 * Math.pow(power / 0.8, 1.6)),
  };
}

// ------------------------------------------------------------------------------------------ écho de la carte

/**
 * Relief qui renvoie le son du tir, vu du site de tir. Déclaré par chaque niveau (`LevelData.echo`, voir
 * src/levels/README.md).
 */
export interface EchoRelief {
  /** distance du site de tir au relief, m : l'écho revient après 2 × distance / 343 s */
  distance: number;
  /** azimut du relief vu du site, degrés (0 = nord, sens horaire) : l'écho vient de ce côté-là, où que regarde le joueur */
  bearing: number;
  /** taille apparente : 0,2 une lisière ou une butte, 0,5 un versant, 1 une paroi ou un grand versant proche */
  size: number;
}

export interface EchoSpec {
  /** reliefs réfléchissants, six au plus (les plus sonores sont gardés) */
  reliefs: EchoRelief[];
  /** queue diffuse : 1 = vallée, 0,5 = terrain ouvert, 1,3 = cirque fermé (défaut 1) */
  tail?: number;
}

/** Carte sans indication : une vallée moyenne, deux versants et un fond. */
export const DEFAULT_ECHO: EchoSpec = {
  reliefs: [{ distance: 320, bearing: 300, size: 0.5 }, { distance: 560, bearing: 70, size: 0.45 }, { distance: 950, bearing: 350, size: 0.4 }],
  tail: 1,
};

export const MAX_ECHO_TAPS = 6;

export interface EchoTap {
  /** retard aller-retour, s */
  delay: number;
  /** niveau sous la détonation, dB (arme moyenne ; `echoBoostDb` de l'arme s'y ajoute) */
  db: number;
  gain: number;
  /** coupure du passe-bas : l'air mange l'aigu avec la distance */
  lowpass: number;
  /** étalement du retour, s : un relief lointain ou large renvoie un son plus long et plus flou */
  rough: number;
  bearing: number;
}

/**
 * Niveau du premier écho : un versant de taille 0,6 à 230 m revient 17 dB sous la détonation (valeur de la maquette
 * retenue), puis −9 dB par doublement de la distance et 20·log10 de la taille.
 */
export const ECHO_REF_DB = -17;

export function echoTaps(spec: EchoSpec | undefined | null): EchoTap[] {
  const reliefs = (spec ?? DEFAULT_ECHO).reliefs.filter((r) => r.distance > 30 && r.size > 0);
  return reliefs
    .map((r) => {
      const d = Math.min(r.distance, 2600);
      const db = ECHO_REF_DB - 9 * Math.log2(d / 230) + 20 * Math.log10(Math.min(1.2, r.size) / 0.6);
      return { delay: (2 * d) / SOUND_SPEED, db, gain: Math.pow(10, db / 20), lowpass: 500 + 4500 * Math.exp(-d / 450), rough: Math.min(0.4, 0.14 * Math.pow(d / 230, 0.6)), bearing: r.bearing };
    })
    .sort((a, b) => b.db - a.db)
    .slice(0, MAX_ECHO_TAPS)
    .sort((a, b) => a.delay - b.delay);
}

/** Position stéréo (−1 gauche, +1 droite) d'un relief d'azimut `bearing` pour un joueur qui regarde vers (fx, fz) ; nord = −Z, est = +X. */
export function echoPan(bearing: number, fx: number, fz: number): number {
  const b = (bearing * Math.PI) / 180;
  const dx = Math.sin(b), dz = -Math.cos(b);
  const len = Math.hypot(fx, fz);
  if (len < 1e-4) return 0;
  // droite = avant × haut = (−fz, 0, fx)
  return Math.max(-1, Math.min(1, ((dx * -fz + dz * fx) / len) * 0.85));
}
