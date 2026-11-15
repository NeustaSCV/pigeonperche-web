// Contrat entre le jeu et le moteur audio. Le moteur est synthétisé (Web Audio) ; seuls l'attaque du coup de feu et la
// mécanique de culasse partent d'enregistrements (src/audio/samples.ts), avec repli sur la synthèse.
import type { EchoSpec, ShotSource } from './shot-params';

export type Surface = 'grass' | 'stone' | 'gravel' | 'wood';

export type ImpactKind =
  | 'steel' // plaque d'acier : « ding » clair et long
  | 'bell' // cloche, timbre d'horloge : coup de marteau puis note tenue de bronze, 4 à 5 s
  | 'dirt'
  | 'rock'
  | 'glass'
  | 'wood'
  | 'metal' // tôle, carrosserie, bidon
  | 'body' // sourd, sobre
  | 'balloon' // éclatement
  | 'water'
  | 'fuel' // embrasement / déflagration sourde
  | 'electric' // grésillement, court-circuit
  | 'tire'; // sifflement d'air

/**
 * Ancienne signature sonore d'une munition (config/weapons.ts). Le moteur ne la lit plus : le tir est dérivé de la
 * fiche de l'arme (src/audio/shot-params.ts). Conservée dans les fiches comme description.
 */
export interface ShotProfile {
  /** 0..1 : niveau global (0,12 pour le .22 LR subsonique, 1 pour le .338 LM). */
  loudness: number;
  /** 0..1 : poids du coup sourd dans le grave. */
  bass: number;
  /** 0..1 : brillance (contenu aigu) de la détonation. */
  brightness: number;
  /** Durée en secondes de la queue de détonation avant échos. */
  tail: number;
  /** Vrai si le projectile est supersonique à la bouche (claquement sec superposé). */
  supersonic: boolean;
  /** Vrai si un modérateur de son est monté. */
  suppressed: boolean;
}

export interface AmbienceState {
  /** Vitesse du vent au joueur, rafales comprises, en m/s (0 à 14 environ). */
  windSpeed: number;
  /** 0..1 intensité de la rafale en cours. */
  gust: number;
  /** 0..1 proximité d'arbres (bruissement). */
  treeProximity: number;
  /** Vue lunette active : respiration et cœur audibles, ambiance légèrement étouffée. */
  inScope: boolean;
  /** Battements par minute (55 à 150). */
  heartRate: number;
  /** État du souffle. */
  breath: 'normal' | 'held' | 'gasping';
  /** 0..1 activité du marché (rumeur lointaine) ; passe à 0 après la panique. */
  marketActivity: number;
  /** Sirène du campement en alerte. */
  alarm: boolean;
  /** Échelle de temps du jeu (1 normal, 0,05 à 0,3 pendant la caméra de balle). */
  timeScale: number;
  /** Menu d'accueil affiché : ambiance seule, plus ample. */
  menu: boolean;
}

/**
 * Repères sonores d'une carte (x, y, z). Chacun est facultatif : absent ou null, le son n'est jamais joué.
 * Une carte sans village ni cloche ne doit pas hériter de ceux d'une autre.
 */
export interface Landmarks {
  /** rumeur de foule (marché) : audible si le niveau renvoie une activité > 0 par `audioFrame` */
  village?: [number, number, number] | null;
  /** cloche (quelques coups de loin en loin). Absente : celle du village s'il y en a un ; null : pas de cloche. */
  bell?: [number, number, number] | null;
  /** sirène de la zone d'alerte quand l'alerte est donnée */
  camp?: [number, number, number] | null;
  /** plan d'eau (réservé : aucun son d'eau pour l'instant) */
  lake?: [number, number, number] | null;
}

export interface IAudioEngine {
  /** À appeler depuis un geste utilisateur ; crée ou reprend l'AudioContext. Idempotent. */
  start(): Promise<void>;
  readonly started: boolean;
  setMasterVolume(v: number): void;
  setLandmarks(l: Landmarks): void;
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void;
  /** Chaque image. */
  update(dt: number, state: AmbienceState): void;

  /** Reliefs de la carte qui renvoient le son du tir (`LevelData.echo`) ; null ou absent : valeurs par défaut. */
  setEcho(spec: EchoSpec | null | undefined): void;
  /** Prépare le tir d'une arme (calcul du tampon) : à appeler quand le joueur la prend, pas au départ du coup. */
  prepareShot(weapon: ShotSource): void;
  /** Coup de feu du joueur (à la position du joueur) : détonation selon l'arme, queue, écho des reliefs de la carte. */
  shot(weapon: ShotSource): void;
  boltOpen(): void;
  boltClose(): void;
  dryFire(): void;
  magOut(): void;
  magIn(): void;
  turretClick(): void;
  zoomClick(): void;
  rangefinder(): void;

  /**
   * Impact à la position donnée, entendu après delaySec (temps de vol + retour du son, déjà calculé par le jeu).
   * energyJ module le niveau. L'atténuation avec la distance doit rester audible à 1 500 m (loi douce, pas 1/d² strict).
   */
  impact(kind: ImpactKind, x: number, y: number, z: number, delaySec: number, energyJ: number): void;
  /** Sifflement / passage de la balle pendant la caméra de balle (0 pour arrêter). */
  bulletWhoosh(level: number): void;

  footstep(surface: Surface, intensity: number): void;
  /** Frottement d'équipement (changement de posture, rampé). */
  cloth(intensity: number): void;

  /** Moteur du véhicule lointain : position et régime 0..1 ; level 0 pour couper. */
  vehicle(x: number, y: number, z: number, level: number): void;
  /** Bourdonnement du drone ; level 0 pour couper. */
  drone(x: number, y: number, z: number, level: number): void;
  /** Cris de panique lointains du marché (sobre), une fois. */
  crowdPanic(x: number, y: number, z: number): void;

  ui(kind: 'hover' | 'select' | 'confirm' | 'fail' | 'success' | 'page'): void;
}
