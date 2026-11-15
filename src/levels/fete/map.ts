// Niveau « fete » : La Fête foraine. Une station balnéaire en fin de journée ; on tire depuis une terrasse de bois
// posée sur le toit du Grand Hôtel, vers le nord, le long du front de mer : la mer à gauche (ouest), l'esplanade et
// ses stands de tir au milieu, le parc d'attractions fermé, la piscine et le bourg à droite.
// Données de carte partagées par le générateur de relief (Node) et le jeu.
// Fichier sans import et sans syntaxe TypeScript non effaçable : Node le charge tel quel.
// Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// Le site de tir (la terrasse du toit) est à l'origine.

export const TERRAIN_SIZE = 3072; // côté de la carte en mètres
export const TERRAIN_RES = 768; // résolution de la carte de hauteur (mailles de 4 m)

/** Niveau de la mer dessinée (src/world/sea.ts). */
export const SEA = 0;
/**
 * Niveau d'eau déclaré au relief (`terrain.waterLevel`) : 1,6 m sous la mer dessinée. Le relief assombrit le sol
 * jusqu'à 1,6 m au-dessus de ce niveau (rive mouillée) : déclaré au niveau de la mer, tout le front de mer, presque
 * plat, serait mouillé. Les gerbes des balles tombées à l'eau sont redessinées à la surface par la carte (index.ts).
 */
export const WATER_LEVEL = SEA - 1.6;
/** Trait de côte : x du bord de l'eau (la mer est à l'ouest). C'est celui du modèle du Grand Hôtel. */
export const SHORE_X = -38.2;
/** Altitude du sol de l'esplanade au bord de mer. */
export const LAND_Y = 0.02;
/** Altitude du y = 0 du Grand Hôtel : sa mer peinte (y = 0,04) passe juste sous la mer du jeu. */
export const HOTEL_GROUND = -0.2;
/** Plancher de la terrasse du toit au-dessus du y = 0 de l'hôtel (faîtage du terrasson de zinc mesuré à 19,1 m). */
export const DECK_HEIGHT = 19.5;
/** Altitude du plancher de la terrasse : le « sol du site » pour tout le socle. */
export const BASE_Y = HOTEL_GROUND + 0.03 + DECK_HEIGHT;

export interface P2 {
  x: number;
  z: number;
}

// Soleil : fin de journée, bas sur la mer à l'ouest-sud-ouest. Les cibles, tournées vers le sud, sont éclairées de trois quarts.
export const SUN_BEARING = 246;
export const SUN_ELEVATION = 17;

const Q = Math.PI / 2;

/**
 * Bâtiments de la banque (data.buildings). Lacet 0 : la façade sud du modèle regarde +z.
 *  - Grand Hôtel : façade tournée vers la mer (ouest), pignon ouest du modèle vers le nord ; posé pour que le bout
 *    nord de son toit tombe sur l'origine. Son modèle apporte la plage, la digue, la rue de derrière et un rectangle
 *    de mer (156 × 168 m) ; l'étage détaché que le modèle pose au sol derrière l'hôtel est caché.
 *  - parc d'attractions : les deux cartes côte à côte, l'entrée (tête de Watty) tournée vers l'esplanade.
 *  - piscine Art déco : façade tournée vers le sud, donc vers l'hôtel.
 *  - halte : un tronçon de faubourg (voir la note de passation), au bout du boulevard.
 */
export const BUILDINGS: { id: string; carte?: string; name: string; x: number; z: number; yaw: number; usure: number; groundY?: number; hide?: string[]; lod?: 'auto' | 'full' | 'far' }[] = [
  { id: 'grand-hotel', name: 'hotel', x: -10, z: 25, yaw: -Q, usure: 0.45, groundY: HOTEL_GROUND, hide: ['etage'], lod: 'full' },
  { id: 'parc-attractions', carte: 'entree', name: 'parc', x: 66, z: -162, yaw: -Q, usure: 0.6 },
  { id: 'parc-attractions', carte: 'maneges', name: 'maneges', x: 68, z: -96, yaw: -Q, usure: 0.6 },
  { id: 'piscine-art-deco', name: 'piscine', x: 66, z: -268, yaw: 0, usure: 0.6 },
  { id: 'halte-passage-niveau', carte: 'epicerie', name: 'halte', x: 64, z: -420, yaw: 0, usure: 0.6 },
];
const lot = (name: string): { id: string; carte?: string; x: number; z: number; yaw: number } => BUILDINGS.find((b) => b.name === name)!;
export const LOTS = { hotel: lot('hotel'), parc: lot('parc'), maneges: lot('maneges'), piscine: lot('piscine'), halte: lot('halte') };

/**
 * Emprise au sol de tout ce que le modèle du Grand Hôtel dessine (plage, dunes, rue de derrière, rangée de maisons,
 * mer) : x0..x1, z0..z1 dans le monde. Le relief du jeu passe dessous.
 */
export const HOTEL_AREA = { x0: -103, x1: 65, z0: -52, z1: 102 };
/** Piscine de la terrasse de l'hôtel (creusée de 2,9 m) : le relief est creusé dessous. */
export const HOTEL_POOL = { x0: -21, x1: -13, z0: 29, z1: 43 };

/** Boulevard de la Mer : x de son axe, entre l'esplanade (à l'ouest) et les lots (à l'est). */
export const BOULEVARD_X = 25;
/** Promenade de la digue : dalle de pierre le long de la plage, dans le prolongement de celle de l'hôtel. */
export const PROMENADE = { x0: -27, x1: -23, z0: -470, z1: -51 };

/**
 * Voies : chaque bâtiment est relié au boulevard de la Mer, qui part de la rue de derrière de l'hôtel et longe
 * l'esplanade vers le nord. Tracées dans le relief et la carte de matières par le générateur (lib.carveWays).
 */
export const WAYS: {
  name: string; kind: 'route' | 'chemin' | 'allee'; width: number; pts: [number, number][]; to?: string; maxSlope?: number;
  bridges?: { x: number; z: number; deck: number; length: number; kind?: 'pierre' | 'bois' | 'beton'; width?: number }[];
}[] = [
  { name: 'boulevard de la Mer', kind: 'route', width: 6, to: 'hotel', pts: [[BOULEVARD_X + 3, -620], [BOULEVARD_X + 1, -500], [BOULEVARD_X, -400], [BOULEVARD_X, -250], [BOULEVARD_X, -120], [BOULEVARD_X, -54]] },
  { name: 'allée des manèges', kind: 'allee', width: 4, to: 'maneges', pts: [[BOULEVARD_X + 1, -96], [39, -96]] },
  { name: 'allée du parc', kind: 'allee', width: 5, to: 'parc', pts: [[BOULEVARD_X + 1, -159], [35, -159]] },
  { name: 'rue des Bains', kind: 'route', width: 5, to: 'piscine', pts: [[BOULEVARD_X + 1, -243], [35, -243]] },
  { name: 'rue du Faubourg', kind: 'route', width: 5, to: 'halte', pts: [[BOULEVARD_X + 1, -420], [38, -420]] },
];

// ---------------------------------------------------------------------------------------------
// Les stands de tir de la fête : tout est sur l'esplanade, entre la digue et le boulevard.
// ---------------------------------------------------------------------------------------------
/**
 * Plaques de réglage, sur l'esplanade : la carrée à 68 m (assez loin pour que le .22 LR demande un peu d'élévation :
 * le tutoriel la fait régler), la ronde à 112 m.
 */
export const PLATES = { p1: { x: 5, z: -68 }, p2: { x: 3, z: -112 } };
/** Baraques foraines : trois stands en rang, deux ballons accrochés au-dessus de chaque auvent. */
export const STALLS = { z: -138, xs: [-12, -2, 8], w: 4.4, d: 3, h: 2.7, balloonY: 4.5, colors: [0xc8412f, 0x2f6f9a, 0xd6a12c] };
/** Grande roue des cibles : dans un plan est-ouest, face au toit de l'hôtel. Elle tourne par à-coups. */
export const WHEEL = {
  x: -10, z: -215, hub: 13.2, r: 10.4, cabins: 8,
  /** un huitième de tour en `move` secondes, puis `hold` secondes d'arrêt franc */
  move: 2.6, hold: 6,
  /** nacelles qui portent une plaque (numéros de 0 à 7) */
  plates: [0, 2, 3, 5, 6],
};
/** Manège des silhouettes, à l'arrêt : six silhouettes d'acier sur le bord du plateau, tournées vers l'hôtel. */
export const CAROUSEL = { x: 14, z: -262, r: 5, figures: ['duck', 'star', 'disc', 'duck', 'star', 'disc'] as ('duck' | 'star' | 'disc')[] };
/** Tape-fort : mât gradué de 8 m, la cloche en haut. */
export const STRIKER = { x: 5, z: -300, h: 8, minEnergy: 250 };
/** Guirlande : six globes entre deux mâts, à éteindre de gauche à droite. */
export const GARLAND = { z: -420, y: 6.4, xs: [5, 8, 11, 14, 17, 20], mastX: [3, 22], r: 0.26 };

/** Points de vie de la terrasse. */
export const DECK = {
  x0: -6, x1: 6, z0: -3.6, z1: 10.4,
  /** souche de cheminée de l'hôtel qui traverse le plancher (x, z, demi-largeurs) */
  chimney: { x: 0, z: 4, hx: 0.6, hz: 0.9 },
  start: { x: 2.6, z: 6.4, yaw: 0 },
  rack: { x: -2.7, z: 7.9 },
};

/** Postes de tir : tous au bord nord de la terrasse, sans garde-corps de ce côté. */
export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  /** accroupi : le tir plonge de 30° vers la première plaque ; clé du tutoriel */
  appui: { label: 'Bord nord', x: -2.4, z: -3.0, stance: 'crouch' },
  /** couché sur le tapis de tir, pour les séries au-delà de 200 m */
  tapis: { label: 'Tapis de tir', x: 2.4, z: -3.05, stance: 'prone' },
};

export const SCULPT: { x: number; z: number; h: number; r0: number; r1: number }[] = [];
export const CLEAR: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number }[] = [];

/** Sites aplanis par le générateur (cibles posées au sol). */
export const SITES = {
  plate1: { x: PLATES.p1.x, z: PLATES.p1.z, h: 0, r0: 4, r1: 9 },
  plate2: { x: PLATES.p2.x, z: PLATES.p2.z, h: 0, r0: 5, r1: 12 },
  stalls: { x: -2, z: STALLS.z, h: 0, r0: 16, r1: 26 },
  wheel: { x: WHEEL.x, z: WHEEL.z, h: 0, r0: 14, r1: 24 },
  carousel: { x: CAROUSEL.x, z: CAROUSEL.z, h: 0, r0: 7, r1: 14 },
  striker: { x: STRIKER.x, z: STRIKER.z, h: 0, r0: 4, r1: 10 },
  garland: { x: 12.5, z: GARLAND.z, h: 0, r0: 12, r1: 20 },
};

/**
 * Couloirs de visée : poste → cible, y au-dessus du sol en place. Le pays est plat et le tireur à vingt mètres de
 * haut : le relief n'en coupe aucun ; la végétation n'y plante rien.
 */
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean }[] = [
  { post: 'appui', x: PLATES.p1.x, z: PLATES.p1.z, y: 1.0 },
  { post: 'appui', x: PLATES.p2.x, z: PLATES.p2.z, y: 1.0 },
  ...STALLS.xs.map((x) => ({ post: 'appui', x, z: STALLS.z, y: STALLS.balloonY })),
  { post: 'tapis', x: WHEEL.x, z: WHEEL.z, y: 2.2 },
  { post: 'tapis', x: WHEEL.x - WHEEL.r, z: WHEEL.z, y: WHEEL.hub },
  { post: 'tapis', x: WHEEL.x + WHEEL.r, z: WHEEL.z, y: WHEEL.hub },
  { post: 'tapis', x: CAROUSEL.x - CAROUSEL.r, z: CAROUSEL.z, y: 1.6 },
  { post: 'tapis', x: CAROUSEL.x + CAROUSEL.r, z: CAROUSEL.z, y: 1.6 },
  { post: 'tapis', x: STRIKER.x, z: STRIKER.z, y: STRIKER.h },
  { post: 'tapis', x: GARLAND.xs[0], z: GARLAND.z, y: GARLAND.y },
  { post: 'tapis', x: GARLAND.xs[5], z: GARLAND.z, y: GARLAND.y },
];

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
/** Carte courte au bord de l'eau : ombres jusqu'aux dernières cibles, brume de mer légère. */
export const RENDER = { cameraFar: 14000, shadowFar: 620, haze: 0.75, treeRange: 1500 };
/** Armes du râtelier : arsenal court, de la plus douce à la plus tendue. */
export const WEAPON_IDS = ['22lr', '223', '6cm', '65cm'];
/** Physique du tir : rien d'activé, air standard du bord de mer. */
export const PHYSICS = { latitudeDeg: 46, altitudeM: 0, temperatureC: 19, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
/** Vent : un souffle de mer, régulier. On apprend ici les séries, pas la dérive. */
export const WIND = { fromBearing: 262, speed: 0.6, gusts: 0.4, shelter: 1, shelterHeight: 30 };
/** Ciel de fin de journée : la bande de nuages de la photographie en partie gardée, soleil doré. */
export const SKY = { clear: 0.45, warmth: 1.15, cloudShadow: 0.2, exposure: 0.96 };
/** Le fond de « vallée » est mis sous la mer : les arbres du socle ne poussent pas à moins de 9,5 m au-dessus de lui. */
export const ATMOSPHERE = { valleyY: -12, mistBase: 10, mistTop: 60, mist: 0.35 };
/** Pays de sable : herbe rase et pâle des dunes, sable clair (canal de la terre battue), pins au loin. */
export const PALETTE = {
  grass: [1.18, 1.1, 0.78] as [number, number, number],
  dirt: [2.05, 1.85, 1.45] as [number, number, number],
  scree: [1.25, 1.2, 1.1] as [number, number, number],
  forest: [1.1, 1.0, 0.8] as [number, number, number],
  dryness: 0.22, mossAmount: 0,
  blades: { density: 0 },
  foliage: [0.92, 1.0, 0.82] as [number, number, number],
};
export const ROCKS = { count: 0, near: 0, radius: 60 };
export const TREES = { nearMix: [0.7, 0.3, 0] as [number, number, number], nearCount: 0, density: 0.9, broadleaf: 0.15 };
export const RANGE_LIMIT = 700;
export const DOPE_LIMIT = 600;
/** Plafond des bonus de la carte (src/shared/scores-core.mjs : LEVEL_RULES.fete.bonus). */
export const BONUS_MAX = 6000;

/** Plan du tireur automatique (e2e/mission.mjs). */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'plates', post: 'appui', weapon: '22lr', targets: ['plate1', 'plate2'], zoom: 8 },
  { step: 'balloons', post: 'appui', weapon: '223', targets: ['balloon1', 'balloon2', 'balloon3', 'balloon4', 'balloon5', 'balloon6'], zoom: 10 },
  { step: 'wheel', post: 'tapis', weapon: '223', targets: ['wheel1', 'wheel2', 'wheel3', 'wheel4', 'wheel5'], zoom: 12 },
  { step: 'carousel', post: 'tapis', weapon: '6cm', targets: ['figure1', 'figure2', 'figure3', 'figure4', 'figure5', 'figure6'], zoom: 14 },
  { step: 'striker', post: 'tapis', weapon: '6cm', targets: ['bell'], zoom: 16 },
  { step: 'garland', post: 'tapis', weapon: '65cm', targets: ['bulb1', 'bulb2', 'bulb3', 'bulb4', 'bulb5', 'bulb6'], zoom: 18 },
];
/** Trajets de retour, du poste au point de départ (e2e/walk.mjs). */
export const TEST_WALK: Record<string, [number, number][]> = {
  appui: [[-2.4, 1.5], [2.2, 2.4]],
  tapis: [[2.6, 1]],
};
/** Positions du scénario tactile (e2e/mobile.mjs, e2e/tutorial.mjs). */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  postKey?: string; near?: string; weapon?: string; rackWalk?: [number, number][];
} = {
  post: [POSTS.appui.x, POSTS.appui.z, Math.atan2(PLATES.p1.x - POSTS.appui.x, -(PLATES.p1.z - POSTS.appui.z))],
  rack: [DECK.rack.x, DECK.rack.z - 1.6, Math.PI],
  yard: [3.4, 2.2, -0.5],
  // un ballon bleu : cible mate devant l'herbe unie de l'esplanade (la mesure optique de e2e/mobile.mjs veut un fond
  // sans éclat : le bronze de la cloche ou une plaque blanche au soleil débordent en halo lumineux)
  far: { at: [POSTS.appui.x, POSTS.appui.z, 0, 'crouch', 0], target: 'balloon3' },
  crowd: { weapon: '65cm', at: [POSTS.tapis.x, POSTS.tapis.z, 0, 'prone', 0], target: 'wheel3' },
  postKey: 'appui', near: 'plate1', weapon: '65cm',
  rackWalk: [[-2.4, 1.5], [-2.7, 5.4]],
};

/** Vues de mesure de e2e/perf.mjs : départ, front de mer à l'œil nu, lunette sur la roue, le manège et la guirlande. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  depart: { at: [DECK.start.x, DECK.start.z, DECK.start.yaw, 'stand'] },
  esplanade: { at: [POSTS.appui.x, POSTS.appui.z, 0.04, 'stand'], pitch: -0.14 },
  'lunette-roue': { at: [POSTS.tapis.x, POSTS.tapis.z, 0, 'prone'], scope: { weapon: '223', zoom: 8, target: 'wheel3' } },
  'lunette-manege': { at: [POSTS.tapis.x, POSTS.tapis.z, 0, 'prone'], scope: { weapon: '6cm', zoom: 10, target: 'figure3' } },
  'lunette-guirlande': { at: [POSTS.tapis.x, POSTS.tapis.z, 0, 'prone'], scope: { weapon: '65cm', zoom: 18, target: 'bulb3' } },
};

/**
 * Écho du tir : un bord de mer plat. Les façades de la rue derrière l'hôtel renvoient un écho sec et proche, le parc
 * et la piscine un écho plus lointain ; rien du côté de la mer. Queue courte de terrain ouvert.
 */
export const ECHO = {
  reliefs: [
    { distance: 55, bearing: 70, size: 0.3 },
    { distance: 130, bearing: 35, size: 0.22 },
    { distance: 270, bearing: 14, size: 0.3 },
    { distance: 900, bearing: 80, size: 0.25 },
  ],
  tail: 0.45,
};
