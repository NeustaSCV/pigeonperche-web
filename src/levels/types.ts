// Contrat d'un niveau (une carte). Voir src/levels/README.md.
// Un niveau = un dossier src/levels/<id>/ : meta.ts (fiche du menu), map.ts (données), index.ts (le module `level`),
// terrain.gen.mjs (relief). Le moteur, le joueur, les cibles et l'interface sont communs et lisent ces données.
import type { Object3D, PerspectiveCamera, Vector3 } from 'three';
import type { Landmarks, Surface } from '../audio/types';
import type { AudioEngine } from '../audio/engine';
import type { Engine } from '../core/engine';
import type { Step } from '../game/mission';
import type { ImpactReport } from '../game/shots';
import type { Target } from '../game/targets';
import type { Colliders } from '../world/colliders';
import type { Fx } from '../world/fx';
import type { Terrain } from '../world/terrain';
import type { VegetationSpec } from '../world/vegetation';
import type { Wind } from '../world/wind';

export type LevelId = 'facile' | 'standard' | 'avance';
/** Aides au tir : assist = télémètre continu + impact prédit ; standard = télémètre + vent ; real = aucune aide. */
export type Difficulty = 'assist' | 'standard' | 'real';

/** Fiche du menu (src/levels/<id>/meta.ts) : petite, chargée d'emblée pour les trois niveaux. */
export interface LevelMeta {
  id: LevelId;
  /** nom du bouton du menu */
  title: string;
  /** sous-titre de l'écran d'accueil (« une montagne, une vallée, dix cibles ») */
  tagline: string;
  /** une phrase sous le choix du niveau : portées, ambiance */
  note: string;
  /** préréglage d'aides attaché au niveau */
  difficulty: Difficulty;
  /** faux tant que la carte n'est pas livrée : le bouton reste « à venir » */
  ready: boolean;
}

/** Poste de tir nommé. Le site de tir est à l'origine ; `y` = plancher au-dessus du sol du site, `ground` = sol propre. */
export interface PostDef {
  label: string;
  x: number;
  z: number;
  y?: number;
  ground?: number;
  stance: 'prone' | 'crouch';
}

/** Ligne de visée garantie poste → point (y au-dessus du sol en place, ou altitude absolue si abs). */
export interface Sightline {
  post: string;
  x: number;
  z: number;
  y: number;
  abs?: boolean;
}

/** Relief : fichiers public/terrain/<id>/ produits par tools/gen-terrain.mjs, et retouches appliquées à l'exécution. */
export interface TerrainSpec {
  /** dossier sous public/terrain/ (l'identifiant du niveau) */
  dir: string;
  /** côté de la carte (m) et résolution de la carte de hauteur : doivent être ceux de terrain.gen.mjs */
  size: number;
  res: number;
  /** niveau de l'eau (lac), ou null s'il n'y en a pas : rive mouillée, gerbes d'eau */
  waterLevel: number | null;
  /** aires sans relief de détail (cibles proches posées au sol) */
  pads: { x: number; z: number; r0: number; r1: number }[];
  /** retouches fines près du site (à moins de 60 m de l'origine) */
  sculpt: { x: number; z: number; h: number; r0: number; r1: number }[];
  /**
   * cônes de vue devant les postes (à moins de 110 m de l'origine) : le sol passe sous un plan incliné.
   * Facultatifs : `drop` et `dropLen`, pente et longueur du ressaut au pied du tireur (défaut 0,58 sur 6 m) ;
   * `soft`, rayon de raccord (m) entre le sol en place et le plan (défaut 0 : arête vive, visible en facettes).
   */
  clear: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number; drop?: number; dropLen?: number; soft?: number }[];
}

type RGB = [number, number, number];
/**
 * Palette de la carte : teintes multipliées aux matières du relief et à la végétation (RVB linéaire, 1 = inchangé).
 * Tout est facultatif ; sans palette, le pays vert de la carte d'origine.
 */
export interface PaletteSpec {
  /** matières du relief : herbe, roche, éboulis, sol de forêt, terre battue, mousse */
  grass?: RGB;
  rock?: RGB;
  scree?: RGB;
  forest?: RGB;
  dirt?: RGB;
  moss?: RGB;
  /** taches d'herbe sèche : décalage du seuil, de −0,5 (aucune) à +0,5 (partout) ; défaut 0 */
  dryness?: number;
  /** quantité de mousse près du site (défaut 1) */
  mossAmount?: number;
  /**
   * brins d'herbe : teinte, densité et hauteur relatives (défaut 1), part de brins fleuris (défaut 1 = 3 %) ;
   * `chunk` : côté des pavés d'herbe en mètres (défaut 8 ; un appel de dessin par pavé : 12 pour une herbe clairsemée)
   */
  blades?: { tint?: RGB; density?: number; height?: number; flowers?: number; chunk?: number };
  /** feuillage des arbres (détaillés, lointains, et ceux des modèles de bâtiments), fougères et touffes */
  foliage?: RGB;
  understory?: RGB;
  /** rochers semés et gros blocs */
  rocks?: RGB;
}

/** Réglages de rendu liés à la portée de la carte. */
export interface RenderSpec {
  /** plan lointain de la caméra (m) */
  cameraFar: number;
  /** portée des ombres en cascade (m) */
  shadowFar: number;
  /** densité de la brume atmosphérique (1 = référence du niveau standard) */
  haze: number;
  /** rayon planté d'arbres autour du site (m) */
  treeRange: number;
}

/**
 * Physique du tir propre au niveau, lue par le vol des balles (src/game/shots.ts), le carnet de tir et le point
 * d'impact prédit. Tout à `false` (et pas de `powderTempSens`) : balistique d'origine, traînée + gravité dans l'air
 * du jeu. Un seul effet actif suffit à faire passer le carnet en présentation décomposée.
 */
export interface LevelPhysics {
  /** latitude du pas de tir, degrés (positive au nord) : intensité et sens de Coriolis */
  latitudeDeg: number;
  /** altitude du poste de tir, m, et température, °C : servent si `densityFromAltitude` */
  altitudeM: number;
  temperatureC: number;
  /** force de Coriolis : dérive horizontale et effet vertical selon l'azimut de tir */
  coriolis: boolean;
  /** dérive gyroscopique (pas à droite : vers la droite) */
  spinDrift: boolean;
  /** saut aérodynamique : écart vertical dû au vent traversier à la bouche */
  aeroJump: boolean;
  /** densité de l'air et vitesse du son calculées d'après altitude et température, variables le long du vol */
  densityFromAltitude: boolean;
  /** pression au poste, hPa (absente : atmosphère type à cette altitude) ; humidité relative, % (0 par défaut) */
  pressureHPa?: number;
  humidityPct?: number;
  /** sensibilité de la poudre à la température, m/s par °C d'écart à 15 °C (0 ou absent : aucune) */
  powderTempSens?: number;
}

/**
 * Bâtiment à poser dans le décor (voir src/levels/buildings.ts). Seuls `id`, `x`, `z`, `yaw` sont obligatoires.
 * Les identifiants, cartes et tailles de lot sont dans src/levels/building-lots.ts (catalogue sans dépendance).
 */
export interface BuildingSpot {
  /** identifiant de la banque (« eglise », « moulin », « sanatorium »…) */
  id: string;
  /** variante du modèle (« galeries », « batiments »…) ; '*' : une halte entière ; absente : la première */
  carte?: string;
  /** centre du lot dans le monde */
  x: number;
  z: number;
  /** lacet en radians, sens trigonométrique vu de dessus ; à 0 la façade principale (sud) regarde +z */
  yaw: number;
  /** de 0,1 (vieilli) à 1 (effondré) ; 0,7 par défaut */
  usure?: number;
  /** nom pour retrouver le bâtiment depuis le niveau : `h.buildings.get(name)` ; par défaut son `id` */
  name?: string;
  /**
   * Altitude du y = 0 du bâtiment. Absente : celle du terrassement (`lib.flattenBuildings`, écrite dans meta.json),
   * à défaut le relief en place au centre du lot.
   */
  groundY?: number;
  /**
   * Sol du lot : 'paved' sans pelouse ni terre nue (le relief du jeu passe dessous), 'keep' tout le sol du modèle,
   * 'none' aucune dalle. Par défaut 'keep' pour un modèle qui fournit son sol (creusé), 'paved' sinon.
   */
  ground?: 'paved' | 'keep' | 'none';
  /** niveau de détail : 'auto' (défaut, complet de près ou en lunette, simplifié de loin), 'full', 'far' */
  lod?: 'auto' | 'full' | 'far';
  /** les vitres arrêtent les balles (défaut : non, une balle les traverse) */
  glassStops?: boolean;
  /** enregistrer aussi les murs comme obstacles à la marche (bâtiment au contact du site de tir ; défaut : non) */
  walkable?: boolean;
  /** objets nommés du modèle à montrer ou à cacher */
  show?: string[];
  hide?: string[];
}

/** Voie secondaire d'une carte, telle que déclarée dans map.ts (`WAYS`) et lue par le générateur de relief. */
export interface WaySpec {
  name: string;
  /** 'route' : rue, route industrielle (pente ≤ 10 %) ; 'chemin' : chemin de terre (≤ 14 %) ; 'allee' : allée gravillonnée */
  kind: 'route' | 'chemin' | 'allee';
  /** largeur de la chaussée (m) */
  width: number;
  /** points de passage (x, z), du raccord au réseau jusqu'à l'entrée desservie ; lissés par le générateur */
  pts: [number, number][];
  /** nom du bâtiment desservi (`BuildingSpot.name`) : l'arrivée est mise à l'altitude de son sol */
  to?: string;
  /** pente maximale (m/m) si elle diffère de celle de la nature de la voie */
  maxSlope?: number;
  /** ponts : centre, altitude du tablier, portée ; 'pierre' (défaut), 'bois' ou 'beton' */
  bridges?: { x: number; z: number; deck: number; length: number; kind?: 'pierre' | 'bois' | 'beton'; width?: number }[];
}

/** Point d'intérêt d'un bâtiment posé, dans le monde : où accrocher une cible ou poster une sentinelle. */
export interface BuildingPoint {
  /** 'window', 'door', 'breach', 'opening' : ouvertures ; 'roof', 'gallery' : planchers en hauteur ; 'ground' ; 'summit' */
  kind: string;
  /** centre de l'ouverture, ou point du plancher */
  position: Vector3;
  /** où poser les pieds (derrière l'ouverture, sur le replat) ; null si rien de praticable */
  stand: Vector3 | null;
  /** direction horizontale vers l'extérieur (monde), et la même en cap du jeu (radians, 0 = nord) ; (0, 0) : tout autour */
  nx: number;
  nz: number;
  bearing: number;
  /** largeur et hauteur de l'ouverture, ou étendue du plancher (m) */
  width: number;
  height: number;
  /** part de l'ouverture qu'une balle traverse (0 à 1), pour une ouverture */
  clear?: number;
  note?: string;
  /** 'manual' : relevé à la main (les meilleurs, en tête de liste) ; 'auto' : calculé ; 'fiche' : fiche du modèle */
  source: string;
}

/** Bâtiment posé, vu par le niveau (cibles accrochées, repères sonores). */
export interface BuildingHandle {
  spot: BuildingSpot;
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** altitude de son y = 0, et hauteur du bâtiment au-dessus */
  groundY: number;
  height: number;
  /** points d'intérêt dans le monde (calculés à la première demande : 50 à 300 ms), filtrés par nature si demandé */
  points(...kinds: string[]): BuildingPoint[];
  /** point du repère local du bâtiment (origine au centre du lot, +x est, +z sud à yaw 0, y = 0 au sol) → monde */
  toWorld(x: number, y: number, z: number): Vector3;
}

/** Bâtiments posés du niveau : `h.buildings`, disponible à partir de buildTargets(). */
export interface LevelBuildings {
  list: BuildingHandle[];
  get(name: string): BuildingHandle | undefined;
}

/** Tutoriel du premier objectif : deux cibles fixes (une proche, une plus loin) depuis un poste, puis le râtelier. */
export interface TutorialSpec {
  post: string;
  near: string;
  far: string;
  /** « la brèche est » (avec article), « brèche est » (sans) */
  postPhrase: string;
  postShort: string;
  /** où chercher la cible proche : « à l’est, près du fanion rouge » */
  nearHint: string;
  /** où est le râtelier : « sous l’abri au sud de la cour » */
  rackHint: string;
}

/** Une ligne du plan du tireur automatique (e2e/mission.mjs). */
export interface TestStep {
  step: string;
  post: string;
  weapon: string;
  targets: string[];
  zoom: number;
}

/** Positions du scénario tactile (e2e/mobile.mjs, e2e/tutorial.mjs). Les cibles proches sont celles de `tutorial`. */
export interface TouchScenario {
  /** au poste du tutoriel, face à la cible proche : [x, z, yaw] */
  post: [number, number, number];
  /** devant le râtelier, face à lui : [x, z, yaw] */
  rack: [number, number, number];
  /** vue d'ensemble du site, à la troisième personne : [x, z, yaw] */
  yard: [number, number, number];
  /** tir lointain en lunette : arguments de player.teleport (x, z, yaw, posture, hauteur du plancher) et cible visée */
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  /** scène la plus chargée en lunette (mesure de cadence) : arme, position, cible */
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  /**
   * Niveau sans tutoriel (ou dont le scénario tactile ne suit pas le tutoriel) : clé du poste où mène la marche à la
   * boussole, et cible proche réglée, télémétrée et tirée depuis `post`. Par défaut ceux de `tutorial`.
   */
  postKey?: string;
  near?: string;
  /** arme des mesures optiques de e2e/mobile.mjs (lunette ×8 à ×25) ; défaut : '338lm' si elle est au râtelier, sinon l'arme de départ */
  weapon?: string;
  /** e2e/tutorial.mjs : points de passage (x, z) à pied du poste du tutoriel au râtelier ; défaut [[12, 6]] (carte d'origine) */
  rackWalk?: [number, number][];
}

/**
 * Vue de mesure (e2e/perf.mjs). `at` : arguments de player.teleport (x, z, cap, posture,
 * hauteur du plancher). Œil nu : `pitch` (rad). Lunette : `scope` (arme, grossissement, cible visée, tourelle réglée).
 */
export interface TestView {
  at: [number, number, number, 'stand' | 'crouch' | 'prone', number?];
  pitch?: number;
  scope?: { weapon: string; zoom: number; target: string };
}

/**
 * Vent de la carte. Absent : le vent d'origine (3,5 m/s du 255°), que le niveau pouvait régler à la main dans
 * `buildSite` (`h.wind.baseSpeed`, `h.wind.fromBearing`) — toujours possible, mais ce champ le fait dès la première image.
 */
export interface WindSpec {
  /** azimut d'où souffle le vent (degrés, 0 = du nord) et vitesse moyenne (m/s) */
  fromBearing: number;
  speed: number;
  /** amplitude des rafales : 1 (défaut) = de 0,5 à 1,5 fois la moyenne selon l'endroit et l'instant ; 0 = régulier */
  gusts?: number;
  /** vent propre à un objectif (clé : id de `steps`) ; il s'installe en une dizaine de secondes */
  steps?: Record<string, { speed?: number; fromBearing?: number }>;
  /** part du vent qui reste au fond de la vallée (défaut 0,62) et hauteur au-dessus du fond où il est plein (défaut 200 m) */
  shelter?: number;
  shelterHeight?: number;
}

/** Cotes de l'atmosphère, rapportées au relief de la carte. Tout est facultatif : défaut = carte d'origine. */
export interface AtmosphereSpec {
  /**
   * Altitude du fond de vallée (m ; défaut 0). La brume (voile d'altitude, brume basse, nappe), l'abri du vent,
   * la teinte d'altitude du relief et l'étage des feuillus se comptent à partir d'elle.
   */
  valleyY?: number;
  /** nappe de brume du fond de vallée : base et sommet au-dessus de `valleyY` (défaut 4 et 110 m) */
  mistBase?: number;
  mistTop?: number;
  /** densité de la brume basse et de la nappe (défaut 1 ; 0 = aucune) */
  mist?: number;
}

/** Ciel de la carte. Tout est facultatif : défaut = ciel d'origine (photographie de fin d'après-midi, bande de nuages). */
export interface SkySpec {
  /**
   * Part de ciel dégagé, de 0 (la photographie telle quelle) à 1 (dégradé calculé, sans nuage) : la photographie est
   * fondue dans un ciel clair d'altitude ; le disque du soleil reste celui de la photographie.
   */
  clear?: number;
  /** gain du ciel et de la lumière ambiante (défaut 1) ; intensité du soleil (défaut 1) */
  exposure?: number;
  sunIntensity?: number;
  /** ombres de nuages portées sur le décor : 0 = aucune, 1 = celles d'origine */
  cloudShadow?: number;
  /** chaleur du soleil : 1 = doré d'origine, 0 = blanc du fichier */
  warmth?: number;
}

/** Données d'un niveau : tout ce que le moteur lit sans rien construire. */
export interface LevelData {
  id: LevelId;
  terrain: TerrainSpec;
  render: RenderSpec;
  /** soleil au début de la partie : azimut (0 = nord, sens horaire) et hauteur, en degrés */
  sun: { bearing: number; elevation: number };
  /** vent, cotes de l'atmosphère et ciel de la carte (facultatifs : défaut = carte d'origine) */
  wind?: WindSpec;
  atmosphere?: AtmosphereSpec;
  sky?: SkySpec;
  /** teintes du relief et de la végétation (facultatif : défaut = pays vert d'origine) */
  palette?: PaletteSpec;
  /** armes du râtelier (identifiants de src/config/weapons.ts), dans l'ordre ; arme en main au départ */
  weapons: string[];
  startWeapon: string;
  difficulty: Difficulty;
  /** portée du télémètre et de la visée (m) ; distance maximale des tables du carnet de tir (m) */
  rangeLimit: number;
  dopeLimit: number;
  physics: LevelPhysics;
  buildings: BuildingSpot[];
  /**
   * Voies secondaires (rue, route industrielle, chemin de terre, allée) qui relient chaque bâtiment au réseau de la
   * carte. Facultatif : sans ce champ, la carte n'a que sa route principale. Elles sont tracées dans le relief et
   * dans la carte de matières par le générateur (`lib.carveWays`), qui les écrit dans meta.json (`ways`).
   */
  ways?: WaySpec[];
  /** site de tir : altitude du sol, point de départ (yaw en radians, 0 = nord), râtelier */
  site: { baseY: number; start: { x: number; z: number; yaw: number }; rack: { x: number; z: number } };
  posts: Record<string, PostDef>;
  sightlines: Sightline[];
  /** objectifs, dans l'ordre, et poste conseillé par objectif (clé de posts) */
  steps: Step[];
  stepPost: Record<string, string>;
  /** zone d'alerte (campement) : détonations et impacts proches font monter la jauge ; null = pas d'alerte */
  alertZone: { x: number; z: number } | null;
  /** libellé de la jauge d'alerte dans le HUD */
  alertLabel: string;
  /**
   * Phrases de l'alerte, pour une carte dont la zone d'alerte n'est pas un campement. Par défaut, phrases neutres
   * (« L’alerte est donnée », « L’alerte a été donnée. », « Aucune alerte donnée »).
   */
  alertTexts?: {
    /** message quand la jauge est pleine, et sa seconde ligne */
    raised?: string;
    raisedSub?: string;
    /** ligne « Discrétion » du bilan : alerte donnée / jamais donnée (le niveau final est ajouté) */
    endRaised?: string;
    endQuiet?: string;
  };
  /** phrase de l'écran d'échec, sous le motif */
  failNote: string;
  tutorial: TutorialSpec | null;
  testPlan: TestStep[];
  /** e2e/walk.mjs : trajet de retour réaliste de chaque poste vers le départ (points x, z ; le départ est ajouté) */
  testWalk?: Record<string, [number, number][]>;
  /** e2e/mobile.mjs et e2e/tutorial.mjs : positions du scénario tactile */
  testTouch?: TouchScenario;
  /**
   * e2e/perf.mjs : vues nommées de la carte. Sans ce champ, deux vues génériques : `depart` (point de départ, debout)
   * et `lunette` (dernier objectif de `testPlan`).
   */
  testViews?: Record<string, TestView>;
}

/** Ce que le site de tir dit au joueur générique : où l'on peut marcher, sur quoi, par où passer. */
export interface SiteNav {
  /** le point (x, z) est-il dans la zone praticable ? */
  allowed(x: number, z: number): boolean;
  /**
   * Pourquoi le point (x, z), hors de la zone, n'est pas praticable : 'pente' (rebord, talus trop raide), 'cloture'
   * (limite du site, matérialisée), ou null (mur, limite propre au site). Facultatif : sert au message discret
   * affiché quand le joueur insiste contre la limite, et aux tests (e2e/walk.mjs).
   */
  limit?(x: number, z: number): 'pente' | 'cloture' | null;
  /** nature du sol nu en (x, z), hors surfaces de marche des collisions */
  surfaceAt(x: number, z: number): Surface;
  /**
   * Point de passage intermédiaire vers un poste (escalier, brèche…) selon la position du joueur, ou null pour
   * viser le poste directement.
   */
  waypoint?(key: string, pos: Vector3): { x: number; z: number; hint: string } | null;
}

/** Ce que le jeu prête au niveau pour construire sa scène. */
export interface LevelHost {
  engine: Engine;
  terrain: Terrain;
  col: Colliders;
  wind: Wind;
  params: URLSearchParams;
  /** bâtiments posés (data.buildings) : renseigné après le décor, donc lisible dans buildTargets(), pas avant */
  buildings?: LevelBuildings;
}

/** Scène d'un niveau en cours de partie. Construite dans l'ordre : buildSite, buildScenery, buildTargets. */
export interface LevelScene {
  nav: SiteNav;
  /** Site de tir praticable (murs, abri du râtelier…) : ajoute ses collisions, renvoie son groupe et ce que la végétation doit éviter. */
  buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }>;
  /** Décor lointain (villages, eau, fanions…). */
  buildScenery(h: LevelHost): Promise<Object3D>;
  /** Cibles, déjà placées ; le jeu les ajoute à la scène. Les effets (fx) existent à ce stade. */
  buildTargets(h: LevelHost, fx: Fx): Target[];
  /** Fumées et autres émetteurs permanents. */
  addEmitters?(fx: Fx): void;
  /**
   * Repères sonores de l'ambiance. Chaque repère est facultatif : absent ou null, le son correspondant n'existe pas
   * sur la carte (`village` : rumeur de foule ; `bell` : cloche, par défaut celle du village ; `camp` : sirène
   * d'alerte ; `lake` : eau). Appelé après la pose des bâtiments.
   */
  landmarks(): Landmarks;
  /** Caméra du menu : plan n° `shot` (0..3), avancement u (0..1) ; place la caméra, renvoie le champ vertical (degrés). */
  menuCamera(cam: PerspectiveCamera, shot: number, u: number): number;
  /** Sons propres à la carte (véhicule, drone…) ; renvoie l'activité de la foule 0..1 pour la rumeur. */
  audioFrame?(audio: AudioEngine): number;
  /**
   * Règle propre à la carte après un impact (ex. foule qui panique). Renvoie le motif d'échec de la mission, ou null.
   * `stepId` : objectif en cours.
   */
  onImpact?(r: ImpactReport, stepId: string, audio: AudioEngine): string | null;
  /** Remise en état après un échec ; renvoie les cibles remplacées (ajoutées / retirées de la scène par le jeu). */
  retry?(h: LevelHost, fx: Fx): { remove: Target[]; add: Target[] } | null;
  /**
   * Objets visibles du décor proche qui ne sont ni dans les collisions (`h.col`), ni des cibles, ni de la végétation
   * commune (fanion, manche à air…) : sphères englobantes (monde). Le plan proche de la lunette ne les coupe pas.
   * Inutile au-delà de 60 m du site.
   */
  viewObstacles?(): { x: number; y: number; z: number; r: number }[];
  /** Tests automatisés : fige ou prépare une cible avant le tir ; dit si elle est tirable maintenant. */
  testPrepare?(targetId: string): void;
  testReady?(targetId: string, canSee: boolean): boolean;
}

/** Module d'un niveau : `export const level: Level` dans src/levels/<id>/index.ts. */
export interface Level {
  data: LevelData;
  createScene(): LevelScene;
}
