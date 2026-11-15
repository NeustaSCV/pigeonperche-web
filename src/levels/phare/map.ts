// Niveau « Le Phare » : un cap de granit, son phare, et à l'est une crique où un caboteur charge au mouillage.
// On tire de la galerie de la lanterne, 34 m au-dessus de la mer, vers le sud et l'est, de 260 à 1 200 m ; un second
// poste, au ras de l'eau, est au bout de la digue des marais (on y descend par la trappe de la galerie).
// Données partagées par le générateur de relief (Node) et le jeu : fichier sans import et sans syntaxe TypeScript
// non effaçable. Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// L'axe de la tour du phare est à l'origine ; la mer est au sud (+Z), niveau moyen 0.

export const TERRAIN_SIZE = 6144; // côté de la carte en mètres
export const TERRAIN_RES = 1024; // résolution de la carte de hauteur (maille de 6 m)
/** Niveau moyen de la mer. */
export const SEA_LEVEL = 0;

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

// Soleil : milieu d'après-midi, à l'ouest-sud-ouest, dans le dos droit du tireur qui regarde la crique.
export const SUN_BEARING = 258;
export const SUN_ELEVATION = 36;

// ---------------------------------------------------------------------------------------------
// Le phare (banque de bâtiments). Repère local du modèle : +x est, +z sud (la mer), y = 0 sur le plateau.
// Mesuré dans le modèle : axe de la tour en (−10, −6) ; dessus du plancher de la galerie à 25,8 m ; soubassement de
// la lanterne de 2,12 m de rayon ; garde-corps de 1,05 m à 3,62 m de l'axe ; bord du plancher à 3,8 m ; mer du modèle
// à −9 m. Le modèle fournit la lande jusqu'à 100 m, la falaise et une nappe de mer plate (200 × 85 m).
// ---------------------------------------------------------------------------------------------
/**
 * Sol du phare. La mer du modèle (plateau − 9 m) tombe 55 cm SOUS le niveau moyen de la carte : la nappe animée
 * (creux de 42 cm au plus) la recouvre toujours, sans couture ni scintillement.
 */
export const PHARE = { x: 10, z: 6, groundY: 8.45 };
/** Emprise du décor du modèle dans le monde (lande, falaise, mer) : le relief du jeu passe dessous. */
export const PHARE_GROUND = { x0: -90, x1: 110, z0: -104, z1: 66, cliffZ: 17.5 };
/** Galerie de la lanterne : altitude du plancher (sol du site de tir), rayons utiles. */
export const GALLERY = { y: PHARE.groundY + 25.8 + 0.03, rIn: 2.12, rRail: 3.62, rFloor: 3.8, lanternH: 3.5 };
export const BASE_Y = GALLERY.y;
/** Rayon de marche sur la galerie (milieu du passage). */
export const RING_R = 2.92;
/** Point de la galerie dans l'azimut `bearing`, à `r` mètres de l'axe. */
export const ring = (bearing: number, r = RING_R): P2 => polar(bearing, r);

// ---------------------------------------------------------------------------------------------
// La digue des marais (banque : un tronçon de la halte « digue des Roselières »), au fond de la crique. Tournée d'un
// quart de tour : sa crête court du nord au sud et débouche sur le rivage, prolongée par un musoir de pierre (décor
// de la carte) où se trouve le poste bas.
// ---------------------------------------------------------------------------------------------
export const DIGUE = { x: 330, z: -198, yaw: Math.PI / 2, groundY: 2.0 };
/** Dessus de la crête et du musoir (le bâtiment est posé 7 cm au-dessus de son terrassement). */
export const DIGUE_TOP = DIGUE.groundY + 0.07;
/** Musoir : axe (x), demi-largeur, du bord du lot (z0) à sa tête (z1) ; la zone praticable remonte jusqu'à la barrière. */
export const MOLE = { x: 330.6, half: 2.6, z0: -173, z1: -147, gateZ: -176.5 };
/** Trappe de la galerie et poteau de retour sur le musoir : y rester un instant fait passer d'un niveau à l'autre. */
export const HATCH = { ...ring(67.5, 2.58), r: 0.45, dwell: 0.6 };
export const RETURN = { x: MOLE.x, z: -168, r: 1.1, dwell: 0.8 };
/** Où l'on arrive : au pied du poteau côté mer sur le musoir ; sur la trappe en haut. */
export const ARRIVE_DIGUE = { x: MOLE.x, z: -163.5, yaw: Math.PI };
export const ARRIVE_GALLERY = { x: HATCH.x, z: HATCH.z, yaw: (110 * Math.PI) / 180 };

// ---------------------------------------------------------------------------------------------
// Postes de tir. Sur la galerie on tire accroupi, par-dessus la lisse basse du garde-corps (appui) ; sur le musoir
// aussi, appuyé au parapet.
// ---------------------------------------------------------------------------------------------
export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  est: { label: 'Galerie est', ...ring(100, 3.0), stance: 'crouch' },
  sud: { label: 'Galerie sud', ...ring(155, 3.0), stance: 'crouch' },
  digue: { label: 'Musoir', x: MOLE.x, z: MOLE.z1 - 2.4, ground: DIGUE_TOP, stance: 'crouch' },
};

/**
 * Repère de la barge : `f` pointe vers le musoir (son abri n'est ouvert que de ce côté : du phare, 37° plus à gauche,
 * la cloison cache les bidons), `s` à droite. Point de la barge → monde.
 */
const BF = (() => { const dx = POSTS.digue.x - 560, dz = POSTS.digue.z - 92, l = Math.hypot(dx, dz); return { fx: dx / l, fz: dz / l }; })();
export const bargeAt = (s: number, f: number): P2 => ({ x: 560 + BF.fx * f - BF.fz * s, z: 92 + BF.fz * f + BF.fx * s });
export const BARGE_AXIS = BF;

/** Altitude de l'œil d'un tireur à un poste (accroupi : 1 m). */
export function eyeOf(post: string): { x: number; y: number; z: number } {
  const P = POSTS[post];
  return { x: P.x, y: (P.ground ?? BASE_Y) + (P.y ?? 0) + (P.stance === 'crouch' ? 1.0 : 0.2), z: P.z };
}

// ---------------------------------------------------------------------------------------------
// Ce qu'on tire. Positions au sol (x, z) ; `y` : altitude du point visé (la mer est à 0).
// ---------------------------------------------------------------------------------------------
/** Îlot de la plaque de réglage (260 m au sud-sud-est) : un caillou qui dépasse de 1,6 m. */
export const ISLET = { ...polar(165, 258), top: 1.7 };
/** Bouées du chenal : rouge cylindrique à 380 m, verte conique à 450 m. */
export const BUOYS = [
  { id: 'bouee-rouge', label: 'Feu de la bouée rouge', ...polar(140, 380), color: 0xb3261e, shape: 'can' as 'can' | 'cone' },
  { id: 'bouee-verte', label: 'Feu de la bouée verte', ...polar(128, 450), color: 0x1f7a3d, shape: 'cone' as 'can' | 'cone' },
];
/** Port : quai (côté mer en z), grue à portique et son treuil. */
export const QUAY = { x0: 516, x1: 684, z: -150, top: 2.3 };
export const CRANE = { x: 562, z: -155.5, height: 15 };
/** Barge de ravitaillement sur ses pieux, entre le musoir et le port : abri ouvert vers le musoir seulement. */
export const BARGE = { x: 560, z: 92, deck: 1.25, drum: { s: -1.5, f: -1.6 } };
/** Caboteur au mouillage (22 m), l'étrave au sud-ouest, dans le vent (cap : rotation autour de y, x local vers l'avant). */
export const SHIP = { ...polar(109, 700), heading: -2.53, length: 22, beam: 5.6 };
/**
 * Route du canot : de la barge à la passe. Arrêt franc à chaque point (secondes) : moteur qui chauffe, bouées du
 * chenal, moteur qui cale. Au dernier point il est sorti de la crique.
 */
export const SKIFF = {
  speed: 5,
  route: [
    { x: BARGE.x - 9, z: BARGE.z + 9, wait: 12 },
    { x: 520, z: 215, wait: 8 },
    { x: 452, z: 330, wait: 8 },
    { x: 418, z: 470, wait: 8 },
    { x: 436, z: 640, wait: 8 },
    { x: 470, z: 800, wait: 7 },
    { x: 500, z: 930 },
  ] as { x: number; z: number; wait?: number }[],
};
/** Tourelle de la passe, à 1 200 m : maçonnerie noire et rouge sur une roche à fleur d'eau, lanterne au sommet. */
export const BEACON = { ...polar(171, 1200), height: 8.2 };

/** Rochers de l'îlot et de la roche de la passe (rendus par la végétation commune : `rubble`). */
export const ROCKS: { x: number; y: number; z: number; s: number }[] = [
  ...[0.3, 1.2, 2.0, 2.9, 3.7, 4.6, 5.5].map((a, i) => ({ x: ISLET.x + Math.cos(a) * (5.2 + (i % 3) * 1.3), y: 0, z: ISLET.z + Math.sin(a) * (5.2 + (i % 3) * 1.3), s: 1.5 + (i % 4) * 0.4 })),
  ...[0.5, 1.7, 2.8, 4.0, 5.2].map((a, i) => ({ x: BEACON.x + Math.cos(a) * (3.4 + (i % 2) * 1.4), y: 0, z: BEACON.z + Math.sin(a) * (3.4 + (i % 2) * 1.4), s: 1.4 + (i % 3) * 0.5 })),
];

// ---------------------------------------------------------------------------------------------
// Bâtiments de la banque. Lacet (rad) = group.rotation.y : à 0 la façade sud regarde +z.
//  - phare : le poste de tir (usure faible : le garde-corps de la galerie est entier) ;
//  - digue : un tronçon de la digue des Roselières (la station de pompage et le carrelet), second poste ;
//  - gare : la gare maritime, derrière le quai, façade vers la mer ;
//  - sanatorium : les pavillons du sanatorium marin, sur la lande à l'ouest du cap.
// ---------------------------------------------------------------------------------------------
export const BUILDINGS: { id: string; carte?: string; name: string; x: number; z: number; yaw: number; groundY: number; usure?: number; hide?: string[] }[] = [
  { id: 'phare', name: 'phare', x: PHARE.x, z: PHARE.z, yaw: 0, groundY: PHARE.groundY, usure: 0.35, hide: ['écume'] },
  { id: 'halte-digue', carte: 'carrelet', name: 'digue', x: DIGUE.x, z: DIGUE.z, yaw: DIGUE.yaw, groundY: DIGUE.groundY, usure: 0.5 },
  { id: 'gare', carte: 'voyageurs', name: 'gare', x: 604, z: -214, yaw: 0, groundY: 2.7, usure: 0.6 },
  { id: 'sanatorium-marin', carte: 'pavillons', name: 'sanatorium', x: -262, z: -196, yaw: 0.22, groundY: 13.5, usure: 0.6 },
];
/** Les bâtiments que le générateur terrasse (le phare a son emprise propre : PHARE_GROUND). */
export const FLATTENED = BUILDINGS.filter((b) => b.id !== 'phare');

// Route de la côte, d'ouest en est, 300 m en retrait du rivage (x, z).
export const ROAD: [number, number][] = [
  [-3072, -470], [-2200, -430], [-1400, -390], [-760, -350], [-262, -318], [8, -300], [330, -296], [640, -300], [900, -350], [1500, -430], [2300, -470], [3072, -500],
];
export const ROAD_WIDTH = 6;

/**
 * Voies secondaires : chaque bâtiment est relié à la route de la côte.
 *  - chemin du phare : il rejoint, au bord de la lande du modèle, la route d'arrivée du phare ;
 *  - chemin du sanatorium : jusqu'à la cour, au nord des pavillons ;
 *  - chemin de la digue : jusqu'au bout nord de la crête ;
 *  - rue du port : elle contourne la gare par l'ouest et finit sur son parvis, côté quai.
 */
export const WAYS: { name: string; kind: 'route' | 'chemin' | 'allee'; width: number; pts: [number, number][]; to?: string; maxSlope?: number }[] = [
  { name: 'chemin du phare', kind: 'chemin', width: 3, to: 'phare', pts: [[8, -300], [-14, -250], [14, -200], [-2, -150], [8.4, -104]] },
  { name: 'chemin du sanatorium', kind: 'chemin', width: 3.5, to: 'sanatorium', pts: [[-262, -318], [-268, -270], [-266, -232], [-265, -212]] },
  { name: 'chemin de la digue', kind: 'chemin', width: 3.5, to: 'digue', pts: [[330, -296], [332, -262], [331, -236], [330.4, -224]] },
  { name: 'rue du port', kind: 'route', width: 6, to: 'gare', pts: [[548, -298], [540, -252], [545, -204], [566, -188], [604, -190]] },
];

// ---------------------------------------------------------------------------------------------
// Sites aplanis du relief : { x, z, h, r0 (plat), r1 (raccord) }.
// ---------------------------------------------------------------------------------------------
export const SITES: Record<string, { x: number; z: number; h: number; r0: number; r1: number }> = {
  ilot: { x: ISLET.x, z: ISLET.z, h: ISLET.top, r0: 5, r1: 22 },
  roche: { x: BEACON.x, z: BEACON.z, h: 0.7, r0: 5, r1: 24 },
};

/**
 * Couloirs de visée garantis (altitudes absolues : tout est sur l'eau). Le générateur vérifie qu'aucun relief ne les
 * coupe ; les murs, le garde-corps et les modèles sont vérifiés en jeu (e2e/matrix.mjs).
 */
const abs = (post: string, p: P2, y: number): { post: string; x: number; z: number; y: number; abs: boolean } => ({ post, x: p.x, z: p.z, y, abs: true });
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean }[] = [
  abs('sud', ISLET, ISLET.top + 3.4),
  abs('sud', BUOYS[0], 3), abs('est', BUOYS[1], 3),
  abs('est', CRANE, 3.5),
  abs('est', SHIP, 5),
  abs('digue', BARGE, BARGE.deck + 0.5),
  ...SKIFF.route.map((p) => abs('est', p, 0.7)),
  ...SKIFF.route.slice(3).map((p) => abs('sud', p, 0.7)),
  abs('sud', BEACON, BEACON.height),
];

// ---------------------------------------------------------------------------------------------
// Le site : la galerie. Le départ, le râtelier (adossé au soubassement de la lanterne, côté terre) et la trappe sont
// sur sa moitié nord-est ; les deux postes regardent la mer.
// ---------------------------------------------------------------------------------------------
// (le départ est à plus de 3,6 m du râtelier : l'invite « Râtelier » n'apparaît que lorsqu'on s'en approche)
const START = ring(84, 2.95);
export const SITE = {
  start: { x: START.x, z: START.z, yaw: (128 * Math.PI) / 180 },
  /** centre du râtelier pour le jeu : les armes sont posées 1,03 m au sud, contre la lanterne */
  rack: { x: 0, z: -3.45 },
  /** demi-largeur du râtelier (six armes à 0,4 m) */
  rackHalf: 1.18,
};

/** Secteurs de tir à garder dégagés près du site : la mer. [azimut, demi-largeur]. */
export const CORRIDORS: [number, number][] = [[135, 85]];

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
export const RENDER = { cameraFar: 14000, shadowFar: 1500, haze: 0.8, treeRange: 1700 };
/** Air marin : brume légère et mince au ras de l'eau (les lignes de visée passent au-dessus), vent plein dès 40 m. */
export const ATMOSPHERE = { valleyY: 0, mistBase: 0.5, mistTop: 12, mist: 0.25 };
export const SKY = { clear: 0.45, cloudShadow: 0.7, warmth: 0.55 };
/** Lande rase : herbe un peu sèche, granit gris. */
export const PALETTE = {
  grass: [1.12, 1.06, 0.82] as [number, number, number],
  rock: [1.05, 1.02, 0.98] as [number, number, number],
  dryness: 0.12,
  mossAmount: 0.4,
  blades: { tint: [1.1, 1.02, 0.7] as [number, number, number], density: 0.6, height: 0.7, flowers: 0.6, chunk: 12 },
};
/** Armes du râtelier, dans l'ordre. */
export const WEAPON_IDS = ['223', '65cm', '308', '65prc', '300wm', '338lm'];
export const START_WEAPON = '65cm';
/** Physique d'origine : la difficulté vient du vent, de l'angle et de la distance. */
export const PHYSICS = { latitudeDeg: 48, altitudeM: 35, temperatureC: 16, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
/**
 * Vent de mer, du sud-ouest, en rafales marquées. Il forcit pour le canot et pour la tourelle de la passe.
 * Au ras de l'eau il reste 80 % du vent de la galerie.
 */
export const WIND = {
  fromBearing: 235, speed: 5.2, gusts: 1.3, shelter: 0.8, shelterHeight: 40,
  steps: { canot: { speed: 6 }, passe: { speed: 6.8, fromBearing: 228 } } as Record<string, { speed?: number; fromBearing?: number }>,
};
/** Houle : petite dans la crique abritée (les cibles flottantes ne bougent que de quelques centimètres). */
export const SWELL = [
  { toward: 28, length: 64, amp: 0.3 },
  { toward: 62, length: 47, amp: 0.12, phase: 1.3 },
];
/** Nappe de mer animée : rectangle (centre, dimensions) et maille. Au-delà, nappe plane jusqu'à l'horizon. */
export const SEA = { x: 380, z: 500, w: 1800, d: 1560, cell: 12 };
/** Portée du télémètre et de la visée (m) ; distance maximale des tables du carnet de tir (m). */
export const RANGE_LIMIT = 1800;
export const DOPE_LIMIT = 1300;
/** Plafond du bonus de la carte (objectifs sans balle perdue, canot arrêté tôt). */
export const BONUS_MAX = 3000;
export const BONUS = { clean: 200, skiff: 1600 };

/** Plan du tireur automatique (e2e/mission.mjs) : un poste, une arme et un grossissement par objectif. */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'reglage', post: 'sud', weapon: '65cm', targets: ['reglage'], zoom: 12 },
  { step: 'chenal', post: 'est', weapon: '65cm', targets: ['bouee-rouge', 'bouee-verte'], zoom: 18 },
  { step: 'treuil', post: 'est', weapon: '308', targets: ['treuil'], zoom: 20 },
  { step: 'caboteur', post: 'est', weapon: '300wm', targets: ['antenne', 'projecteur'], zoom: 25 },
  { step: 'barge', post: 'digue', weapon: '308', targets: ['drum'], zoom: 16 },
  { step: 'canot', post: 'est', weapon: '300wm', targets: ['canot'], zoom: 25 },
  { step: 'passe', post: 'sud', weapon: '338lm', targets: ['passe'], zoom: 25 },
];
/** Trajets de retour (e2e/walk.mjs) : par la galerie ; de la digue, on s'arrête au poteau de retour. */
export const TEST_WALK: Record<string, [number, number][]> = {
  est: [],
  sud: [[ring(128, 3.05).x, ring(128, 3.05).z], [ring(98, 3.05).x, ring(98, 3.05).z], [ring(70, 3.05).x, ring(70, 3.05).z]],
  digue: [[RETURN.x, RETURN.z + 0.3], [RETURN.x, RETURN.z - 0.3]],
};

/** Positions du scénario tactile (e2e/mobile.mjs) : pas de tutoriel, la cible proche est la plaque de réglage. */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  weapon: string; postKey: string; near: string;
} = {
  post: [POSTS.sud.x, POSTS.sud.z, (165 * Math.PI) / 180],
  rack: [0, -3.08, Math.PI],
  yard: [SITE.start.x, SITE.start.z, SITE.start.yaw],
  // mesure optique (disque posé à 500 m dans l'axe) : vers le canot à la barge (558 m), mise au point voisine et mer
  // unie derrière. Vers la tourelle (1 200 m) le disque est flou et mesuré trop petit ; vers le quai, le mirage au ras
  // du sol l'allonge de 3 px.
  far: { at: [POSTS.est.x, POSTS.est.z, 0, 'crouch', 0], target: 'canot' },
  crowd: { weapon: '300wm', at: [POSTS.est.x, POSTS.est.z, 0, 'crouch', 0], target: 'antenne' },
  weapon: '338lm', postKey: 'sud', near: 'reglage',
};
/** Vues de mesure de e2e/perf.mjs. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  depart: { at: [SITE.start.x, SITE.start.z, SITE.start.yaw, 'stand'] },
  crique: { at: [POSTS.est.x, POSTS.est.z, (105 * Math.PI) / 180, 'stand'], pitch: -0.12 },
  large: { at: [POSTS.sud.x, POSTS.sud.z, (165 * Math.PI) / 180, 'stand'], pitch: -0.06 },
  digue: { at: [POSTS.digue.x, POSTS.digue.z, (128 * Math.PI) / 180, 'stand'], pitch: -0.02 },
  'lunette-caboteur': { at: [POSTS.est.x, POSTS.est.z, 0, 'crouch', 0], scope: { weapon: '300wm', zoom: 25, target: 'antenne' } },
  'lunette-treuil': { at: [POSTS.est.x, POSTS.est.z, 0, 'crouch', 0], scope: { weapon: '308', zoom: 20, target: 'treuil' } },
  'lunette-passe': { at: [POSTS.sud.x, POSTS.sud.z, 0, 'crouch', 0], scope: { weapon: '338lm', zoom: 25, target: 'passe' } },
};

/**
 * Écho du tir : un cap au-dessus de la mer. Rien ne renvoie le son au sud ; au nord la lande monte doucement, à l'est
 * la pointe qui ferme la crique (850 m), au pied la falaise. Écho faible, queue courte.
 */
export const ECHO = {
  reliefs: [
    { distance: 850, bearing: 92, size: 0.3 },
    { distance: 620, bearing: 10, size: 0.2 },
    { distance: 760, bearing: 300, size: 0.2 },
  ],
  tail: 0.4,
};
