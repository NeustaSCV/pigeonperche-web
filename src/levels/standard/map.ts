// Niveau « standard » : la haute ruine. Données de carte partagées par le générateur de relief (Node) et le jeu.
// Fichier sans import et sans syntaxe TypeScript non effaçable : Node le charge tel quel.
// Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// Le site de tir (la ruine) est à l'origine : le maillage du terrain, l'herbe et les ombres sont centrés dessus.

export const TERRAIN_SIZE = 6144; // côté de la carte en mètres
export const TERRAIN_RES = 1024; // résolution de la carte de hauteur
export const SUMMIT_HEIGHT = 260;
export const LAKE_LEVEL = 8;

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

// Soleil : fin d'après-midi, ouest-sud-ouest.
export const SUN_BEARING = 250;
export const SUN_ELEVATION = 15;

// Rivière (x, z, altitude du lit). Coule d'ouest en est vers le lac.
export const RIVER: [number, number, number][] = [
  [-3200, -420, 46],
  [-2300, -520, 36],
  [-1500, -480, 27],
  [-950, -565, 20],
  [-492, -630, 15],
  [-130, -775, 12.5],
  [300, -850, 10.5],
  [680, -965, 9],
  [1000, -1040, 8],
];
export const RIVER_WIDTH = 13;

// Route (x, z). De l'entrée ouest au campement, au pont, au village, puis sortie nord-est.
export const ROAD: [number, number][] = [
  [-2600, -260],
  [-1700, -250],
  [-1150, -205],
  [-760, -150],
  [-650, -205],
  [-640, -340],
  [-585, -500],
  [-512, -596],
  [-468, -672],
  [-380, -800],
  [-230, -890],
  [-80, -925],
  [20, -918],
  [130, -935],
  [300, -1010],
  [520, -1180],
  [760, -1500],
  [900, -2100],
];
export const ROAD_WIDTH = 5.5;
/** Indices de ROAD entre lesquels le véhicule patrouille (campement ↔ village). */
export const PATROL_RANGE: [number, number] = [3, 13];

export const BRIDGE = { x: -490, z: -634, deck: 19.2, length: 34, width: 6 };

export const SITES = {
  summit: { x: 0, z: 0, h: SUMMIT_HEIGHT, r0: 30, r1: 46 },
  plate1: { ...polar(102, 104), h: 0, r0: 5, r1: 14 },
  plate2: { ...polar(105, 300), h: 0, r0: 6, r1: 18 },
  balloon: { ...polar(121, 224), h: 0, r0: 5, r1: 14 },
  relay: { ...polar(72, 520), h: 236, r0: 13, r1: 40 },
  camp: { x: -652, z: -150, h: 60, r0: 46, r1: 120 },
  village: { x: 30, z: -958, h: 24, r0: 95, r1: 210 },
  mirador: { x: 990, z: -765, h: 11.5, r0: 22, r1: 70 },
  drone: { ...polar(334, 455), h: 0, r0: 0, r1: 0 },
};

/** Éperon est : axe et profil de crête. */
export const SPUR_BEARING = 105;
export function spurCrest(t: number): number {
  return 252 - 14 * (1 - Math.exp(-t / 40)) - 0.11 * t;
}

export const LAKE_BLOBS: [number, number, number, number][] = [
  // x, z, rx, rz
  [1560, -930, 560, 330],
  [1180, -840, 190, 150],
  [2100, -1100, 420, 380],
];

/** Retouches fines du sommet appliquées à l'exécution (résolution du maillage, pas de la carte). */
export const SCULPT: { x: number; z: number; h: number; r0: number; r1: number }[] = [
  // rebord d'éboulis nord-ouest, hors les murs
  { ...polar(322, 38.5), h: 257.2, r0: 3.6, r1: 7 },
];

/**
 * Cônes de vue : devant chaque poste de tir, le sol est abaissé sous un plan incliné pour que le plateau
 * ne masque pas la vallée. (x, z) origine, y altitude de l'œil, b0→b1 secteur d'azimuts, slope = pente du plan.
 */
export const CLEAR: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number }[] = [
  { x: 27.0, z: -7.0, y: SUMMIT_HEIGHT + 0.1, b0: 84, b1: 132, slope: 0.32, start: 0.45 }, // brèche est
  { x: -28.3, z: -6.4, y: SUMMIT_HEIGHT + 0.1, b0: 266, b1: 300, slope: 0.21, start: 0.45 }, // brèche ouest
  { x: 2.6, z: -20.5, y: SUMMIT_HEIGHT + 0.5, b0: 312, b1: 388, slope: 0.185, start: 0.3 }, // créneaux nord
  { x: -25.0, z: -32.0, y: 257.2 + 0.1, b0: 298, b1: 358, slope: 0.17, start: 0.45 }, // rebord d'éboulis
];

// ---------------------------------------------------------------------------------------------
// La ruine. Coordonnées locales = coordonnées monde (le sommet est à l'origine), sol à SUMMIT_HEIGHT.
// ---------------------------------------------------------------------------------------------
export interface Opening {
  /** abscisse du centre le long du mur (m depuis a) */
  s: number;
  w: number;
  /** hauteur de l'appui (0 = brèche jusqu'au sol) */
  sill: number;
  /** hauteur du linteau ; absent = ouvert jusqu'en haut */
  top?: number;
}
export interface WallDef {
  a: [number, number];
  b: [number, number];
  t: number;
  h: number;
  /** 0..1 : irrégularité de l'arase */
  rag: number;
  openings?: Opening[];
  /** hauteur plancher minimale de l'arase */
  minH?: number;
  /** profil imposé : hauteur en fonction de l'abscisse normalisée 0..1 */
  profile?: [number, number][];
}

export const TOWER = { x0: 13.75, x1: 22.25, z0: -15.25, z1: -6.75, floor: 4.3, t: 1.25 };

export const WALLS: WallDef[] = [
  // enceinte, dans le sens horaire depuis l'angle nord-ouest (effondré : accès au rebord d'éboulis)
  { a: [-17.5, -19.3], b: [20, -20], t: 1.3, h: 3.0, rag: 0.35, minH: 1.9, openings: [{ s: 12.5, w: 1.05, sill: 0.8 }, { s: 16.3, w: 1.05, sill: 0.8 }, { s: 20.1, w: 1.05, sill: 0.8 }, { s: 23.9, w: 1.05, sill: 0.8 }], profile: [[0, 0.25], [0.08, 0.8], [0.2, 1], [1, 1]] },
  { a: [20, -20], b: [28, -4], t: 1.3, h: 2.6, rag: 0.5, minH: 1.5, openings: [{ s: 14.6, w: 2.6, sill: 0 }] },
  { a: [28, -4], b: [26, 13], t: 1.3, h: 3.4, rag: 0.6, minH: 1.4 },
  { a: [26, 13], b: [10, 26], t: 1.3, h: 4.2, rag: 0.55, minH: 1.6 },
  { a: [10, 26], b: [-14, 25], t: 1.4, h: 4.6, rag: 0.4, minH: 2.2, openings: [{ s: 11, w: 2.4, sill: 0, top: 3.0 }] },
  { a: [-14, 25], b: [-28, 8], t: 1.3, h: 3.8, rag: 0.6, minH: 1.5 },
  { a: [-28, 8], b: [-28, -10], t: 1.3, h: 2.8, rag: 0.5, minH: 1.5, openings: [{ s: 14.4, w: 2.6, sill: 0 }] },
  { a: [-28, -10], b: [-23, -16.8], t: 1.3, h: 2.4, rag: 0.7, minH: 0.9, profile: [[0, 1], [0.6, 0.9], [1, 0.2]] },
  // cloison intérieure et arcade
  { a: [-7, -18.6], b: [-7, -5], t: 0.9, h: 3.6, rag: 0.7, minH: 0.5, openings: [{ s: 8.5, w: 1.6, sill: 0, top: 2.3 }], profile: [[0, 1], [0.7, 0.85], [1, 0.25]] },
  { a: [-16, 9], b: [-4, 9], t: 0.9, h: 3.2, rag: 0.8, minH: 0.35, openings: [{ s: 3, w: 1.5, sill: 0, top: 2.4 }, { s: 6.5, w: 1.5, sill: 0, top: 2.4 }], profile: [[0, 1], [0.75, 1], [1, 0.15]] },
  // tour (nord, est, sud, ouest)
  { a: [13.75, -15.25], b: [22.25, -15.25], t: 1.25, h: 7.6, rag: 0.25, minH: 4.3, profile: [[0, 1], [0.5, 0.95], [0.62, 0.57], [1, 0.57]] },
  { a: [22.25, -15.25], b: [22.25, -6.75], t: 1.25, h: 4.3, rag: 0, minH: 4.3 },
  { a: [22.25, -6.75], b: [13.75, -6.75], t: 1.25, h: 7.0, rag: 0.3, minH: 4.3, openings: [{ s: 4.3, w: 1.5, sill: 0, top: 2.5 }], profile: [[0, 0.62], [0.2, 0.75], [0.45, 1], [1, 1]] },
  { a: [13.75, -6.75], b: [13.75, -15.25], t: 1.25, h: 7.4, rag: 0.2, minH: 6.2, openings: [{ s: 6.6, w: 1.3, sill: 4.3, top: 6.3 }] },
];

/** Escalier extérieur le long de la face ouest de la tour : du sol (z = -5.2) à l'étage (z = -12.6). */
export const STAIR = { x0: 11.85, x1: 13.1, zBottom: -5.0, zTop: -12.6, rise: 4.3, landingZ: -14.6 };

/** Points de vie de la ruine. */
export const RUIN = {
  start: { x: -2, z: 14, yaw: 0 },
  rack: { x: 3.5, z: 19.2 },
  well: { x: -1.5, z: 1.5 },
  /** rayon du terrain libre hors les murs : le replat du sommet, que la pente ferme de tous côtés */
  roam: 50,
  /** zones dallées (x, z, rayon) : pas d'herbe */
  paved: [[18, -11, 6.5], [3.5, 18, 5.5], [12.4, -9, 2.2], [-1.5, 1.5, 2.2]] as [number, number, number][],
};

/**
 * Postes de tir nommés (pour le briefing, l'aide et les tests automatisés). `y` : hauteur d'un plancher au-dessus du
 * sol de la ruine (étage de la tour) ; `ground` : altitude du sol du poste quand ce n'est pas celle de la ruine.
 */
export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  nord: { label: 'Créneau nord', x: 2.6, z: -18.7, stance: 'crouch' },
  est: { label: 'Brèche est', x: 27.0, z: -7.0, stance: 'prone' },
  eboulis: { label: "Rebord d'éboulis", x: -25.0, z: -32.0, ground: 257.2, stance: 'prone' },
  tour: { label: 'Étage de la tour', x: 22.15, z: -11.6, y: 4.3, stance: 'prone' },
  ouest: { label: 'Brèche ouest', x: -28.3, z: -6.4, stance: 'prone' },
};

/**
 * Couloirs de visée garantis : le générateur de terrain rabote tout relief qui dépasserait la ligne
 * poste → cible (avec marge). [poste, x, z, hauteur de la cible au-dessus du sol du site ou altitude absolue si abs].
 */
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean }[] = [
  { post: 'est', ...polar(102, 104), y: 1.2 },
  { post: 'est', ...polar(105, 300), y: 1.2 },
  { post: 'est', ...polar(121, 224), y: 2.5 },
  { post: 'tour', ...polar(72, 520), y: 13 },
  { post: 'tour', x: 990, z: -765, y: 6.5 },
  { post: 'ouest', x: -652 + 23, z: -150 - 4, y: 6 },
  { post: 'ouest', x: -652 + 20.5, z: -150 + 13.5, y: 0.3 },
  { post: 'eboulis', x: -490, z: -634, y: 0.4 },
  { post: 'eboulis', ...polar(334, 455), y: 40 },
  { post: 'nord', x: 30, z: -958, y: 0.6 },
  { post: 'nord', x: 30, z: -942, y: 0.6 },
  { post: 'nord', x: -380, z: -800, y: 0.5 },
  { post: 'nord', x: -230, z: -890, y: 0.5 },
  { post: 'nord', x: -80, z: -925, y: 0.5 },
  { post: 'eboulis', x: -380, z: -800, y: 0.5 },
  { post: 'eboulis', x: -230, z: -890, y: 0.5 },
  { post: 'eboulis', x: 30, z: -950, y: 0.6 },
];

// ---------------------------------------------------------------------------------------------
// Zone praticable (joueur) : l'enceinte, le couloir du rebord d'éboulis et le seuil des deux brèches.
// ---------------------------------------------------------------------------------------------
export const ENCLOSURE: [number, number][] = [[-17.5, -19.3], [20, -20], [28, -4], [26, 13], [10, 26], [-14, 25], [-28, 8], [-28, -10], [-23, -16.8]];
export const LEDGE_A = { x: -20.3, z: -18.4 };
export const LEDGE_B = { x: -24.6, z: -31.4 };

// ---------------------------------------------------------------------------------------------
// Végétation et rochers posés à la main autour de la ruine.
// ---------------------------------------------------------------------------------------------
/** Secteurs de tir à garder dégagés près du sommet : [azimut, demi-largeur]. */
export const CORRIDORS: [number, number][] = [[100, 12], [107, 12], [121, 10], [72, 10], [47, 9], [283, 12], [345, 34]];
/** Arbres détaillés autour de la ruine (sp : 0 conifère, 1 conifère clair). */
export const NEAR_TREES: { x: number; z: number; s: number; sp: number }[] = [
  { x: -19, z: 15.5, s: 1.0, sp: 0 }, // dans la cour
  { x: -33, z: 16, s: 1.25, sp: 0 }, { x: -22, z: 33, s: 1.1, sp: 1 }, { x: 2, z: 36, s: 1.35, sp: 0 }, { x: 15, z: 33.5, s: 0.95, sp: 1 },
  { x: 31, z: 22, s: 1.15, sp: 0 }, { x: -37, z: -2, s: 0.9, sp: 1 }, { x: -9, z: 42, s: 1.2, sp: 0 }, { x: 24, z: 38, s: 1.3, sp: 0 },
];
/** Passages gardés libres de rochers (x, z, rayon) : brèches et postes, pied de l'escalier, départ, portes et arcades. */
export const LANES: [number, number, number][] = [
  [POSTS.est.x, POSTS.est.z, 2.8], [POSTS.est.x - 2.6, POSTS.est.z + 1.3, 2.2], [POSTS.ouest.x, POSTS.ouest.z, 2.8], [POSTS.ouest.x + 2.8, POSTS.ouest.z, 2.2],
  [POSTS.nord.x, POSTS.nord.z, 2.0], [POSTS.eboulis.x, POSTS.eboulis.z, 2.6],
  [(STAIR.x0 + STAIR.x1) / 2, STAIR.zBottom + 1.4, 2.4], [RUIN.start.x, RUIN.start.z, 2.2],
  [-13, 9, 1.8], [-9.5, 9, 1.8], [-7, -10.1, 1.8], [17.95, -6.75, 1.8], [-1, 25.5, 2.0], [24.4, -5, 2.0],
];
/** Couloirs libres (ax, az, bx, bz, rayon) : angle effondré → rebord d'éboulis, entre la tour et le mur est, entre la tour et le mur nord. */
export const LANE_SEGS: [number, number, number, number, number][] = [[-20.3, -18.4, -24.6, -31.4, 1.8], [24.4, -15.5, 24.4, -2.5, 1.6], [12.5, -17.6, 22, -17.6, 1.6]];
/** Gros blocs en bord de plateau : [azimut, distance, échelle]. */
export const BOULDERS: [number, number, number][] = [[300, 34, 1.5], [22, 35, 1.2], [140, 36, 1.6], [200, 38, 2.0], [250, 37, 1.3], [312, 45, 1.5], [336, 43, 1.1], [150, 44, 1.4]];
/** Bois mort : [x, z, rotation, échelle]. */
export const DEADWOOD: [number, number, number, number][] = [[-15, 20, 0.4, 2.2], [8, -3, 2.1, 1.8], [-34, 20, 1.2, 2.6], [20, 30, 0.2, 2.4]];

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
/** Portée de rendu : plan lointain de la caméra, portée des ombres, densité de la brume (1 = référence), rayon planté d'arbres. */
export const RENDER = { cameraFar: 14000, shadowFar: 2600, haze: 1, treeRange: 2600 };
/**
 * Armes du râtelier, par calibre croissant. Les sept d'origine, plus les quatre calibres intermédiaires qui ont un
 * emploi jusqu'à 1 251 m : 6 mm Creedmoor (plaques et ballon, recul infime), 6.5 PRC et 7 mm PRC (encore supersoniques
 * au mirador), .300 PRC (l'énergie du .300 Win Mag avec la tenue au vent du .338). Les calibres de très longue
 * distance (.33 XC et au-delà) n'ont rien à faire sur une carte de 1 251 m : ils sont au niveau avancé.
 * Le .223 reste en deuxième place (le tutoriel le prend par la touche 2).
 */
export const WEAPON_IDS = ['22lr', '223', '6cm', '65cm', '65prc', '308', '308sub', '7prc', '300wm', '300prc', '338lm'];
/** Physique du tir propre au niveau. Valeurs neutres : rien d'activé, balistique d'origine dans l'air du jeu. */
export const PHYSICS = { latitudeDeg: 45, altitudeM: 0, temperatureC: 15, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
/**
 * Bâtiments posés dans la vallée (banque de src/buildings, sélection « premier choix »). Le relief est terrassé
 * dessous par terrain.gen.mjs ; aucune des dix-sept lignes de visée ne passe à moins de 40 m au-dessus d'un lot.
 *  - l'église du bourg, au nord de la place du marché, façade vers la place (et vers le tireur) : remplace
 *    l'ancienne église du décor ; sans ses dalles de route (`ground: 'none'`), le sol du village passe dessous ;
 *  - le moulin sur la rive nord de la rivière, entre le pont et le village, son bief côté rivière ;
 *  - le château d'eau sur le replat au nord-ouest du village ;
 *  - le sanatorium sur le versant nord-est, galeries de cure plein sud, face à la ruine (1 260 m).
 */
export const BUILDINGS: { id: string; carte?: string; name?: string; x: number; z: number; yaw: number; usure?: number; groundY?: number; ground?: 'paved' | 'keep' | 'none' }[] = [
  { id: 'eglise', x: 24, z: -1018, yaw: 0, groundY: 24, ground: 'none' },
  { id: 'moulin', x: -140, z: -818, yaw: -1.337, groundY: 15.2 },
  { id: 'chateau-eau', x: -325, z: -1115, yaw: 0.28 },
  { id: 'sanatorium', carte: 'galeries', x: 270, z: -1232, yaw: -0.21 },
];
/**
 * Voies secondaires : chaque bâtiment est relié à la route de la vallée. Tracées dans le relief et la carte de
 * matières par le générateur (lib.carveWays) ; `to` nomme le bâtiment desservi (son `id`, faute de `name`).
 *  - ruelle de l'église : de la route à la grille du cimetière, le long du muret ouest de la place (à l'écart des étals) ;
 *  - chemin du moulin : quitte la route à l'ouest du village et descend vers la cour, côté logis ;
 *  - chemin du château d'eau : monte du carrefour de l'ouest au portail sud, en écharpe ;
 *  - chemin du sanatorium : le chemin forestier de la fiche, de la route du nord-est à l'entrée est du parc.
 */
export const WAYS: {
  name: string; kind: 'route' | 'chemin' | 'allee'; width: number; pts: [number, number][]; to?: string; maxSlope?: number;
  bridges?: { x: number; z: number; deck: number; length: number; kind?: 'pierre' | 'bois' | 'beton'; width?: number }[];
}[] = [
  { name: 'ruelle de l’église', kind: 'route', width: 3.5, to: 'eglise', pts: [[6, -918.4], [7.8, -937], [7.8, -974], [12, -986], [17, -992.5]] },
  { name: 'chemin du moulin', kind: 'chemin', width: 3, to: 'moulin', pts: [[-232, -888.8], [-204, -868], [-178, -853], [-160.5, -847]] },
  { name: 'chemin du château d’eau', kind: 'chemin', width: 3.2, to: 'chateau-eau', pts: [[-300, -854.8], [-322, -900], [-340, -960], [-350, -1010], [-343, -1055], [-328, -1080], [-320.6, -1091.5]] },
  { name: 'chemin du sanatorium', kind: 'chemin', width: 3.5, to: 'sanatorium', pts: [[434, -1101], [412, -1148], [376, -1192], [344, -1214], [317, -1218.5]] },
];
/** Cloche du village : chambre des cloches de l'église (repère local −12,5 ; 13,3 ; 13,5 du modèle, lacet nul). */
export const BELL = { x: 24 - 12.5, y: 24 + 13.3, z: -1018 + 13.5 };
/** Repères sonores (x, y, z) : cloche et rumeur du village, sirène du campement, clapotis du lac. */
export const LAKE_SOUND: [number, number, number] = [1400, 8, -950];
/** Portée du télémètre et de la visée (m) ; distance maximale des tables du carnet de tir (m). */
export const RANGE_LIMIT = 2600;
export const DOPE_LIMIT = 1600;
/** Plan du tireur automatique (e2e/mission.mjs) : un poste, une arme et un grossissement par objectif. */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'plates', post: 'est', weapon: '223', targets: ['plate1', 'plate2'], zoom: 12 },
  { step: 'balloon', post: 'est', weapon: '223', targets: ['balloon'], zoom: 14 },
  { step: 'relay', post: 'tour', weapon: '65cm', targets: ['relay'], zoom: 18 },
  { step: 'searchlight', post: 'ouest', weapon: '65cm', targets: ['searchlight'], zoom: 20 },
  { step: 'drum', post: 'ouest', weapon: '65cm', targets: ['drum'], zoom: 20 },
  { step: 'padlock', post: 'eboulis', weapon: '65cm', targets: ['padlock'], zoom: 25 },
  { step: 'drone', post: 'eboulis', weapon: '223', targets: ['drone'], zoom: 20 },
  { step: 'sentinel', post: 'tour', weapon: '338lm', targets: ['sentinel'], zoom: 28 },
  { step: 'vehicle', post: 'nord', weapon: '308', targets: ['vehicle'], zoom: 16 },
  { step: 'hostile', post: 'nord', weapon: '65cm', targets: ['hostile'], zoom: 22 },
];
/** Trajets de retour réalistes, du poste au point de départ (e2e/walk.mjs). */
export const TEST_WALK: Record<string, [number, number][]> = {
  nord: [[2.2, -10], [2.8, 2]],
  est: [[24.4, -3.6], [10, 6]],
  tour: [[15.6, -13.35], [12.5, -13.35], [12.47, -12.2], [12.47, -3.8], [6, 8]],
  eboulis: [[-22.5, -24], [-20.3, -18.4], [-12, -12], [-12, 5], [-9.5, 7.4], [-9.5, 10.6]],
  ouest: [[-24.5, -5.5], [-13, 6], [-13, 7.4], [-13, 10.6]],
};
/** Positions du scénario tactile (e2e/mobile.mjs, e2e/tutorial.mjs). */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
} = {
  post: [27.0, -7.0, 1.75],
  rack: [3.5, 17.6, Math.PI],
  yard: [-6, 6, 0.5],
  far: { at: [22.15, -11.6, 0, 'prone', 4.3], target: 'relay' },
  crowd: { weapon: '65cm', at: [2.6, -18.7, 0, 'crouch', 0], target: 'hostile' },
};

/** Vues de mesure de e2e/perf.mjs (celles qu'il portait en dur) : cour, vallée, contre-jour, lunette sur le marché. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  tp: { at: [-6, 6, 0.5, 'stand'] },
  nord: { at: [-3, -15.5, 0.25, 'stand'], pitch: -0.2 },
  sun: { at: [6, -2, 4.25, 'stand'], pitch: 0.1 },
  scope: { at: [2.6, -18.7, 0, 'crouch'], scope: { weapon: '65cm', zoom: 18, target: 'hostile' } },
};

/**
 * Écho du tir : la ruine est sur un piton, dans une vallée encaissée. Le versant sud monte à 450 m, ses épaules au
 * sud-est et au sud-ouest, la crête de l'est, puis la grande paroi du nord (400 m de haut, à 1,5 km) et le fond du
 * nord-ouest : la détonation revient six fois, de plus en plus sourde.
 * Distances et azimuts relevés sur la carte de hauteur (pentes tournées vers le site). Voir src/levels/README.md.
 */
export const ECHO = {
  reliefs: [
    { distance: 450, bearing: 180, size: 0.8 },
    { distance: 650, bearing: 140, size: 0.6 },
    { distance: 900, bearing: 215, size: 0.6 },
    { distance: 1300, bearing: 100, size: 0.5 },
    { distance: 1500, bearing: 350, size: 0.9 },
    { distance: 2100, bearing: 300, size: 0.6 },
  ],
  tail: 1.1,
};
