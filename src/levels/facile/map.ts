// Niveau « facile » : le Guet, ferme close au bord d'un coteau bocager, au-dessus d'un bourg abandonné et de sa rivière.
// Données de carte partagées par le générateur de relief (Node) et le jeu.
// Fichier sans import et sans syntaxe TypeScript non effaçable : Node le charge tel quel.
// Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// Le site de tir (la cour du Guet) est à l'origine.

export const TERRAIN_SIZE = 3072; // côté de la carte en mètres
export const TERRAIN_RES = 768; // résolution de la carte de hauteur (mailles de 4 m)
/** Altitude de la cour du Guet. */
export const BASE_Y = 56;
/** Altitude du fond de vallée au pied du coteau. */
export const VALLEY_Y = 16;

export interface P2 {
  x: number;
  z: number;
}

export function polar(bearingDeg: number, dist: number): P2 {
  const b = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(b) * dist, z: -Math.cos(b) * dist };
}

// Soleil : matinée claire, est-sud-est, déjà haut. Les façades tournées vers le tireur sont éclairées de trois quarts.
export const SUN_BEARING = 112;
export const SUN_ELEVATION = 34;

// Rivière (x, z, altitude du lit). Coule d'ouest en est au pied du coteau.
export const RIVER: [number, number, number][] = [
  [-1560, -470, 15.2],
  [-1050, -420, 14.6],
  [-700, -372, 14.0],
  [-450, -338, 13.5],
  [-300, -292, 13.2],
  [-190, -262, 13.0],
  [-100, -254, 12.9],
  [-10, -262, 12.8],
  [90, -282, 12.6],
  [200, -302, 12.4],
  [420, -322, 12.0],
  [800, -300, 11.4],
  [1150, -340, 11.0],
  [1560, -380, 10.6],
];
export const RIVER_WIDTH = 9;

// Route du bourg (x, z) : elle longe la rive nord, passe devant l'hôpital puis au pied de l'église.
export const ROAD: [number, number][] = [
  [-1560, -640],
  [-900, -590],
  [-420, -556],
  [-200, -551],
  [-80, -551],
  [20, -540],
  [70, -470],
  [86, -398],
  [112, -366],
  [150, -361.5],
  [240, -361],
  [330, -372],
  [520, -440],
  [900, -520],
  [1560, -560],
];
export const ROAD_WIDTH = 5;

/**
 * Bâtiments de la banque posés dans le décor (data.buildings). Lacet 0 : la façade sud du modèle regarde +z, vers
 * le coteau. Le relief est terrassé sous chacun par le générateur (lib.flattenBuildings), qui fixe son altitude.
 */
export const BUILDINGS: { id: string; carte?: string; name: string; x: number; z: number; yaw: number; usure: number }[] = [
  { id: 'moulin', name: 'moulin', x: -100, z: -214, yaw: 0, usure: 0.7 },
  { id: 'eglise', name: 'eglise', x: 150, z: -384, yaw: 0, usure: 0.7 },
  { id: 'hopital', carte: 'soins', name: 'hopital', x: -80, z: -614, yaw: 0, usure: 0.7 },
  { id: 'chateau-eau', name: 'chateauEau', x: -430, z: -118, yaw: 0, usure: 0.7 },
  { id: 'chateau', carte: 'interieur', name: 'chateau', x: 470, z: -700, yaw: -0.5, usure: 0.7 },
];
const lot = (name: string): { x: number; z: number; yaw: number } => BUILDINGS.find((b) => b.name === name)!;
export const LOTS = { moulin: lot('moulin'), eglise: lot('eglise'), hopital: lot('hopital'), chateauEau: lot('chateauEau'), chateau: lot('chateau') };

export const SITES = {
  guet: { x: 0, z: 0, h: BASE_Y, r0: 25.5, r1: 38 },
  // distances comptées depuis le pas de tir (14, −18)
  plate1: { x: 57.5, z: -66.5, h: 0, r0: 4, r1: 10 },
  plate2: { x: 305.1, z: -90.8, h: 0, r0: 6, r1: 16 },
  balloon: { x: 24.5, z: -167.8, h: 0, r0: 5, r1: 13 },
  /** fond de l'ancienne sablière, entaillée dans le flanc est du coteau */
  quarry: { x: 112, z: -32, h: 19, r0: 16, r1: 29 },
  /** pré de la cible mobile, rive nord */
  track: { x: 30, z: -322, h: 0, r0: 26, r1: 44 },
};

/** Voie de la cible mobile : deux bouts (x, z) ; le chariot y fait la navette. */
export const TRACK = { ax: 8, az: -322, bx: 52, bz: -322 };

/**
 * Cibles accrochées aux bâtiments, dans le repère local du bâtiment (origine au centre du lot, +x est, +z sud,
 * y = 0 au sol), d'après ses points d'intérêt (h.buildings.get(nom).points()) puis ajustées en lunette.
 */
export const HOOKS = {
  /** appui d'une fenêtre du premier plancher de la minoterie, façade sud (fenêtre de 1,2 × 1,8 m, appui à 4,8 m) */
  mill: { lot: 'moulin', x: -6.5, y: 4.8, z: 3.0 },
  /** timbre de l'horloge : petite cloche en applique sur la face sud du clocher, entre le cadran et le bandeau */
  bell: { lot: 'eglise', x: -12.5, y: 12.7, z: 15.9 },
  /** lisse du garde-corps de la passerelle de la cuve, face au Guet (la silhouette y est suspendue, côté vide) */
  tower: { lot: 'chateauEau', x: 2.81, y: 25.05, z: -8.45 },
  /** dessus de l'acrotère sud du pavillon central, à droite du fronton de l'horloge */
  roof: { lot: 'hopital', x: 4.6, y: 11.03, z: 9.6 },
};

/** Position monde d'un point local d'un lot (lacet autour de Y, comme group.rotation.y). */
export function lotPoint(lot: { x: number; z: number; yaw: number }, lx: number, lz: number): P2 {
  const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
  return { x: lot.x + lx * c + lz * s, z: lot.z - lx * s + lz * c };
}

// ---------------------------------------------------------------------------------------------
// Le Guet : cour close de murets, plate-forme de guet, abri du râtelier. Sol à BASE_Y.
// ---------------------------------------------------------------------------------------------
export interface Opening {
  s: number;
  w: number;
  sill: number;
  top?: number;
}
export interface WallDef {
  a: [number, number];
  b: [number, number];
  t: number;
  h: number;
  rag: number;
  openings?: Opening[];
  minH?: number;
  profile?: [number, number][];
}

/** Cour : x de −17 à 17, z de −14 (parapet nord, côté vallée) à 24 (mur sud, portail). */
export const YARD = { x0: -17, x1: 17, z0: -14, z1: 24 };

export const WALLS: WallDef[] = [
  // parapet nord : muret d'appui à 0,9 m, tout le panorama par-dessus ; il s'arrête avant l'angle nord-est (pas de tir)
  { a: [-17, -14], b: [10.4, -14], t: 0.7, h: 0.9, rag: 0, minH: 0.9 },
  // mur est : haut au sud, il s'abaisse vers le nord ; portillon du talus
  { a: [17, -11.2], b: [17, 24], t: 0.8, h: 2.7, rag: 0.35, minH: 1.5, openings: [{ s: 5.2, w: 2.2, sill: 0 }], profile: [[0, 0.5], [0.2, 0.8], [0.4, 1], [1, 1]] },
  // mur sud et portail charretier
  { a: [17, 24], b: [-17, 24], t: 0.8, h: 3.0, rag: 0.3, minH: 2.1, openings: [{ s: 26.5, w: 3.0, sill: 0, top: 2.6 }] },
  // mur ouest ; portillon de la terrasse
  { a: [-17, 24], b: [-17, -14], t: 0.8, h: 2.7, rag: 0.35, minH: 1.5, openings: [{ s: 30, w: 2.2, sill: 0 }], profile: [[0, 1], [0.6, 1], [0.8, 0.8], [1, 0.45]] },
  // reste de cloison de l'ancienne étable, entre le départ et l'abri
  { a: [-16.6, 11], b: [-8, 11], t: 0.7, h: 2.4, rag: 0.8, minH: 0.4, profile: [[0, 1], [0.6, 0.8], [1, 0.2]] },
];

/** Plate-forme de guet : plancher de bois sur poteaux, escalier droit montant du sud vers le nord. */
export const DECK = { x0: -13.2, x1: -8.4, z0: -12.4, z1: -7.6, floor: 3.0 };
export const STAIR = { x0: -11.45, x1: -10.15, zBottom: -1.6, zTop: -7.6, rise: 3.0 };

/** Points de vie de la cour. */
export const FARM = {
  start: { x: -1, z: 10, yaw: 0 },
  /** au même endroit de la cour que sur la carte standard : les scénarios tactiles communs y marchent */
  rack: { x: 3.5, z: 19.2 },
  well: { x: 3, z: -3.5 },
  /** zones dallées ou battues (x, z, rayon) : pas d'herbe */
  paved: [[3.5, 18, 5.4], [3, -3.5, 2.0], [-10.8, -0.6, 1.8]] as [number, number, number][],
};

/** Postes de tir nommés. `y` : plancher au-dessus du sol de la cour. */
export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  /** le pas de tir, à l'angle nord-est : clé « est », celle que les scénarios tactiles communs (e2e) attendent pour le poste du tutoriel */
  est: { label: 'Pas de tir', x: 14.0, z: -18.2, stance: 'prone' },
  talus: { label: 'Talus est', x: 22.6, z: -6.0, stance: 'prone' },
  muret: { label: 'Parapet nord', x: -2.5, z: -13.2, stance: 'crouch' },
  guet: { label: 'Plate-forme', x: -10.8, z: -11.6, y: 3.0, stance: 'prone' },
  terrasse: { label: 'Terrasse ouest', x: -22.6, z: -6.0, stance: 'prone' },
};

/** Zones praticables hors de la cour : rectangles (x0, x1, z0, z1). */
export const OUTSIDE: [number, number, number, number][] = [
  [10.4, 18.4, -21.0, -11.0], // pas de tir, à l'angle nord-est
  [16.5, 25.0, -8.6, -3.4], // talus est
  [-25.0, -16.5, -8.6, -3.4], // terrasse ouest
];

/**
 * Cônes de vue : devant chaque poste, le sol passe sous un plan incliné pour que le rebord du coteau ne masque pas
 * la vallée. (x, z) origine, y altitude de l'œil, b0→b1 secteur d'azimuts, slope = pente du plan.
 * Aucun cône à la terrasse ouest : le tir vers le château d'eau monte. Chaque secteur évite la croupe des plaques.
 */
export const CLEAR: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number; drop?: number; dropLen?: number; soft?: number }[] = [
  { x: 14.0, z: -18.2, y: BASE_Y + 0.1, b0: 338, b1: 380, slope: 0.3, start: 0.5, soft: 1.4 }, // pas de tir, vers le ballon
  { x: 14.0, z: -18.2, y: BASE_Y + 0.1, b0: 22, b1: 102, slope: 0.1, start: 0.5, soft: 1.4 }, // pas de tir, le long de la croupe (plaques)
  { x: 22.6, z: -6.0, y: BASE_Y + 0.1, b0: 52, b1: 100, slope: 0.46, start: 0.5, soft: 1.4 }, // talus est (hors de la croupe des plaques)
  { x: -3, z: -14.7, y: BASE_Y + 0.55, b0: 314, b1: 394, slope: 0.17, start: 0.3, soft: 1.4 }, // parapet nord
];
export const SCULPT: { x: number; z: number; h: number; r0: number; r1: number }[] = [];

/** Ligne vers une cible accrochée à un bâtiment : y = hauteur au-dessus du y = 0 du bâtiment (`lot` le nomme). */
function hook(post: string, k: keyof typeof HOOKS, dy = 0.4): { post: string; x: number; z: number; y: number; lot: string } {
  const h = HOOKS[k], l = LOTS[h.lot as keyof typeof LOTS];
  return { post, ...lotPoint(l, h.x, h.z), y: h.y + dy, lot: h.lot };
}

/**
 * Couloirs de visée garantis : le générateur de relief rabote ce qui dépasserait la ligne poste → cible, et la
 * végétation n'y plante rien. y = hauteur de la cible au-dessus du sol en place (du sol du bâtiment si `lot`).
 */
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean; lot?: string }[] = [
  { post: 'est', x: SITES.plate1.x, z: SITES.plate1.z, y: 0.9 },
  { post: 'est', x: SITES.plate2.x, z: SITES.plate2.z, y: 0.9 },
  { post: 'est', x: SITES.balloon.x, z: SITES.balloon.z, y: 2.4 },
  { post: 'talus', x: SITES.quarry.x - 4, z: SITES.quarry.z + 2, y: 0.45 },
  hook('muret', 'mill'),
  hook('guet', 'mill'),
  { post: 'muret', x: TRACK.ax, z: TRACK.az, y: 0.9 },
  { post: 'muret', x: TRACK.bx, z: TRACK.bz, y: 0.9 },
  { post: 'guet', x: TRACK.ax, z: TRACK.az, y: 0.9 },
  { post: 'guet', x: TRACK.bx, z: TRACK.bz, y: 0.9 },
  hook('guet', 'bell', -0.5),
  hook('muret', 'bell', -0.5),
  hook('terrasse', 'tower', -0.5),
  hook('guet', 'tower', -0.5),
  hook('guet', 'roof'),
  hook('muret', 'roof'),
  // la vue elle-même : le parvis de l'église et le pied de l'hôpital restent visibles de la cour
  { post: 'muret', x: LOTS.eglise.x - 12, z: LOTS.eglise.z + 20, y: 2, lot: 'eglise' },
  { post: 'muret', x: LOTS.hopital.x, z: LOTS.hopital.z + 14, y: 2, lot: 'hopital' },
];

// ---------------------------------------------------------------------------------------------
// Végétation et rochers posés à la main autour de la cour.
// ---------------------------------------------------------------------------------------------
/** Secteurs de tir à garder dégagés près du site : [azimut, demi-largeur]. */
export const CORRIDORS: [number, number][] = [[0, 50], [48, 16], [80, 26], [290, 28], [330, 30]];
/** Arbres détaillés autour de la cour (sp : 0 conifère, 1 conifère clair) : un bouquet de pins derrière la ferme. */
export const NEAR_TREES: { x: number; z: number; s: number; sp: number }[] = [
  { x: -35, z: 22, s: 1.06, sp: 2 }, { x: -33, z: 42, s: 1.05, sp: 1 }, { x: -20, z: 47, s: 1.15, sp: 2 }, { x: -6, z: 54, s: 0.98, sp: 2 },
  { x: 9, z: 50, s: 1.10, sp: 2 }, { x: 23, z: 45, s: 0.94, sp: 2 }, { x: 33, z: 34, s: 1.25, sp: 0 }, { x: 39, z: 49, s: 0.81, sp: 2 },
  { x: -41, z: 14, s: 0.85, sp: 2 }, { x: -46, z: 39, s: 1.10, sp: 2 }, { x: 44, z: 12, s: 0.89, sp: 2 }, { x: 2, z: 67, s: 1.4, sp: 0 },
  { x: -12.5, z: 16.5, s: 0.8, sp: 1 }, // le pin de la cour, derrière la cloison
];
/** Passages gardés libres de rochers (x, z, rayon). */
export const LANES: [number, number, number][] = [
  [POSTS.est.x, POSTS.est.z, 3.2], [13.7, -12.5, 2.6], [POSTS.talus.x, POSTS.talus.z, 3.0], [17, -6, 2.4], [POSTS.terrasse.x, POSTS.terrasse.z, 3.0], [-17, -6, 2.4],
  [POSTS.muret.x, POSTS.muret.z, 2.4], [-10.8, -0.4, 2.6], [FARM.start.x, FARM.start.z, 2.6], [FARM.rack.x, FARM.rack.z - 2.5, 3.2], [-9.5, 24, 2.4], [12, 6, 2.6],
  // le premier plan des vues de tir reste net : ni bloc ni pierre devant le parapet et les talus
  [3, -7, 7], [0, 3, 7], [0, -31, 15], [-22, -27, 13], [22, -29, 13], [-36, -12, 12], [36, -12, 12], [38, -32, 9], [-38, -30, 9], [8, -44, 5], [-8, -44, 5],
];
/** Couloirs libres (ax, az, bx, bz, rayon) : le long du parapet, du départ aux deux portillons et à l'escalier. */
export const LANE_SEGS: [number, number, number, number, number][] = [
  [-15, -12.6, 13.5, -12.6, 1.5], [-1, 10, 15, -6, 1.5], [-1, 10, -14.2, -0.2, 1.5], [-14.2, -0.2, -15, -6, 1.5], [-1, 10, -10.8, 0, 1.5], [-1, 10, 13.7, -12.5, 1.5], [12, 6, 13.7, -12.5, 1.5], [12, 6, 3.5, 17.7, 1.5],
];
/** Gros blocs en bord de plateau : [azimut, distance, échelle]. */
export const BOULDERS: [number, number, number][] = [[142, 41, 1.1], [222, 43, 1.3], [248, 35, 0.9], [118, 31, 0.8]];
/** Bois mort : [x, z, rotation, échelle]. */
export const DEADWOOD: [number, number, number, number][] = [[-13, 20.5, 0.3, 2.0], [24, 14, 1.9, 2.4], [-25, 9, 0.8, 2.2]];

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
/** Carte courte : ombres et arbres jusqu'au bord de la cuvette, brume légère de matinée. */
export const RENDER = { cameraFar: 14000, shadowFar: 1300, haze: 0.8, treeRange: 1500 };
/** Armes du râtelier, de la plus douce à la plus tendue. */
export const WEAPON_IDS = ['22lr', '223', '6cm', '65cm', '308'];
/** Physique du tir : rien d'activé, air standard. */
export const PHYSICS = { latitudeDeg: 47, altitudeM: 0, temperatureC: 15, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
/** Vent de la carte : faible et régulier, de l'ouest ; il forcit un peu pour les deux derniers objectifs. */
export const WIND = { fromBearing: 265, speed: 1.2, steps: { tower: { speed: 2.6 }, roof: { speed: 2.6 } } };
/** Ciel : matinée claire — la bande de nuages de la photographie est presque effacée, soleil moins doré. */
export const SKY = { clear: 0.85, warmth: 0.55, cloudShadow: 0.3 };
/** Coteau bocager : peu de pierres (30 au lieu de 300, dans un rayon de 110 m), feuillus dominants. */
export const ROCKS = { count: 30, near: 5, radius: 110 };
export const TREES = { nearMix: [0.1, 0.1, 0.8] as [number, number, number], broadleaf: 0.85 };
export const RANGE_LIMIT = 1500;
export const DOPE_LIMIT = 800;

/** Plan du tireur automatique (e2e/mission.mjs). */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'plates', post: 'est', weapon: '223', targets: ['plate1', 'plate2'], zoom: 10 },
  { step: 'quarry', post: 'talus', weapon: '223', targets: ['drum'], zoom: 10 },
  { step: 'balloon', post: 'est', weapon: '223', targets: ['balloon'], zoom: 12 },
  { step: 'mill', post: 'muret', weapon: '223', targets: ['mill'], zoom: 14 },
  { step: 'runner', post: 'muret', weapon: '6cm', targets: ['runner'], zoom: 14 },
  { step: 'bell', post: 'guet', weapon: '65cm', targets: ['bell'], zoom: 16 },
  { step: 'tower', post: 'terrasse', weapon: '65cm', targets: ['tower'], zoom: 18 },
  { step: 'roof', post: 'guet', weapon: '308', targets: ['roof'], zoom: 20 },
];
/** Trajets de retour réalistes, du poste au point de départ (e2e/walk.mjs). */
export const TEST_WALK: Record<string, [number, number][]> = {
  est: [[13.7, -12.4], [8, -2]],
  talus: [[17, -6], [10, 0]],
  muret: [[-1, -8], [0, 2]],
  guet: [[-10.8, -8.4], [-10.8, -0.6], [-5, 4]],
  terrasse: [[-17, -6], [-14.2, -0.2], [-6, 4]],
};
/** Positions du scénario tactile (e2e/mobile.mjs, e2e/tutorial.mjs). */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
} = {
  post: [POSTS.est.x, POSTS.est.z, 0.73],
  rack: [FARM.rack.x, FARM.rack.z - 1.6, Math.PI],
  yard: [3, 6, -0.4],
  // la silhouette du château d'eau : derrière elle, la cuve claire puis le ciel (la mesure optique de e2e/mobile.mjs veut un fond uni)
  far: { at: [POSTS.terrasse.x, POSTS.terrasse.z, 0, 'prone', 0], target: 'tower' },
  crowd: { weapon: '65cm', at: [POSTS.guet.x, POSTS.guet.z, 0, 'prone', 3.0], target: 'bell' },
};

/** Vues de mesure de e2e/perf.mjs : départ, vallée à l'œil nu depuis le guet, lunette sur le timbre de l'horloge et sur le château d'eau. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  depart: { at: [FARM.start.x, FARM.start.z, FARM.start.yaw, 'stand'] },
  vallee: { at: [POSTS.guet.x, POSTS.guet.z, -0.35, 'stand', 3.0], pitch: -0.12 },
  lunette: { at: [POSTS.guet.x, POSTS.guet.z, 0, 'prone', 3.0], scope: { weapon: '65cm', zoom: 18, target: 'bell' } },
  'lunette-loin': { at: [POSTS.terrasse.x, POSTS.terrasse.z, 0, 'prone', 0], scope: { weapon: '65cm', zoom: 18, target: 'tower' } },
};
