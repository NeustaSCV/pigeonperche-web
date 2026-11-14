// Niveau « avancé » : le Rebord. Un éperon de haut plateau calcaire, à 900 m d'altitude, domine de 310 m une
// plaine industrielle et une vallée rectiligne d'ouest en est. Tirs de 800 à 2 500 m vers le nord, l'est et l'ouest.
// Données partagées par le générateur de relief (Node) et le jeu : fichier sans import et sans syntaxe TypeScript
// non effaçable. Repère : mètres, Y vers le haut, nord = −Z, est = +X. Azimut en degrés, 0 = nord, sens horaire.
// Le site de tir (poste d'observation bétonné) est à l'origine.

export const TERRAIN_SIZE = 10240; // côté de la carte en mètres
export const TERRAIN_RES = 1024; // résolution de la carte de hauteur (maille de 10 m : 4 Mo par fichier)
/** Altitude du plateau et du site de tir. Le repère du jeu est ici l'altitude réelle : la physique s'y réfère. */
export const RIM_HEIGHT = 900;
/** Altitude moyenne de la plaine. */
export const PLAIN = 590;

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

// Soleil : fin d'après-midi, bas sur le sud-sud-ouest, dans le dos du tireur qui regarde la plaine. Lumière rasante.
// (Essayé à l'ouest-sud-ouest : la plaque des 2 000 m, plein ouest, se noyait dans le halo du contre-jour.)
export const SUN_BEARING = 212;
export const SUN_ELEVATION = 15;

// ---------------------------------------------------------------------------------------------
// Postes de tir. `y` : plancher au-dessus du sol du site (plate-forme du mirador).
// ---------------------------------------------------------------------------------------------
export const MIRADOR = { x0: 4.5, x1: 11.5, z0: -21, z1: -13, floor: 4.2 };
/** Escalier de béton le long de la face ouest du mirador : du sol (z = −5.6) au palier (z = −13). */
export const STAIR = { x0: 2.9, x1: 4.2, zBottom: -5.6, zTop: -13, rise: 4.2, landingZ: -15.2 };

export const POSTS: Record<string, { label: string; x: number; z: number; y?: number; ground?: number; stance: 'prone' | 'crouch' }> = {
  nord: { label: 'Dalle nord', x: 0, z: -31, stance: 'prone' },
  est: { label: 'Dalle est', x: 30, z: -3, stance: 'prone' },
  ouest: { label: 'Dalle ouest', x: -30, z: -3, stance: 'prone' },
  mirador: { label: 'Plate-forme du mirador', x: 8, z: -20.8, y: MIRADOR.floor, stance: 'prone' },
};

/** Altitude de l'œil d'un tireur couché à un poste. */
export function eyeOf(post: string): { x: number; y: number; z: number } {
  const P = POSTS[post];
  return { x: P.x, y: (P.ground ?? RIM_HEIGHT) + (P.y ?? 0) + (P.stance === 'crouch' ? 1.0 : 0.2), z: P.z };
}

/**
 * Point visé à `slant` mètres (distance réelle, le long de la ligne de visée) du poste, dans l'azimut `bearing`,
 * à l'altitude `alt` : renvoie sa position au sol (x, z). C'est ainsi que le mile fait exactement 1 609 m.
 */
export function spot(post: string, bearing: number, slant: number, alt: number): P2 {
  const e = eyeOf(post);
  const dy = alt - e.y;
  const p = polar(bearing, Math.sqrt(slant * slant - dy * dy));
  return { x: e.x + p.x, z: e.z + p.z };
}

// ---------------------------------------------------------------------------------------------
// Cibles. Plaques d'acier aux dimensions des compétitions de tir à très longue distance : le King of 2 Miles
// tire sur des plaques de 24 × 36 pouces (61 × 91 cm) de 1 454 à 2 011 yards (source : Accurate Shooter,
// « Report from Raton: King of 2 Miles Match », réponse de l'organisateur, bulletin.accurateshooter.com/?p=58357).
// Soit 0,4 à 0,7 mrad de large. Au-delà, on garde cette largeur angulaire (≈ 0,55 mrad) : 1,22 m à 2 250 m,
// 1,52 m à 2 500 m (48 × 60 pouces).
// ---------------------------------------------------------------------------------------------
/** Hauteur du centre d'une plaque au-dessus de son sol : bord bas à 55 cm (portique d'acier). */
export const plateCentre = (h: number): number => 0.55 + h / 2;
/** Centre d'un gong accroché à un portique posé sur un plancher (toit, passerelle). */
export const gongCentre = (h: number): number => 0.4 + h / 2;

export interface TargetDef {
  id: string;
  label: string;
  post: string;
  /** azimut depuis le poste, distance réelle (m) */
  bearing: number;
  slant: number;
  /** largeur, hauteur (m) ; rond : diamètre = w */
  w: number;
  h: number;
  round?: boolean;
  /** altitude du sol (ou du plancher) sous la cible, hauteur du centre au-dessus */
  ground: number;
  centre: number;
}

/** Altitude des terrasses et des lots (le relief y est aplani). */
export const ALT = {
  zero: 652, chateau: 692, mover: 598, mine: 662, mile: 886, fourneau: 592, deuxMille: 732, siege: 590, extreme: 588,
};

/** Planchers des bâtiments de la banque utilisés comme supports (repère local du bâtiment : +x est, +z sud, y = 0 au sol). */
export const DECKS = {
  /** château d'eau : passerelle de la cuve, côté sud */
  chateau: { x: -6.5, y: 24, z: -2.5 },
  /** mine : plancher des molettes, en haut du chevalement */
  mine: { x: 3.5, y: 21.1, z: -14.5 },
  /** aciérie : plate-forme du gueulard */
  fourneau: { x: 3.5, y: 33, z: -4.5 },
  /** siège de la Compagnie : dalle de l'édicule, au-dessus du toit de la tour (le parapet du toit masque le toit lui-même) */
  siege: { x: 9.5, y: 36.25, z: -15 },
};

export const TARGETS: Record<string, TargetDef> = {
  zero: { id: 'zero', label: 'Plaque de réglage', post: 'nord', bearing: 352, slant: 800, w: 0.5, h: 0.5, ground: ALT.zero, centre: 1.12 },
  chateau: { id: 'chateau', label: 'Gong du château d’eau', post: 'est', bearing: 78, slant: 1000, w: 0.6, h: 0.6, round: true, ground: ALT.chateau + DECKS.chateau.y, centre: gongCentre(0.6) },
  mover: { id: 'mover', label: 'Cible mobile sur rail', post: 'nord', bearing: 318, slant: 1100, w: 0.75, h: 1.0, ground: ALT.mover, centre: 1.25 },
  mine: { id: 'mine', label: 'Gong du chevalement', post: 'ouest', bearing: 285, slant: 1250, w: 0.75, h: 0.75, round: true, ground: ALT.mine + DECKS.mine.y, centre: gongCentre(0.75) },
  mile: { id: 'mile', label: 'Plaque du mile', post: 'est', bearing: 90, slant: 1609.34, w: 0.91, h: 0.61, ground: ALT.mile, centre: plateCentre(0.61) },
  fourneau: { id: 'fourneau', label: 'Plaque du haut fourneau', post: 'mirador', bearing: 8, slant: 1800, w: 0.91, h: 0.91, ground: ALT.fourneau + DECKS.fourneau.y, centre: gongCentre(0.91) },
  deuxMille: { id: 'deuxMille', label: 'Plaque des 2 000 m', post: 'ouest', bearing: 270, slant: 2000, w: 1.22, h: 0.91, ground: ALT.deuxMille, centre: plateCentre(0.91) },
  siege: { id: 'siege', label: 'Plaque du siège', post: 'mirador', bearing: 335, slant: 2250, w: 1.22, h: 1.22, ground: ALT.siege + DECKS.siege.y, centre: gongCentre(1.22) },
  extreme: { id: 'extreme', label: 'Plaque des 2 500 m', post: 'mirador', bearing: 20, slant: 2500, w: 1.52, h: 1.22, ground: ALT.extreme, centre: plateCentre(1.22) },
};

/** Position au sol (x, z) du centre d'une cible. */
export function targetXZ(id: string): P2 {
  const t = TARGETS[id];
  return spot(t.post, t.bearing, t.slant, t.ground + t.centre);
}

/** Rail de la cible mobile : 36 m en travers de la ligne de visée, 1,2 m/s. */
export const MOVER = { length: 36, speed: 1.2, pause: 2.5 };

// ---------------------------------------------------------------------------------------------
// Bâtiments de la banque. Lacet (rad) = group.rotation.y : à 0 la façade sud regarde +z.
// Ceux qui portent une cible sont placés d'après elle : leur plancher (DECKS) tombe sous le point visé, et leur
// face sud regarde le tireur.
// ---------------------------------------------------------------------------------------------
function under(id: string, deck: { x: number; z: number }, yaw: number): P2 {
  const t = targetXZ(id);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: t.x - (deck.x * c + deck.z * s), z: t.z - (-deck.x * s + deck.z * c) };
}
const faceYaw = (bearing: number): number => (-bearing * Math.PI) / 180;

const CHATEAU = under('chateau', DECKS.chateau, faceYaw(78));
const MINE = under('mine', DECKS.mine, faceYaw(285));
const FOURNEAU = under('fourneau', DECKS.fourneau, faceYaw(8));
const SIEGE = under('siege', DECKS.siege, faceYaw(335));
const EXTREME = targetXZ('extreme');
/** La tour de refroidissement se dresse 150 m derrière la plaque des 2 500 m, un peu à droite. */
const CENTRALE = { x: EXTREME.x + 20, z: EXTREME.z - 150 };
/** La halte du passage à niveau, sur la route de la plaine. */
const HALTE = { x: -620, z: -1500 };

export const BUILDINGS: { id: string; carte?: string; name: string; x: number; z: number; yaw: number; groundY: number; usure?: number }[] = [
  { id: 'chateau-eau', name: 'chateau', x: CHATEAU.x, z: CHATEAU.z, yaw: faceYaw(78), groundY: ALT.chateau, usure: 0.5 },
  { id: 'mine', carte: 'batiments', name: 'mine', x: MINE.x, z: MINE.z, yaw: faceYaw(285), groundY: ALT.mine, usure: 0.6 },
  { id: 'acierie', carte: 'fourneau', name: 'fourneau', x: FOURNEAU.x, z: FOURNEAU.z, yaw: faceYaw(8), groundY: ALT.fourneau, usure: 0.6 },
  { id: 'siege-compagnie', carte: 'parvis', name: 'siege', x: SIEGE.x, z: SIEGE.z, yaw: faceYaw(335), groundY: ALT.siege, usure: 0.7 },
  { id: 'centrale-thermique', carte: 'tour', name: 'centrale', x: CENTRALE.x, z: CENTRALE.z, yaw: faceYaw(20), groundY: ALT.extreme, usure: 0.5 },
  { id: 'halte-passage-niveau', carte: '*', name: 'halte', x: HALTE.x, z: HALTE.z, yaw: 0, groundY: PLAIN + 2, usure: 0.6 },
];

// Route de la plaine, rectiligne d'ouest en est (x, z).
export const ROAD: [number, number][] = [
  [-5100, -1580], [-3600, -1540], [-2200, -1510], [-1200, -1500], [-620, -1500], [0, -1500], [1200, -1505], [2600, -1540], [3900, -1575], [5100, -1600],
];
export const ROAD_WIDTH = 7;

/**
 * La rivière de la plaine (x, z, niveau de l'eau) : elle coule d'ouest en est dans l'axe de la vallée, au nord de
 * tout ce qui se tire — 150 m derrière la tour de refroidissement, dont la station de pompage est sur sa rive sud.
 * Elle entre et sort de la carte par une cluse dans les collines. Pays sec : lit encaissé de 3 à 6 m, berges de galets.
 */
export const RIVER: [number, number, number][] = [
  [-5120, -2750, 582.8], [-4300, -2700, 582.7], [-3500, -2740, 582.6], [-2700, -2630, 582.5], [-2000, -2720, 582.4], [-1400, -2610, 582.3],
  [-800, -2700, 582.2], [-200, -2630, 582.1], [300, -2715, 582.05], [700, -2645, 582.0], [900, -2655, 581.95], [1150, -2700, 581.9],
  [1700, -2620, 581.8], [2400, -2720, 581.7], [3200, -2640, 581.6], [4100, -2740, 581.5], [5120, -2690, 581.4],
];
export const RIVER_WIDTH = 22;
/** Station de pompage de la centrale, sur la rive sud, et pied de la tour où arrivent ses deux conduites. */
export const INTAKE = { x: CENTRALE.x + 22, z: -2630, tx: CENTRALE.x + 14, tz: CENTRALE.z - 30 };

/**
 * Voies secondaires : chaque bâtiment est relié à la route de la plaine (la halte du passage à niveau est dessus).
 * Tracées dans le relief et la carte de matières par le générateur (lib.carveWays) ; `to` nomme le bâtiment desservi.
 *  - rue de la Compagnie : de la route, à l'ouest de la halte, au parvis du siège, dans l'axe de sa façade ;
 *  - route de l'aciérie : plein nord, jusqu'à la grande porte sud de la halle de coulée ;
 *  - route de la centrale : branchée sur celle de l'aciérie, elle traverse la zone des hangars, contourne par l'est
 *    la plaque des 2 500 m et arrive à la brèche est de la tour ;
 *  - route de la rive nord : la prolonge, passe la rivière sur un pont de béton et finit aux fermes de la rive nord ;
 *  - route de la mine : monte le talus en écharpe vers l'ouest, un lacet, et revient par la courbe de niveau jusqu'au
 *    carreau, derrière les bains-douches ;
 *  - chemin du château d'eau : chemin de terre, deux lacets dans le talus, arrive au portail (côté ouest).
 */
export const WAYS: {
  name: string; kind: 'route' | 'chemin' | 'allee'; width: number; pts: [number, number][]; to?: string; maxSlope?: number;
  bridges?: { x: number; z: number; deck: number; length: number; kind?: 'pierre' | 'bois' | 'beton'; width?: number }[];
}[] = [
  { name: 'rue de la Compagnie', kind: 'route', width: 6, to: 'siege', pts: [[-770, -1500.5], [-812, -1700], [-886, -1913], [-927.8, -2004]] },
  { name: 'route de l’aciérie', kind: 'route', width: 8, to: 'fourneau', pts: [[255, -1501], [253, -1620], [251, -1745]] },
  {
    name: 'route de la centrale', kind: 'route', width: 7, to: 'centrale',
    pts: [[253, -1620], [330, -1650], [470, -1760], [640, -1960], [820, -2160], [950, -2300], [985, -2400], [960, -2462], [897, -2483.5]],
  },
  {
    name: 'route de la rive nord', kind: 'route', width: 6,
    pts: [[985, -2400], [1012, -2520], [1016, -2620], [1012, -2676], [1010, -2740], [1020, -2820], [1000, -2930]],
    bridges: [{ x: 1012, z: -2676, deck: 585.6, length: 38, kind: 'beton', width: 8 }],
  },
  {
    name: 'route de la mine', kind: 'route', width: 6.5, to: 'mine',
    pts: [[-1200, -1500.2], [-1200, -1250], [-1195, -1000], [-1190, -760], [-1250, -625], [-1390, -540], [-1570, -445], [-1630, -420], [-1670, -438], [-1692, -418], [-1672, -382], [-1630, -362], [-1550, -360], [-1470, -362], [-1310, -358], [-1250, -335], [-1223, -319]],
  },
  {
    name: 'chemin du château d’eau', kind: 'chemin', width: 4, to: 'chateau',
    maxSlope: 0.13,
    pts: [[1000, -1503.5], [1000, -1250], [1000, -940], [1080, -780], [1180, -680], [1200, -620], [1160, -540], [940, -420], [880, -360], [800, -320], [700, -340], [660, -310], [680, -260], [720, -240], [760, -260], [840, -220], [920, -202], [966, -199]],
  },
];

/** Butte témoin à l'est : sommet plat à hauteur du plateau, c'est elle qui porte la plaque du mile. */
export const BUTTE = { ...targetXZ('mile'), top: ALT.mile };

// ---------------------------------------------------------------------------------------------
// Sites aplanis du relief : { x, z, h, r0 (plat), r1 (raccord) }.
// ---------------------------------------------------------------------------------------------
export const SITES: Record<string, { x: number; z: number; h: number; r0: number; r1: number }> = {
  rim: { x: 0, z: 0, h: RIM_HEIGHT, r0: 38, r1: 52 },
  zero: { ...targetXZ('zero'), h: ALT.zero, r0: 16, r1: 70 },
  chateau: { ...CHATEAU, h: ALT.chateau, r0: 50, r1: 150 },
  mover: { ...targetXZ('mover'), h: ALT.mover, r0: 36, r1: 110 },
  mine: { ...MINE, h: ALT.mine, r0: 52, r1: 160 },
  mile: { ...targetXZ('mile'), h: ALT.mile, r0: 34, r1: 80 },
  fourneau: { ...FOURNEAU, h: ALT.fourneau, r0: 70, r1: 150 },
  deuxMille: { ...targetXZ('deuxMille'), h: ALT.deuxMille, r0: 26, r1: 120 },
  siege: { ...SIEGE, h: ALT.siege, r0: 48, r1: 110 },
  extreme: { ...EXTREME, h: ALT.extreme, r0: 30, r1: 90 },
  centrale: { x: CENTRALE.x + 30, z: CENTRALE.z, h: ALT.extreme, r0: 110, r1: 190 },
  halte: { ...HALTE, h: PLAIN + 2, r0: 115, r1: 190 },
};

/**
 * Couloirs de visée garantis : le générateur rabote le relief sous chaque ligne poste → cible.
 * `y` : hauteur du point visé au-dessus du sol en place (plancher du bâtiment compris).
 */
const line = (id: string, deck = 0): { post: string; x: number; z: number; y: number } => {
  const t = TARGETS[id];
  return { post: t.post, ...targetXZ(id), y: deck + t.centre - 0.4 };
};
const MV = targetXZ('mover');
const MVD = polar(TARGETS.mover.bearing + 90, MOVER.length / 2);
export const SIGHTLINES: { post: string; x: number; z: number; y: number; abs?: boolean }[] = [
  line('zero'), line('chateau', DECKS.chateau.y), line('mover'), line('mine', DECKS.mine.y), line('mile'), line('fourneau', DECKS.fourneau.y),
  line('deuxMille'), line('siege', DECKS.siege.y), line('extreme'),
  { post: 'nord', x: MV.x + MVD.x, z: MV.z + MVD.z, y: 0.6 },
  { post: 'nord', x: MV.x - MVD.x, z: MV.z - MVD.z, y: 0.6 },
];

/**
 * Cônes de vue devant les dalles : le sol passe sous un plan incliné pour que le rebord ne masque pas la plaine.
 * (x, z) origine, y altitude de l'œil, b0→b1 secteur d'azimuts, slope = pente du plan.
 */
export const CLEAR: { x: number; z: number; y: number; b0: number; b1: number; slope: number; start: number }[] = [
  { x: POSTS.nord.x, z: POSTS.nord.z, y: RIM_HEIGHT + 0.1, b0: 296, b1: 390, slope: 0.5, start: 0.45 },
  { x: POSTS.est.x, z: POSTS.est.z, y: RIM_HEIGHT + 0.1, b0: 56, b1: 116, slope: 0.4, start: 0.45 },
  { x: POSTS.ouest.x, z: POSTS.ouest.z, y: RIM_HEIGHT + 0.1, b0: 246, b1: 304, slope: 0.4, start: 0.45 },
  // devant le mirador (œil à 4,5 m) : le bord du plateau passe sous les lignes des trois cibles lointaines
  { x: POSTS.mirador.x, z: POSTS.mirador.z, y: RIM_HEIGHT + 5.0, b0: 322, b1: 392, slope: 0.12, start: 0.45 },
];
export const SCULPT: { x: number; z: number; h: number; r0: number; r1: number }[] = [];

// ---------------------------------------------------------------------------------------------
// Le site : dalles de tir, mirador, station de pompage, abri du râtelier.
// ---------------------------------------------------------------------------------------------
export const SITE = {
  start: { x: 0, z: 17, yaw: 0 },
  rack: { x: 9, z: 25 },
  /** rayon du cœur du site (dalles, mirador, abri) autour de l'origine */
  radius: 37,
  /** rayon du terrain libre : jusqu'au rebord de la corniche au nord, à l'est et à l'ouest ; clôture au sud, sur l'isthme */
  roam: 64,
  /** station de pompage : local de béton (centre, demi-dimensions) */
  pump: { x: -15, z: 13, hx: 3.4, hz: 2.4, h: 3.1 },
  /** pylône du relais et manche à air */
  mast: { x: -11, z: -13 },
  /** aires bétonnées (x, z, rayon) : ni herbe ni rochers */
  paved: [[0, -29.4, 3.4], [28.4, -3, 3.4], [-28.4, -3, 3.4], [8, -17.5, 6.5], [3.5, -9.5, 3.2], [9, 24, 5.5], [-15, 13, 5.5], [0, 17, 3]] as [number, number, number][],
};

/** Secteurs de tir à garder dégagés près du site : tout sauf le plateau au sud. [azimut, demi-largeur]. */
export const CORRIDORS: [number, number][] = [[0, 62], [90, 50], [270, 50]];
/** Pins du plateau, derrière le site (sp : 0 conifère, 1 conifère clair). */
export const NEAR_TREES: { x: number; z: number; s: number; sp: number }[] = [
  { x: -26, z: 30, s: 1.1, sp: 0 }, { x: 24, z: 36, s: 1.25, sp: 1 }, { x: -7, z: 43, s: 0.95, sp: 0 }, { x: 15, z: 50, s: 1.3, sp: 0 }, { x: -34, z: 48, s: 1.15, sp: 1 },
];
/** Passages gardés libres de rochers (x, z, rayon). */
export const LANES: [number, number, number][] = [
  [POSTS.nord.x, POSTS.nord.z, 3.2], [POSTS.est.x, POSTS.est.z, 3.2], [POSTS.ouest.x, POSTS.ouest.z, 3.2],
  [(STAIR.x0 + STAIR.x1) / 2, STAIR.zBottom + 1.4, 2.6], [SITE.start.x, SITE.start.z, 2.6], [SITE.rack.x, SITE.rack.z - 2, 3],
];
/** Couloirs libres (ax, az, bx, bz, rayon) : du départ vers chaque dalle et vers l'escalier. */
export const LANE_SEGS: [number, number, number, number, number][] = [
  [0, 17, 0, -31, 1.8], [0, 6, 30, -3, 1.8], [0, 6, -30, -3, 1.8], [0, 17, 9, 23, 1.8], [0, 0, 3.55, -5, 1.8],
];
/** Gros blocs calcaires en bord de plateau : [azimut, distance, échelle]. */
export const BOULDERS: [number, number, number][] = [[32, 40, 1.6], [58, 43, 1.2], [128, 41, 1.5], [150, 44, 1.9], [212, 42, 1.4], [236, 41, 1.7], [302, 43, 1.3], [328, 41, 1.5]];
/** Bois mort : [x, z, rotation, échelle]. */
export const DEADWOOD: [number, number, number, number][] = [[-22, 22, 0.6, 2.2], [20, 12, 2.0, 1.8]];

// ---------------------------------------------------------------------------------------------
// Réglages du niveau lus par le moteur (voir src/levels/types.ts).
// ---------------------------------------------------------------------------------------------
/** Portée de rendu. L'air d'altitude est sec : brume réduite pour que la plaque des 2 500 m reste lisible. */
export const RENDER = { cameraFar: 16000, shadowFar: 3200, haze: 0.62, treeRange: 2900 };
/**
 * Atmosphère rapportée à la plaine (590 m) : le voile d'altitude et la brume basse partent du fond de plaine, où
 * traîne une nappe mince (2 à 60 m), légère pour que la plaque des 2 500 m reste lisible à ×25.
 */
export const ATMOSPHERE = { valleyY: PLAIN, mistBase: 2, mistTop: 60, mist: 0.55 };
/** Ciel : air sec, grande visibilité — la bande de nuages de la photographie est fondue aux deux tiers dans un ciel dégagé. */
export const SKY = { clear: 0.8, cloudShadow: 0.45 };
/**
 * Pays sec : herbe rase jaunie, calcaire clair, terre. Teintes multipliées aux matières du relief (RVB linéaire).
 */
export const PALETTE = {
  grass: [1.62, 1.3, 0.78] as [number, number, number],
  rock: [1.85, 1.78, 1.6] as [number, number, number],
  scree: [1.5, 1.44, 1.28] as [number, number, number],
  forest: [1.7, 1.42, 0.95] as [number, number, number],
  dirt: [1.3, 1.16, 0.95] as [number, number, number],
  dryness: 0.22,
  mossAmount: 0.1,
  // pavés de 12 m : herbe clairsemée, 2,25 fois moins d'appels de dessin (le plan d'accueil du menu dépassait le budget)
  blades: { tint: [1.7, 1.25, 0.6] as [number, number, number], density: 0.42, height: 0.55, flowers: 0.3, chunk: 12 },
  foliage: [1.0, 0.94, 0.78] as [number, number, number],
  understory: [1.3, 1.08, 0.7] as [number, number, number],
  rocks: [2.3, 2.2, 1.95] as [number, number, number],
};
/** Armes du râtelier, dans l'ordre : intermédiaires, .338 LM, puis les calibres de très longue distance. */
export const WEAPON_IDS = ['65prc', '7prc', '300prc', '300wm', '338lm', '338lm300', '33xc', '375ct', '408ct', '416b', '50bmg'];
export const START_WEAPON = '300prc';
/** Physique du tir : causse à 44° de latitude nord, 900 m d'altitude, fin d'après-midi d'été à 24 °C. Tout est actif. */
export const PHYSICS = { latitudeDeg: 44, altitudeM: RIM_HEIGHT, temperatureC: 24, coriolis: true, spinDrift: true, aeroJump: true, densityFromAltitude: true };
/**
 * Vent de la carte : d'ouest-nord-ouest, 4 m/s en moyenne sur le rebord, en rafales. La plaine, 310 m plus bas, est
 * abritée : il n'y reste que 62 % du vent du plateau (plein vent à hauteur du rebord).
 */
export const WIND = { fromBearing: 290, speed: 4, shelter: 0.62, shelterHeight: RIM_HEIGHT - PLAIN };
/** Portée du télémètre et de la visée (m) ; distance maximale des tables du carnet de tir (m). */
export const RANGE_LIMIT = 3200;
export const DOPE_LIMIT = 2600;
/** Plan du tireur automatique (e2e/mission.mjs) : un poste, une arme et un grossissement par objectif. */
export const TEST_PLAN: { step: string; post: string; weapon: string; targets: string[]; zoom: number }[] = [
  { step: 'zero', post: 'nord', weapon: '300prc', targets: ['zero'], zoom: 20 },
  { step: 'chateau', post: 'est', weapon: '300prc', targets: ['chateau'], zoom: 25 },
  { step: 'mover', post: 'nord', weapon: '338lm300', targets: ['mover'], zoom: 25 },
  { step: 'mine', post: 'ouest', weapon: '338lm300', targets: ['mine'], zoom: 25 },
  { step: 'mile', post: 'est', weapon: '33xc', targets: ['mile'], zoom: 25 },
  { step: 'fourneau', post: 'mirador', weapon: '375ct', targets: ['fourneau'], zoom: 25 },
  { step: 'deuxMille', post: 'ouest', weapon: '375ct', targets: ['deuxMille'], zoom: 25 },
  { step: 'siege', post: 'mirador', weapon: '416b', targets: ['siege'], zoom: 25 },
  { step: 'extreme', post: 'mirador', weapon: '50bmg', targets: ['extreme'], zoom: 25 },
];
/** Trajets de retour réalistes, du poste au point de départ (e2e/walk.mjs). */
export const TEST_WALK: Record<string, [number, number][]> = {
  nord: [[0, -20], [0, 0]],
  est: [[20, 0], [4, 8]],
  ouest: [[-20, 0], [-4, 8]],
  mirador: [[6, -14.1], [3.55, -14.1], [3.55, -12.4], [3.55, -4.2], [1, 4]],
};

/**
 * Positions du scénario tactile (e2e/mobile.mjs). Le niveau n'a pas de tutoriel : `post` est la dalle nord, face à
 * la plaque de réglage.
 */
export const TEST_TOUCH: {
  post: [number, number, number]; rack: [number, number, number]; yard: [number, number, number];
  far: { at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  crowd: { weapon: string; at: [number, number, number, 'prone' | 'crouch', number]; target: string };
  weapon: string; postKey: string; near: string;
} = {
  post: [POSTS.nord.x, POSTS.nord.z, (352 * Math.PI) / 180 - 2 * Math.PI],
  rack: [SITE.rack.x, SITE.rack.z - 1.8, Math.PI],
  yard: [0, 17, 0],
  // la mesure optique de e2e/mobile.mjs pose un disque à 500 m dans l'axe et veut un fond proche et uni derrière lui :
  // la plaque de réglage, sur le talus à 800 m (derrière la plaque du mile, le ciel voilait le disque à ×8)
  far: { at: [POSTS.nord.x, POSTS.nord.z, 0, 'prone', 0], target: 'zero' },
  crowd: { weapon: '375ct', at: [POSTS.mirador.x, POSTS.mirador.z, 0, 'prone', MIRADOR.floor], target: 'fourneau' },
  weapon: '338lm', postKey: 'nord', near: 'zero',
};
/** Vues de mesure de e2e/perf.mjs : départ, plaine à l'œil nu, lunette ×25 sur l'aciérie (1 800 m) et sur la plaque des 2 500 m. */
export const TEST_VIEWS: Record<string, { at: [number, number, number, 'stand' | 'crouch' | 'prone', number?]; pitch?: number; scope?: { weapon: string; zoom: number; target: string } }> = {
  depart: { at: [0, 17, 0, 'stand'] },
  plaine: { at: [0, -29, 0.1, 'stand'], pitch: -0.18 },
  'lunette-fourneau': { at: [POSTS.mirador.x, POSTS.mirador.z, 0, 'prone', MIRADOR.floor], scope: { weapon: '375ct', zoom: 25, target: 'fourneau' } },
  'lunette-extreme': { at: [POSTS.mirador.x, POSTS.mirador.z, 0, 'prone', MIRADOR.floor], scope: { weapon: '375ct', zoom: 25, target: 'extreme' } },
};
