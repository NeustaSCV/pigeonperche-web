// Adaptateur de la banque de bâtiments (« Watt Now? », src/buildings/bank) pour PIGEON PERCHÉ.
//
//   configureBuildings(engine);                              // une fois, après engine.initShadows()
//   const b = await loadBuilding('eglise', { usure: 0.7 });  // module chargé à la demande (un morceau Vite par bâtiment)
//   const placed = placeBuilding(b, { x, z, yaw, groundY }); scene.add(b.group);
//   const pad = flattenArea(placed, 8);                      // rectangle orienté à terrasser dans le relief
//   registerBuildingColliders(placed, colliders);            // AVANT colliders.build()
//   updateBuildingLod(b, camera.position, engine.zoomK());   // à chaque image (ou toutes les n images)
//   pointsOfInterest(b).points / .faces ; poiToWorld(placed, p) // où poser cibles et sentinelles
// Téléphone : configureBuildings(engine, { largeSize: 512 }) divise par quatre la mémoire des atlas d'enseignes.
//
// Repère de la banque : origine au centre du lot, sol à y = 0, +x est, +z sud, 1 unité = 1 m.
// Rendu : une matière opaque et une matière transparente partagées par tous les bâtiments, textures de la banque
// rangées dans deux tableaux de textures ; un bâtiment complet = 1 ou 2 appels (plus les ombres), lointain = 1.
import { Box3, Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import { BuildingMaterials, config, type BuildingConfig, type BuildingHost } from './materials';
import { collisionParts, convert, farGeometry, fullGeometry, type CollisionPart, type GroundMode } from './convert';
import { computePoi, type FichePoint, type OpeningRecord, type Poi, type PoiSet } from './poi';
import { CATALOG, type BuildingId, type CatalogEntry } from './catalog';
import { MANUAL_POI } from './poi-data';

export { CATALOG, SELECTION, type BuildingId, type CatalogEntry, type SelectionEntry } from './catalog';
export type { BuildingSurface, CollisionPart, GroundMode } from './convert';
/** réglages courants des matières (lecture : teinte du feuillage par défaut, à multiplier par la palette du niveau) */
export { config as buildingConfig } from './materials';
export type { FaceInfo, Poi, PoiKind, PoiSet } from './poi';
export type { BuildingConfig, BuildingHost } from './materials';

// ---------- modules de la banque : un morceau par bâtiment ----------

interface BankModule {
  FICHE: any;
  creer(o: { usure?: number; carte?: string }): Object3D;
}
const modules = import.meta.glob('./bank/*/modele.js') as Record<string, () => Promise<BankModule>>;
const atelier = import.meta.glob('./bank/commun/atelier.js') as Record<string, () => Promise<{ RELEVE: { ouvertures: OpeningRecord[] } }>>;

let materials: BuildingMaterials | null = null;

/**
 * À appeler une fois avec le moteur du jeu, après `engine.initShadows()` : les matières des bâtiments sont
 * enregistrées auprès des ombres en cascade. `options` : taille des tableaux de textures, gain des émissifs, teinte.
 */
export function configureBuildings(host: BuildingHost, options: Partial<BuildingConfig> = {}): void {
  Object.assign(config, options);
  materials = new BuildingMaterials(host);
}

// ---------- types ----------

export type BuildingLod = 'full' | 'far';
export interface LoadOptions {
  /** id d'une carte de la fiche (défaut : la première) ; '*' pour une halte entière (ses quatre tronçons) */
  carte?: string;
  /** de 0,1 (vieilli) à 1 (effondré) ; défaut 0,7 */
  usure?: number;
  /** 'auto' (défaut) : les deux niveaux, bascule par `updateBuildingLod` ; 'full' ou 'far' : un seul niveau construit */
  lod?: BuildingLod | 'auto';
  /** largeur minimale (m) des éléments gardés dans le niveau lointain ; défaut 0,3 */
  farMinFeature?: number;
  /**
   * Sol du lot. 'paved' : sans pelouse ni terre nue, le relief du jeu passe dessous (défaut des modèles posés à
   * plat) ; 'keep' : tout le sol du modèle (défaut des modèles qui creusent ou fournissent leur sol : `solPropre`) ;
   * 'none' : aucune dalle au sol (ni route, ni cour).
   */
  ground?: GroundMode;
  /** objets nommés de la banque à montrer ou à cacher (états de niveau 2 : 'maree_haute', 'epave_apres'…) */
  show?: string[];
  hide?: string[];
}
export interface Obstacle {
  x1: number; z1: number; x2: number; z2: number;
  nature: string;
}
export interface Footprint {
  /** le lot de la fiche, centré sur l'origine : demi-largeur (x) et demi-profondeur (z) */
  lot: { hx: number; hz: number };
  /** boîte de tout ce qui est construit (peut dépasser le lot : débords, décor prolongé) */
  built: { cx: number; cz: number; hx: number; hz: number };
  /** le modèle descend sous y = 0 (bassin, falaise, quai) : profondeur maximale en mètres, 0 sinon */
  dug: number;
  /** la fiche déclare `solPropre` : le modèle fournit son sol, trous compris */
  ownGround: boolean;
}
export interface LodStats {
  triangles: number;
  /** maillages dessinés dans la passe principale (les ombres en cascade ajoutent un appel par cascade touchée) */
  drawCalls: number;
}
export interface Building {
  id: BuildingId;
  carte: string;
  usure: number;
  /** à ajouter à la scène ; position et lacet posés par `placeBuilding` */
  group: Group;
  /** boîte englobante locale */
  bounds: Box3;
  footprint: Footprint;
  /** segments infranchissables de la banque (murs à hauteur d'homme), repère local */
  obstacles: Obstacle[];
  /** maillages de collision balistique par nature de surface, repère local */
  collision: CollisionPart[];
  /** la fiche de la banque (récit, cartes, entrées, points de fouille…) et la carte retenue */
  fiche: any;
  ficheCarte: any;
  /** niveau affiché et chiffres correspondants */
  lod: BuildingLod;
  stats: LodStats;
  statsByLod: Partial<Record<BuildingLod, LodStats>>;
  /** maillages du bâtiment d'origine, avant fusion (pour comparaison) */
  source: { meshes: number; skipped: number };
  /** temps passés au chargement (ms) : import du module, construction par la banque, conversion par l'adaptateur */
  timings: { importMs: number; createMs: number; convertMs: number };
  /** ouvertures relevées pendant la construction (brut) ; préférer `pointsOfInterest` */
  openings: OpeningRecord[];
  meshes: { full: Mesh | null; alpha: Mesh | null; far: Mesh | null };
}

// ---------- chargement ----------

function need(): BuildingMaterials {
  if (!materials) throw new Error("buildings : appeler configureBuildings(engine) avant loadBuilding()");
  return materials;
}

/** Charge et convertit un bâtiment de la banque. Coût : 0,1 à 0,6 s de calcul selon le bâtiment (à faire au chargement de la carte). */
export async function loadBuilding(id: BuildingId, o: LoadOptions = {}): Promise<Building> {
  const mats = need();
  const t0 = performance.now();
  const loader = modules[`./bank/${id}/modele.js`];
  if (!loader) throw new Error(`buildings : bâtiment inconnu « ${id} »`);
  const [mod, at] = await Promise.all([loader(), atelier['./bank/commun/atelier.js']()]);
  const t1 = performance.now();
  const fiche = mod.FICHE;
  const usure = o.usure ?? 0.7;
  const cartes: any[] = fiche.cartes ?? [];
  const whole = o.carte === '*' && cartes.length > 0;
  const ficheCarte = whole ? null : cartes.find((k) => k.id === o.carte) ?? cartes[0] ?? null;
  const carte = whole ? '*' : ficheCarte?.id ?? '';

  // --- construction par la banque, relevé des ouvertures ---
  const root = new Group();
  const obstacles: Obstacle[] = [];
  const openings: OpeningRecord[] = [];
  const fichePoints: FichePoint[] = [];
  const parts: { def: any; dx: number; dz: number }[] = whole
    ? cartes.map((k) => ({ def: k, dx: k.decalage?.x ?? 0, dz: k.decalage?.z ?? 0 }))
    : [{ def: ficheCarte, dx: 0, dz: 0 }];
  for (const p of parts) {
    at.RELEVE.ouvertures.length = 0;
    const obj = mod.creer({ usure, carte: p.def?.id });
    obj.position.set(p.dx, 0, p.dz);
    root.add(obj);
    for (const r of at.RELEVE.ouvertures) openings.push({ ...r, x: r.x + p.dx, z: r.z + p.dz });
    for (const s of (obj.userData.obstacles ?? []) as Obstacle[]) obstacles.push({ x1: s.x1 + p.dx, z1: s.z1 + p.dz, x2: s.x2 + p.dx, z2: s.z2 + p.dz, nature: s.nature });
    const src = p.def ?? fiche;
    for (const e of src.eteints ?? fiche.eteints ?? []) fichePoints.push({ x: e.x + p.dx, z: e.z + p.dz, note: String(e.type ?? e.nature ?? ''), kind: 'ground' });
    for (const e of src.entrees ?? fiche.entrees ?? []) fichePoints.push({ x: e.x + p.dx, z: e.z + p.dz, note: String(e.nature ?? ''), kind: 'door' });
  }
  at.RELEVE.ouvertures.length = 0;
  for (const name of o.show ?? []) root.traverse((n) => { if (n.name === name) n.visible = true; });
  for (const name of o.hide ?? []) root.traverse((n) => { if (n.name === name) n.visible = false; });

  // --- conversion ---
  const t2 = performance.now();
  const ownGround = !!(whole ? cartes.some((k) => k.solPropre) || fiche.solPropre : ficheCarte?.solPropre ?? fiche.solPropre);
  const conv = convert(root, mats, o.ground ?? (ownGround ? 'keep' : 'paved'));
  const want = o.lod ?? 'auto';
  const group = new Group();
  group.name = `building:${id}${carte ? ':' + carte : ''}`;
  const meshes: Building['meshes'] = { full: null, alpha: null, far: null };
  const statsByLod: Building['statsByLod'] = {};
  if (want !== 'far') {
    const go = fullGeometry(conv.opaque), ga = fullGeometry(conv.alpha);
    if (go) {
      meshes.full = new Mesh(go, mats.opaque);
      meshes.full.castShadow = meshes.full.receiveShadow = true;
      group.add(meshes.full);
    }
    if (ga) {
      meshes.alpha = new Mesh(ga, mats.alpha);
      meshes.alpha.receiveShadow = true;
      meshes.alpha.renderOrder = 2;
      group.add(meshes.alpha);
    }
    statsByLod.full = { triangles: conv.opaque.triangles + conv.alpha.triangles, drawCalls: (go ? 1 : 0) + (ga ? 1 : 0) };
  }
  if (want !== 'full') {
    const gf = farGeometry(conv, mats, { minFeature: o.farMinFeature ?? 0.3 });
    if (gf) {
      meshes.far = new Mesh(gf, mats.far);
      meshes.far.castShadow = meshes.far.receiveShadow = true;
      group.add(meshes.far);
    }
    statsByLod.far = { triangles: gf ? gf.getAttribute('position').count / 3 : 0, drawCalls: gf ? 1 : 0 };
  }
  const collision = collisionParts(conv);

  // --- emprise ---
  const bb = conv.bounds.isEmpty() ? new Box3(new Vector3(), new Vector3()) : conv.bounds;
  const lotSrc = whole ? null : ficheCarte?.lot ?? fiche.lot;
  const lot = lotSrc ? { hx: lotSrc.l / 2, hz: lotSrc.p / 2 } : { hx: (bb.max.x - bb.min.x) / 2, hz: (bb.max.z - bb.min.z) / 2 };
  const footprint: Footprint = {
    lot,
    built: { cx: (bb.min.x + bb.max.x) / 2, cz: (bb.min.z + bb.max.z) / 2, hx: (bb.max.x - bb.min.x) / 2, hz: (bb.max.z - bb.min.z) / 2 },
    dug: conv.groundMinY < -0.25 ? -conv.groundMinY : 0,
    ownGround,
  };

  // la source n'est plus utile : géométries rendues à la mémoire (les matières et textures de la banque sont en cache chez elle)
  root.traverse((n) => (n as Mesh).geometry?.dispose());

  const b: Building = {
    id, carte, usure, group, bounds: bb.clone(), footprint, obstacles, collision, fiche, ficheCarte,
    lod: 'full', stats: { triangles: 0, drawCalls: 0 }, statsByLod,
    source: { meshes: conv.sourceMeshes, skipped: conv.skipped }, openings, meshes,
    timings: { importMs: Math.round(t1 - t0), createMs: Math.round(t2 - t1), convertMs: Math.round(performance.now() - t2) },
  };
  fichePointsOf.set(b, fichePoints);
  setBuildingLod(b, want === 'far' ? 'far' : 'full');
  return b;
}

const fichePointsOf = new WeakMap<Building, FichePoint[]>();
const poiCache = new WeakMap<Building, PoiSet>();

/** Affiche un niveau de détail (sans effet si ce niveau n'a pas été construit). */
export function setBuildingLod(b: Building, lod: BuildingLod): void {
  const m = b.meshes;
  if (lod === 'far' && !m.far) lod = 'full';
  if (lod === 'full' && !m.full && m.far) lod = 'far';
  if (m.full) m.full.visible = lod === 'full';
  if (m.alpha) m.alpha.visible = lod === 'full';
  if (m.far) m.far.visible = lod === 'far';
  b.lod = lod;
  b.stats = b.statsByLod[lod] ?? { triangles: 0, drawCalls: 0 };
}

/**
 * Distance apparente (m) au-delà de laquelle on passe au niveau lointain. Distance apparente = distance réelle ×
 * zoomK (1 à l'œil nu, ≈ 1/grossissement en lunette) : à 800 m en lunette ×12, le bâtiment est « à 67 m » et reste
 * complet ; à l'œil nu il bascule dès 500 m. Le niveau lointain retire ce qui fait moins de 0,3 m de large, soit
 * moins d'un pixel au-delà de ~450 m sur un écran de 1440 px de haut à 55° de champ.
 */
export const LOD_SWITCH = 500;
const tmp = new Vector3();
/**
 * Choisit le niveau d'après la position de la caméra et le zoom (`engine.zoomK()`), avec 10 % d'hystérésis.
 * `bias` > 1 retarde le passage au lointain (écran très défini), < 1 l'avance (téléphone, qualité basse).
 */
export function updateBuildingLod(b: Building, cameraPosition: Vector3, zoomK = 1, bias = 1): BuildingLod {
  if (!b.meshes.far || !b.meshes.full) return b.lod;
  b.bounds.getCenter(tmp).applyMatrix4(b.group.matrixWorld);
  const half = Math.max(b.footprint.built.hx, b.footprint.built.hz);
  const apparent = Math.max(0, tmp.distanceTo(cameraPosition) - half) * zoomK;
  const limit = LOD_SWITCH * bias * (b.lod === 'far' ? 0.9 : 1.1);
  const next: BuildingLod = apparent > limit ? 'far' : 'full';
  if (next !== b.lod) setBuildingLod(b, next);
  return b.lod;
}

/** Une autre occurrence du même bâtiment (géométries partagées, à placer ailleurs). */
export function cloneBuilding(b: Building): Building {
  const group = new Group();
  group.name = b.group.name;
  const dup = (m: Mesh | null): Mesh | null => {
    if (!m) return null;
    const c = new Mesh(m.geometry, m.material);
    c.castShadow = m.castShadow;
    c.receiveShadow = m.receiveShadow;
    c.renderOrder = m.renderOrder;
    group.add(c);
    return c;
  };
  const c: Building = { ...b, group, meshes: { full: dup(b.meshes.full), alpha: dup(b.meshes.alpha), far: dup(b.meshes.far) } };
  fichePointsOf.set(c, fichePointsOf.get(b) ?? []);
  setBuildingLod(c, b.lod);
  return c;
}

/** Libère les géométries d'un bâtiment et de ses clones, qui les partagent (les matières et les textures, communes à tous, restent). */
export function disposeBuilding(b: Building): void {
  for (const m of [b.meshes.full, b.meshes.alpha, b.meshes.far]) m?.geometry.dispose();
  for (const p of b.collision) p.geometry.dispose();
  b.group.removeFromParent();
}

// ---------- placement, terrassement ----------

export interface Placement {
  /** position du centre du lot dans le monde */
  x: number; z: number;
  /** lacet en radians (= group.rotation.y) : à 0 la façade sud regarde +z ; positif = sens trigonométrique vu de dessus */
  yaw: number;
  /** altitude du sol du bâtiment (son y = 0) */
  groundY: number;
}
export interface PlacedBuilding extends Placement {
  building: Building;
  /** matrice locale → monde */
  matrix: Matrix4;
}

/** Pose le bâtiment dans le monde (position, lacet, altitude du sol) et met ses matrices à jour. */
export function placeBuilding(building: Building, p: Placement): PlacedBuilding {
  const g = building.group;
  g.position.set(p.x, p.groundY, p.z);
  g.rotation.set(0, p.yaw, 0);
  g.updateMatrixWorld(true);
  return { building, x: p.x, z: p.z, yaw: p.yaw, groundY: p.groundY, matrix: g.matrixWorld.clone() };
}

/** Lacet à donner pour qu'une face locale ('S' par défaut : la façade principale) regarde vers un cap du jeu (degrés, 0 = nord = −z, sens horaire). */
export function yawToFace(bearingDeg: number, side: 'N' | 'E' | 'S' | 'W' = 'S'): number {
  const local = { S: 180, W: 270, N: 0, E: 90 }[side];
  return ((local - bearingDeg) * Math.PI) / 180;
}

export interface FlatArea {
  /** centre, demi-dimensions le long des axes locaux du bâtiment, lacet, altitude à atteindre, marge de raccord (m) */
  cx: number; cz: number; hx: number; hz: number; yaw: number; y: number; margin: number;
  /** les quatre coins du rectangle (sans la marge), dans le monde */
  corners: [number, number][];
  /** 1 dans le rectangle, 0 au-delà de la marge, raccord adouci entre les deux */
  weight(x: number, z: number): number;
  /** hauteur terrassée : mélange la hauteur du relief `h` et l'altitude du bâtiment */
  apply(h: number, x: number, z: number): number;
}

/**
 * L'emprise à aplanir dans le relief sous un bâtiment posé : rectangle orienté + marge de raccord.
 * `area` : 'lot' (défaut, le lot de la fiche : tout ce qui est posé au sol y tient) ou 'built' (boîte du construit).
 * `sink` : enfonce le terrain de quelques centimètres sous le y = 0 du bâtiment pour éviter le scintillement avec
 * ses dalles (défaut 0,02 m). Pour un modèle creusé (`footprint.dug` > 0), passer `sink = dug + 0,3` : son propre sol couvre le lot.
 */
export function flattenArea(placed: PlacedBuilding, margin = 8, area: 'lot' | 'built' = 'lot', sink = 0.02): FlatArea {
  const f = placed.building.footprint;
  const lx = area === 'built' ? f.built.cx : 0, lz = area === 'built' ? f.built.cz : 0;
  const hx = area === 'built' ? f.built.hx : f.lot.hx, hz = area === 'built' ? f.built.hz : f.lot.hz;
  const c = Math.cos(placed.yaw), s = Math.sin(placed.yaw);
  const toWorld = (x: number, z: number): [number, number] => [placed.x + x * c + z * s, placed.z - x * s + z * c];
  const [cx, cz] = toWorld(lx, lz);
  const y = placed.groundY - sink;
  const weight = (x: number, z: number): number => {
    const dx = x - cx, dz = z - cz;
    const u = Math.abs(dx * c - dz * s) - hx, v = Math.abs(dx * s + dz * c) - hz;
    const d = Math.hypot(Math.max(u, 0), Math.max(v, 0));
    if (d <= 0) return 1;
    if (d >= margin) return 0;
    const t = 1 - d / margin;
    return t * t * (3 - 2 * t);
  };
  return {
    cx, cz, hx, hz, yaw: placed.yaw, y, margin,
    corners: [toWorld(lx - hx, lz - hz), toWorld(lx + hx, lz - hz), toWorld(lx + hx, lz + hz), toWorld(lx - hx, lz + hz)],
    weight,
    apply: (h, x, z) => { const w = weight(x, z); return h + (y - h) * w; },
  };
}

// ---------- collisions ----------

/** Ce que l'adaptateur attend des collisions du jeu (src/world/colliders.ts, classe Colliders). */
export interface ColliderSink {
  addGeometry(g: BufferGeometry, m: Matrix4 | null, tag: any): void;
  /** vitres laissées traversables : le jeu les fait se briser au passage de la balle */
  glass?: { add(g: BufferGeometry, m: Matrix4 | null): void };
  segs: { ax: number; az: number; bx: number; bz: number; r: number; y0: number; y1: number; box?: boolean }[];
}
export interface ColliderOptions {
  /** les vitres arrêtent-elles les balles ? défaut : non (elles ne sont pas enregistrées) ; sinon la nature à leur donner */
  glassAs?: 'stone' | 'metal' | null;
  /** enregistrer aussi les segments au sol pour les déplacements du joueur (défaut : non, inutile loin du tireur) */
  walkSegments?: boolean;
}

/**
 * Enregistre un bâtiment posé dans les collisions du jeu : triangles par nature (pierre, bois, métal, terre) pour
 * les balles et les lignes de visée, et, à la demande, segments au sol pour les déplacements.
 * À appeler AVANT `colliders.build()` (le BVH du jeu est construit une seule fois).
 */
export function registerBuildingColliders(placed: PlacedBuilding, col: ColliderSink, o: ColliderOptions = {}): number {
  let n = 0;
  for (const p of placed.building.collision) {
    const tag = p.tag === 'glass' ? o.glassAs ?? null : p.tag;
    if (!tag) { if (p.tag === 'glass') col.glass?.add(p.geometry, placed.matrix); continue; }
    col.addGeometry(p.geometry, placed.matrix, tag);
    n += p.triangles;
  }
  if (o.walkSegments) {
    const c = Math.cos(placed.yaw), s = Math.sin(placed.yaw);
    for (const ob of placed.building.obstacles)
      col.segs.push({
        ax: placed.x + ob.x1 * c + ob.z1 * s, az: placed.z - ob.x1 * s + ob.z1 * c,
        bx: placed.x + ob.x2 * c + ob.z2 * s, bz: placed.z - ob.x2 * s + ob.z2 * c,
        r: 0.16, y0: placed.groundY - 0.5, y1: placed.groundY + 2.2, box: true,
      });
  }
  return n;
}

// ---------- points d'intérêt ----------

/**
 * Points d'intérêt du tireur (repère local) : ouvertures donnant dehors, replats en hauteur, sommet, points au sol
 * de la fiche, relevés à la main de poi-data.ts, et lisibilité des quatre faces. Calculé à la première demande
 * (un BVH local, 50 à 300 ms) : à appeler à la construction de la carte, pas en jeu.
 */
export function pointsOfInterest(b: Building): PoiSet {
  let set = poiCache.get(b);
  if (!set) {
    set = computePoi(b.collision, b.openings, fichePointsOf.get(b) ?? []);
    const manual = MANUAL_POI[b.carte ? `${b.id}:${b.carte}` : b.id] ?? MANUAL_POI[b.id] ?? [];
    set.points.unshift(...manual);
    poiCache.set(b, set);
  }
  return set;
}

/** Un point d'intérêt dans le monde : position, pieds de la sentinelle, direction vers l'extérieur et cap du jeu. */
export function poiToWorld(placed: PlacedBuilding, p: Poi): { position: Vector3; stand: Vector3 | null; nx: number; nz: number; bearing: number } {
  const c = Math.cos(placed.yaw), s = Math.sin(placed.yaw);
  const nx = p.nx * c + p.nz * s, nz = -p.nx * s + p.nz * c;
  return {
    position: new Vector3(p.x, p.y, p.z).applyMatrix4(placed.matrix),
    stand: p.stand ? new Vector3(p.stand.x, p.stand.y, p.stand.z).applyMatrix4(placed.matrix) : null,
    nx, nz,
    bearing: nx || nz ? Math.atan2(nx, -nz) : 0,
  };
}

/**
 * Surface de marche (format de `Colliders.surfaces` du jeu) pour le plancher d'un point 'roof' ou 'gallery' : de quoi
 * poster le tireur sur un toit ou une galerie. Rectangle aligné sur les axes du monde, hauteur constante : exact si le
 * lacet du bâtiment est un multiple de 90°, englobant sinon. Le jeu doit encore y amener le joueur (pas d'escalier
 * praticable dans la banque : on ne visitait que le rez-de-chaussée).
 */
export function deckWalkSurface(placed: PlacedBuilding, p: Poi, kind: 'stone' | 'wood' = 'stone'): { x0: number; x1: number; z0: number; z1: number; h: (x: number, z: number) => number; kind: 'stone' | 'wood' } | null {
  if (!p.rect) return null;
  const c = Math.cos(placed.yaw), s = Math.sin(placed.yaw);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[p.rect.x0, p.rect.z0], [p.rect.x1, p.rect.z0], [p.rect.x1, p.rect.z1], [p.rect.x0, p.rect.z1]]) {
    const wx = placed.x + lx * c + lz * s, wz = placed.z - lx * s + lz * c;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  const y = placed.groundY + p.y;
  return { x0, x1, z0, z1, h: () => y, kind };
}

/** Liste des bâtiments disponibles (id, nom, cartes, halte ou non). */
export function listBuildings(): CatalogEntry[] {
  return CATALOG;
}
/**
 * Vide les tableaux de textures des bâtiments (mémoire graphique : 0,35 Mo par petite couche, 5,3 Mo par grande
 * couche de 1024 px, 1,3 Mo à 512 px). À appeler au changement de carte, après `disposeBuilding` de TOUS les
 * bâtiments : les géométries encore en vie pointeraient sur des couches vidées.
 */
export function resetBuildingTextures(): void {
  need().reset();
}
/** Nombre de couches de texture occupées (diagnostic). */
export function textureLayers(): { small: number; large: number } {
  return need().layers;
}
