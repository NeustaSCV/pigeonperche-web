// Niveau « Le Château d'eau » (identifiant `plaine`) : une grande plaine industrielle, de jour. Le tireur est sur la
// plate-forme posée au sommet du château d'eau, sur la seule butte du pays : vue à 360°, tirs de 900 à 2 400 m.
// Sabotage en chaîne, dans l'ordre : relais radio de la médiathèque, vannes de l'usine chimique, signal de la voie
// ferrée, citerne du convoi arrêté entre deux entrepôts, drone au-dessus de la villa, lunette de surveillance du
// théâtre, horloge de la gare.
// Données partagées par le générateur de relief (Node) et le jeu : fichier sans import et sans syntaxe TypeScript
// non effaçable. Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// Le centre de la cuve (donc de la plate-forme) est à l'origine.

export const TERRAIN_SIZE = 10240; // côté de la carte en mètres
export const TERRAIN_RES = 1024; // maille de 10 m : 4 Mo par fichier (2 048 points en coûteraient 16 : trop pour un téléphone)
/** Altitude moyenne de la plaine, et du sol au pied du château d'eau (la butte). Le repère du jeu est l'altitude réelle. */
export const PLAIN = 180;
export const KNOLL = 196;
/** Hauteur du plancher de la plate-forme au-dessus du sol du château d'eau : juste au-dessus du faîte de la cuve (29,65 m). */
export const DECK_H = 29.8;
/** Altitude de la plate-forme : c'est « le sol du site » pour tout le socle. */
export const DECK_Y = KNOLL + DECK_H;

export interface P2 {
  x: number;
  z: number;
}

export function polar(bearingDeg: number, dist: number): P2 {
  const b = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(b) * dist, z: -Math.cos(b) * dist };
}

export function bearingOf(x: number, z: number): number {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}

// Soleil : début d'après-midi, haut dans le sud-sud-ouest. Assez haut pour qu'aucune cible ne soit à contre-jour
// dans un tour d'horizon complet ; la lunette du théâtre, au nord-nord-ouest, le renvoie vers le tireur.
export const SUN_BEARING = 200;
export const SUN_ELEVATION = 40;

// ---------------------------------------------------------------------------------------------
// La plate-forme : un plancher annulaire autour du lanterneau de la cuve, ceint d'un garde-corps.
// ---------------------------------------------------------------------------------------------
export const DECK = {
  /** rayon du plancher, du garde-corps (collision), et du lanterneau au centre (collision) */
  r: 8.0, rail: 7.82, core: 1.85,
  /** rayon des postes de tir */
  post: 6.95,
};
/** Le château d'eau de la banque : sa tour est en (−6, −11) dans le repère du lot ; on la pose sur l'origine. */
export const TOWER_LOCAL = { x: -6, z: -11 };

const rim = (bearing: number): P2 => polar(bearing, DECK.post);
export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  nord: { label: 'Poste nord', ...rim(345), stance: 'prone' },
  est: { label: 'Poste est', ...rim(88), stance: 'prone' },
  sud: { label: 'Poste sud', ...rim(150), stance: 'prone' },
  ouest: { label: 'Poste ouest', ...rim(272), stance: 'prone' },
};

/** Œil d'un tireur couché à un poste. */
export function eyeOf(post: string): { x: number; y: number; z: number } {
  const P = POSTS[post];
  return { x: P.x, y: DECK_Y + (P.y ?? 0) + (P.stance === 'crouch' ? 1.0 : 0.2), z: P.z };
}

/** Point situé à `slant` mètres (distance réelle) du poste, dans l'azimut `bearing`, à l'altitude `alt` : position (x, z). */
export function spot(post: string, bearing: number, slant: number, alt: number): P2 {
  const e = eyeOf(post);
  const dy = alt - e.y;
  const p = polar(bearing, Math.sqrt(slant * slant - dy * dy));
  return { x: e.x + p.x, z: e.z + p.z };
}

// ---------------------------------------------------------------------------------------------
// Objectifs. Les distances annoncées au briefing sont les distances réelles depuis le poste conseillé.
// `y` : hauteur du point visé au-dessus du sol de la plaine (ou du plancher qui le porte, voir DECKS).
// ---------------------------------------------------------------------------------------------
export interface TargetDef {
  id: string;
  label: string;
  post: string;
  bearing: number;
  slant: number;
  /** altitude du point visé */
  alt: number;
}

/**
 * Planchers et points d'accroche des bâtiments de la banque (repère local du lot : +x est, +z sud à lacet nul,
 * y = 0 au sol), relevés par lancer de rayons sur les modèles posés.
 */
export const DECKS = {
  /** médiathèque : toit-terrasse de l'aile sud-est (6,80 m), près de l'acrotère, où est planté le mât du relais */
  mediatheque: { x: 16, y: 6.8, z: 10 },
  /** théâtre : faîtage de la cage de scène, le point le plus haut du bâtiment (hors du lot de 36 × 30 m, que le modèle dépasse au nord) */
  theatre: { x: 0, y: 24.5, z: -36.5 },
  /** gare : centre du cadran de l'attique, au nu de la façade */
  gare: { x: 0, y: 15.95, z: 1.04 },
  /** villa : aplomb du drone, au-dessus du toit-terrasse (à 6,85 m) */
  villa: { x: 10, y: 6.85, z: -5 },
};

/** Dimensions des cibles (m) : celles du briefing, à lire au réticule. */
export const SIZES = {
  /** boîtier de l'émetteur du relais (cible commune du jeu) */
  relay: { w: 0.5, h: 0.62, mast: 4.2, board: 1.1 },
  /** volant d'une vanne : diamètre ; entraxe des trois vannes */
  valve: { d: 0.6, gap: 2.4, y: 4.2 },
  /** cible du signal : largeur, hauteur ; hauteur de son centre au-dessus du sol */
  signal: { w: 0.9, h: 1.5, y: 7.0 },
  /** plaque de danger du wagon-citerne : côté du carré ; hauteur de son centre au-dessus du rail */
  plate: { s: 1.0, y: 2.25 },
  /** drone : envergure, hauteur du corps ; hauteur de vol au-dessus du sol */
  drone: { w: 2.2, h: 0.7, y: 24 },
  /** lunette de surveillance : diamètre du caisson ; hauteur au-dessus du faîtage */
  glint: { d: 0.7, y: 1.75 },
  /** cadran de l'horloge : diamètre */
  clock: { d: 2.7 },
};

export const TARGETS: Record<string, TargetDef> = {
  relay: { id: 'relay', label: 'Émetteur du relais radio', post: 'ouest', bearing: 314, slant: 900, alt: PLAIN + DECKS.mediatheque.y + SIZES.relay.mast },
  vannes: { id: 'vannes', label: 'Vannes du collecteur', post: 'ouest', bearing: 235, slant: 1100, alt: PLAIN + SIZES.valve.y },
  signal: { id: 'signal', label: 'Signal de la voie', post: 'est', bearing: 75, slant: 1300, alt: PLAIN + SIZES.signal.y },
  wagon: { id: 'wagon', label: 'Plaque du wagon-citerne', post: 'est', bearing: 100, slant: 1500, alt: PLAIN + SIZES.plate.y + 0.35 },
  drone: { id: 'drone', label: 'Drone d’escorte', post: 'sud', bearing: 150, slant: 1700, alt: PLAIN + SIZES.drone.y },
  lunette: { id: 'lunette', label: 'Lunette de surveillance', post: 'nord', bearing: 330, slant: 1250, alt: PLAIN + DECKS.theatre.y + SIZES.glint.y },
  horloge: { id: 'horloge', label: 'Horloge de la gare', post: 'nord', bearing: 0, slant: 2400, alt: PLAIN + DECKS.gare.y },
};

/** Position au sol (x, z) du point visé d'un objectif. */
export function targetXZ(id: string): P2 {
  const t = TARGETS[id];
  return spot(t.post, t.bearing, t.slant, t.alt);
}

// ---------------------------------------------------------------------------------------------
// Bâtiments de la banque. Lacet (rad) = group.rotation.y : à 0 la façade sud regarde +z.
// Ceux qui portent un objectif sont placés d'après lui : leur point d'accroche (DECKS) tombe sous le point visé, et
// leur façade principale regarde le château d'eau (le théâtre est aveugle sur ses trois autres faces).
// ---------------------------------------------------------------------------------------------
function under(id: string, deck: { x: number; z: number }, yaw: number): P2 {
  const t = targetXZ(id);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: t.x - (deck.x * c + deck.z * s), z: t.z - (-deck.x * s + deck.z * c) };
}
const faceYaw = (bearing: number): number => (-bearing * Math.PI) / 180;

const MEDIATHEQUE = under('relay', DECKS.mediatheque, faceYaw(314));
const THEATRE = under('lunette', DECKS.theatre, faceYaw(330));
const GARE = under('horloge', DECKS.gare, faceYaw(0));
const VILLA = under('drone', DECKS.villa, faceYaw(150));
/** L'usine est en retrait de son collecteur de vannes, qui en garde l'entrée côté château d'eau. */
const USINE = polar(235, 1160);

export const BUILDINGS: { id: string; carte?: string; name: string; x: number; z: number; yaw: number; groundY: number; usure?: number; lod?: 'auto' | 'full' | 'far' }[] = [
  { id: 'chateau-eau', name: 'tour', x: -TOWER_LOCAL.x, z: -TOWER_LOCAL.z, yaw: 0, groundY: KNOLL, usure: 0.3 },
  { id: 'mediatheque', carte: 'rotonde', name: 'mediatheque', x: MEDIATHEQUE.x, z: MEDIATHEQUE.z, yaw: faceYaw(314), groundY: PLAIN, usure: 0.4 },
  { id: 'usine-chimique', carte: 'installations', name: 'usine', x: USINE.x, z: USINE.z, yaw: faceYaw(235), groundY: PLAIN, usure: 0.4 },
  { id: 'villa-milliardaire', name: 'villa', x: VILLA.x, z: VILLA.z, yaw: faceYaw(150), groundY: PLAIN, usure: 0.3 },
  { id: 'theatre', carte: 'facade', name: 'theatre', x: THEATRE.x, z: THEATRE.z, yaw: faceYaw(330), groundY: PLAIN, usure: 0.4 },
  { id: 'gare', carte: 'voyageurs', name: 'gare', x: GARE.x, z: GARE.z, yaw: faceYaw(0), groundY: PLAIN, usure: 0.4 },
];
const B = (name: string): { x: number; z: number; yaw: number } => BUILDINGS.find((b) => b.name === name)!;
/** Point du repère local d'un bâtiment → monde (x, z). */
export function localXZ(name: string, lx: number, lz: number): P2 {
  const b = B(name), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

// ---------------------------------------------------------------------------------------------
// Voie ferrée. Elle traverse la plaine d'ouest en est par la gare (elle prolonge la voie 2 du modèle, à 29 m au
// nord du centre de son lot), puis descend vers le sud en passant à l'est du château d'eau : le signal est à
// 1 300 m, la trouée entre les deux entrepôts à 1 500 m, là où la voie file plein sud, en travers de la ligne de visée.
// ---------------------------------------------------------------------------------------------
/** La voie est à 4,5 m derrière la cible du signal et à 1,55 m derrière la plaque du wagon (flanc ouest de la citerne). */
const SIG = targetXZ('signal');
const GAPT = targetXZ('wagon');
export const SIGNAL = { x: SIG.x, z: SIG.z, trackX: SIG.x + 4.4, trackZ: SIG.z + 1.2 };
export const GAP = { x: GAPT.x + 1.55, z: GAPT.z, width: 22 };
const RAIL_Z = GARE.z - 29;
export const RAIL: [number, number][] = [
  [-5110, RAIL_Z], [-3600, RAIL_Z], [-2000, RAIL_Z], [-600, RAIL_Z], [-120, RAIL_Z], [GARE.x, RAIL_Z], [160, RAIL_Z], [500, RAIL_Z], [820, RAIL_Z + 30],
  [1130, RAIL_Z + 190], [1380, RAIL_Z + 520], [1500, -1420], [1470, -980], [1370, -600], [SIGNAL.trackX + 14, -420], [SIGNAL.trackX, SIGNAL.trackZ],
  [SIGNAL.trackX + 12, -250], [1340, -150], [1415, -80], [GAP.x - 12, -15], [GAP.x, 55], [GAP.x, 140], [GAP.x, GAP.z], [GAP.x, 380], [GAP.x, 520], [GAP.x + 25, 700],
  [GAP.x + 70, 900], [1640, 1400], [1600, 2400], [1450, 3800], [1300, 5110],
];
/** La voie du modèle de la gare couvre x = −70 à +110 autour du centre du lot : nos rails s'y interrompent. */
export const RAIL_STATION = { x0: GARE.x - 72, x1: GARE.x + 112, z: RAIL_Z };
/** Entrepôts qui encadrent la trouée, entre la voie et le tireur : [z du centre, longueur]. Largeur 14 m, hauteur 9,5 m. */
export const SHEDS = { x: GAP.x - 13.5, w: 14, h: 9.5, list: [[GAP.z - GAP.width / 2 - 75, 150], [GAP.z + GAP.width / 2 + 62, 124]] as [number, number][] };
/**
 * Le convoi : manœuvres lentes sur le faisceau tant que le signal est ouvert (abscisse de la tête, comptée le long de
 * la voie depuis la trouée, vers le nord) ; signal fermé, il se range et s'immobilise, la citerne dans la trouée.
 */
export const TRAIN = { speed: 3.2, accel: 0.35, pause: 9, shuttle: [-150, 190] as [number, number] };

// ---------------------------------------------------------------------------------------------
// Route de la plaine (d'ouest en est, au sud du château d'eau) et voies secondaires : chaque bâtiment y est relié.
// ---------------------------------------------------------------------------------------------
export const ROAD: [number, number][] = [
  [-5110, 1180], [-3600, 1080], [-2300, 960], [-1500, 880], [-1000, 842], [-300, 781], [10, 758], [450, 790], [800, 813], [1200, 815], [GAP.x + 62, 850], [2100, 800], [3200, 760], [4200, 800], [5110, 760],
];
export const ROAD_WIDTH = 7;

const MED_DOOR = localXZ('mediatheque', 0, 26);
const THE_DOOR = localXZ('theatre', 0, 18);
const GARE_DOOR = localXZ('gare', 0, 21);
const VILLA_DOOR = localXZ('villa', 0, 26.5);
const USINE_DOOR = localXZ('usine', 0, -39);
export const WAYS: {
  name: string; kind: 'route' | 'chemin' | 'allee'; width: number; pts: [number, number][]; to?: string; maxSlope?: number;
  bridges?: { x: number; z: number; deck: number; length: number; kind?: 'pierre' | 'bois' | 'beton'; width?: number }[];
}[] = [
  // la voie ferrée d'abord : plate-forme nivelée et ballast (gravier) ; les rails sont posés par le décor
  { name: 'voie ferrée', kind: 'allee', width: 4.6, maxSlope: 0.012, pts: RAIL },
  { name: 'chemin du château d’eau', kind: 'chemin', width: 3.5, to: 'tour', pts: [[10, 758], [26, 520], [14, 260], [4, 120], [3, 60], [3, 36.5]] },
  { name: 'route de l’usine', kind: 'route', width: 7, to: 'usine', pts: [[-1000, 842], [-992, 780], [USINE_DOOR.x - 6, USINE_DOOR.z + 30], [USINE_DOOR.x, USINE_DOOR.z]] },
  { name: 'allée de la villa', kind: 'allee', width: 4, to: 'villa', pts: [[800, 813], [812, 1050], [828, 1300], [VILLA_DOOR.x - 4, VILLA_DOOR.z - 40], [VILLA_DOOR.x, VILLA_DOOR.z]] },
  { name: 'route du bourg', kind: 'route', width: 6.5, to: 'mediatheque', pts: [[-300, 781], [-400, 520], [-520, 120], [-590, -230], [MED_DOOR.x + 6, MED_DOOR.z + 40], [MED_DOOR.x, MED_DOOR.z]] },
  { name: 'rue du Théâtre', kind: 'route', width: 6, to: 'theatre', pts: [[MED_DOOR.x + 6, MED_DOOR.z + 40], [-560, -650], [-545, -830], [THE_DOOR.x + 14, THE_DOOR.z + 60], [THE_DOOR.x, THE_DOOR.z]] },
  { name: 'avenue de la Gare', kind: 'route', width: 7, to: 'gare', pts: [[THE_DOOR.x + 14, THE_DOOR.z + 60], [-520, -1200], [-420, -1600], [-240, -2020], [-70, -2280], [GARE_DOOR.x, GARE_DOOR.z + 30], [GARE_DOOR.x, GARE_DOOR.z]] },
];

// ---------------------------------------------------------------------------------------------
// Sites aplanis du relief : { x, z, h, r0 (plat), r1 (raccord) }.
// ---------------------------------------------------------------------------------------------
const VAN = targetXZ('vannes');
export const SITES: Record<string, { x: number; z: number; h: number; r0: number; r1: number }> = {
  tour: { x: 0, z: 0, h: KNOLL, r0: 34, r1: 80 },
  gare: { x: GARE.x + 20, z: GARE.z - 14, h: PLAIN, r0: 150, r1: 260 },
  vannes: { x: VAN.x, z: VAN.z, h: PLAIN, r0: 22, r1: 60 },
  signal: { x: SIGNAL.x, z: SIGNAL.z, h: PLAIN, r0: 30, r1: 90 },
  triage: { x: GAP.x - 8, z: GAP.z, h: PLAIN, r0: 190, r1: 300 },
};

/**
 * Couloirs de visée garantis : le générateur rabote le relief sous chaque ligne poste → cible, et la végétation n'y
 * plante aucun arbre. `y` : hauteur du point visé au-dessus du sol en place.
 */
const line = (id: string, drop = 0.5): { post: string; x: number; z: number; y: number } => {
  const t = TARGETS[id];
  return { post: t.post, ...targetXZ(id), y: t.alt - PLAIN - drop };
};
const VSIDE = polar(TARGETS.vannes.bearing + 90, SIZES.valve.gap);
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean }[] = [
  line('relay'), line('vannes', 1.2),
  { post: 'ouest', x: VAN.x + VSIDE.x, z: VAN.z + VSIDE.z, y: SIZES.valve.y - 1.2 },
  { post: 'ouest', x: VAN.x - VSIDE.x, z: VAN.z - VSIDE.z, y: SIZES.valve.y - 1.2 },
  line('signal', 2.5), line('wagon', 1.0),
  { post: 'est', x: GAPT.x, z: GAPT.z - 9, y: 1.6 }, { post: 'est', x: GAPT.x, z: GAPT.z + 9, y: 1.6 },
  line('drone', 3), line('lunette', 2), line('horloge', 3),
];

export const CLEAR: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number }[] = [];
export const SCULPT: { x: number; z: number; h: number; r0: number; r1: number }[] = [];

// ---------------------------------------------------------------------------------------------
// Le site : la plate-forme. Départ au nord-est du lanterneau, râtelier sous son abri au sud-ouest.
// ---------------------------------------------------------------------------------------------
export const SITE = {
  start: { x: 3.6, z: -2.2, yaw: 0 },
  rack: { x: -2.6, z: 4.25 },
};

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
/** Portée de rendu. Brume réduite : l'horloge de la gare, à 2 400 m, doit rester lisible à la lunette. */
export const RENDER = { cameraFar: 16000, shadowFar: 2600, haze: 0.55, treeRange: 2700 };
/** Atmosphère rapportée à la plaine : pas de nappe de brume (plein jour, air sec), un voile léger au ras du sol. */
export const ATMOSPHERE = { valleyY: PLAIN, mistBase: 1, mistTop: 30, mist: 0.25 };
export const SKY = { clear: 0.7, warmth: 0.35, cloudShadow: 0.5 };
/** Plaine de grande culture à la fin de l'été : chaumes blonds, herbe rase, terre claire. */
export const PALETTE = {
  grass: [1.3, 1.26, 0.8] as [number, number, number],
  forest: [1.25, 1.2, 0.85] as [number, number, number],
  dirt: [0.92, 0.78, 0.62] as [number, number, number],
  scree: [1.25, 1.22, 1.15] as [number, number, number],
  dryness: 0.1,
  mossAmount: 0,
  blades: { tint: [1.5, 1.25, 0.65] as [number, number, number], density: 0.4, height: 0.6, flowers: 0.4, chunk: 12 },
  foliage: [1.0, 1.0, 0.82] as [number, number, number],
};
/** Armes du râtelier, dans l'ordre : intermédiaires, .338 LM, puis les calibres de très longue distance. */
export const WEAPON_IDS = ['65prc', '7prc', '300prc', '300wm', '338lm', '338lm300', '33xc', '375ct', '408ct', '416b', '50bmg'];
export const START_WEAPON = '300prc';
/** Physique complète : plaine à 48° de latitude nord, plate-forme à 226 m d'altitude, 21 °C. L'air est dense : les balles peinent plus qu'en altitude. */
export const PHYSICS = { latitudeDeg: 48, altitudeM: Math.round(DECK_Y), temperatureC: 21, coriolis: true, spinDrift: true, aeroJump: true, densityFromAltitude: true };
/**
 * Vent : de nord-nord-ouest (330°), 3,2 m/s en moyenne, rafales modérées. La plaine est plate et nue : presque tout
 * le vent de la plate-forme y souffle encore au ras du sol.
 */
export const WIND = { fromBearing: 330, speed: 3.2, gusts: 0.5, shelter: 0.85, shelterHeight: 60 };
/** Portée du télémètre et de la visée (m) ; distance maximale des tables du carnet de tir (m). */
export const RANGE_LIMIT = 3000;
export const DOPE_LIMIT = 2600;

/**
 * L'alerte. Chaque tir qui ne neutralise rien la fait monter de `miss` points ; la détonation seule, lointaine, de
 * `shot` points ; elle retombe de `decay` points par seconde. Pleine (100), l'objectif en cours est manqué : on le
 * reprend avec une alerte ramenée à `retry`. Tant qu'elle n'est pas pleine, elle est plafonnée à `cap` (trois tirs
 * manqués de suite) : c'est le quatrième qui la donne. Lunette du théâtre : un seul tir, dans le délai `glint` (s).
 */
export const ALERT = { miss: 28, shot: 2, cap: 84, decay: 0.2, retry: 28, glint: 150 };
/** Points de bonus (plafond : BONUS_MAX, celui des règles de score) : objectif réussi sans tir manqué ; mission sans aucun tir manqué. */
export const BONUS = { clean: 300, flawless: 900 };
export const BONUS_MAX = 3000;

/** Plan du tireur automatique (e2e/mission.mjs) : un poste, une arme et un grossissement par objectif. */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'relais', post: 'ouest', weapon: '300prc', targets: ['relay'], zoom: 20 },
  { step: 'vannes', post: 'ouest', weapon: '300prc', targets: ['vanne1', 'vanne2', 'vanne3'], zoom: 25 },
  { step: 'signal', post: 'est', weapon: '338lm300', targets: ['signal'], zoom: 25 },
  { step: 'wagon', post: 'est', weapon: '338lm300', targets: ['wagon'], zoom: 25 },
  { step: 'drone', post: 'sud', weapon: '33xc', targets: ['drone'], zoom: 25 },
  { step: 'lunette', post: 'nord', weapon: '338lm300', targets: ['lunette'], zoom: 25 },
  { step: 'horloge', post: 'nord', weapon: '375ct', targets: ['horloge'], zoom: 25 },
];
/** Trajets de retour, du poste au point de départ, en contournant le lanterneau (e2e/walk.mjs). */
export const TEST_WALK: Record<string, [number, number][]> = {
  nord: [[1.5, -4.6]],
  est: [[5, -1.5]],
  sud: [[5.2, 2.5], [4.6, -0.5]],
  ouest: [[-4.6, -2.8], [0, -4.4]],
};

/** Positions du scénario tactile (e2e/mobile.mjs). Pas de tutoriel : `post` est le garde-corps ouest, face au relais. */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  weapon: string; postKey: string; near: string;
} = {
  post: [POSTS.ouest.x, POSTS.ouest.z, (314 * Math.PI) / 180 - 2 * Math.PI],
  rack: [SITE.rack.x, SITE.rack.z - 1.8, Math.PI],
  yard: [SITE.start.x, SITE.start.z, -2.2],
  far: { at: [POSTS.ouest.x, POSTS.ouest.z, 0, 'prone', 0], target: 'relay' },
  crowd: { weapon: '375ct', at: [POSTS.nord.x, POSTS.nord.z, 0, 'prone', 0], target: 'horloge' },
  weapon: '338lm', postKey: 'ouest', near: 'relay',
};
/** Vues de mesure de e2e/perf.mjs : départ, tour d'horizon à l'œil nu, lunette ×25 sur le bourg, le triage et la gare. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  depart: { at: [SITE.start.x, SITE.start.z, 0, 'stand'] },
  bourg: { at: [POSTS.nord.x, POSTS.nord.z + 1, -0.5, 'stand'], pitch: -0.06 },
  triage: { at: [POSTS.est.x - 1, POSTS.est.z, 1.6, 'stand'], pitch: -0.05 },
  sud: { at: [POSTS.sud.x - 0.5, POSTS.sud.z - 0.9, 3.4, 'stand'], pitch: -0.12 },
  'lunette-vannes': { at: [POSTS.ouest.x, POSTS.ouest.z, 0, 'prone', 0], scope: { weapon: '300prc', zoom: 25, target: 'vanne2' } },
  'lunette-wagon': { at: [POSTS.est.x, POSTS.est.z, 0, 'prone', 0], scope: { weapon: '338lm300', zoom: 25, target: 'wagon' } },
  'lunette-horloge': { at: [POSTS.nord.x, POSTS.nord.z, 0, 'prone', 0], scope: { weapon: '375ct', zoom: 25, target: 'horloge' } },
};

/**
 * Écho du tir : plaine ouverte, le tireur à trente mètres au-dessus. Rien ne renvoie le son, sinon les façades des
 * grands bâtiments tournées vers le château d'eau et la ligne d'entrepôts : retours faibles, queue très courte.
 */
export const ECHO = {
  reliefs: [
    { distance: 900, bearing: 314, size: 0.22 },
    { distance: 1160, bearing: 235, size: 0.2 },
    { distance: 1250, bearing: 330, size: 0.25 },
    { distance: 1480, bearing: 98, size: 0.3 },
  ],
  tail: 0.4,
};
