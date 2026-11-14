// Bâtiments du décor d'un niveau : POINT D'ACCROCHE UNIQUE entre les niveaux et l'adaptateur de src/buildings.
// Un niveau déclare `data.buildings: BuildingSpot[]` ; le jeu appelle placeBuildings() une fois, après le décor et
// AVANT la construction du BVH des collisions (les bâtiments arrêtent les balles et coupent les lignes de visée),
// donc avant les cibles : `h.buildings` est lisible dans buildTargets() pour y accrocher cibles et sentinelles.
//
// L'adaptateur (et la banque de modèles) n'est chargé que si le niveau déclare au moins un bâtiment : une carte
// sans bâtiment ne télécharge rien.
import { Group, Vector3 } from 'three';
import type { Building, PlacedBuilding } from '../buildings';
import { lotOf } from './building-lots';
import type { BuildingHandle, BuildingPoint, BuildingSpot, LevelBuildings, LevelHost } from './types';

/** Bâtiments posés d'un niveau : ce que le jeu en fait (groupe, niveau de détail, libération). */
export interface BuildingSet extends LevelBuildings {
  /** à ajouter à la scène */
  group: Group;
  /**
   * Bascule complet / lointain, à appeler à chaque image : le calcul n'est fait que toutes les `LOD_PERIOD` secondes,
   * ou dès que le grossissement change (entrée en lunette, molette).
   */
  update(cameraPosition: Vector3, zoomK: number, dt: number): void;
  /** Rend la mémoire (géométries, puis tableaux de textures) : changement de niveau, fermeture de la page. */
  dispose(): void;
  /** diagnostic : triangles et appels de dessin affichés, niveau de chaque bâtiment */
  stats(): { name: string; lod: string; triangles: number; drawCalls: number }[];
}

/** période de mise à jour du niveau de détail, s */
export const LOD_PERIOD = 0.25;
/** marge de soulèvement du bâtiment au-dessus du relief terrassé : évite le scintillement de ses dalles, vues de loin */
const lift = (dist: number): number => 0.03 + Math.min(0.12, dist / 9000);

let configured = false;

const EMPTY = (): BuildingSet => ({ group: Object.assign(new Group(), { name: 'buildings' }), list: [], get: () => undefined, update: () => {}, dispose: () => {}, stats: () => [] });

/**
 * Pose les bâtiments déclarés par le niveau : charge chaque modèle (une seule fois par modèle, les occurrences
 * suivantes partagent ses géométries), le pose sur le relief (altitude du terrassement, voir `lib.flattenBuildings`
 * de tools/terrain-lib.mjs), enregistre ses collisions dans `h.col`, et renseigne `h.buildings`.
 */
export async function placeBuildings(h: LevelHost, spots: BuildingSpot[]): Promise<BuildingSet> {
  if (!spots.length) return EMPTY();
  const B = await import('../buildings');
  if (!configured) {
    // téléphone : atlas d'enseignes à 512 px (quatre fois moins de mémoire graphique)
    // feuillage des modèles accordé à la végétation du niveau (palette.foliage)
    const fol = h.terrain.palette.foliage ?? [1, 1, 1];
    const base = B.buildingConfig.foliageTint;
    B.configureBuildings(h.engine, { ...(h.engine.touchMode ? { largeSize: 512 } : {}), foliageTint: [base[0] * fol[0], base[1] * fol[1], base[2] * fol[2]] });
    configured = true;
  }
  const group = new Group();
  group.name = 'buildings';
  const loaded = new Map<string, Building>();
  const all: { b: Building; placed: PlacedBuilding; handle: BuildingHandle }[] = [];
  const names = new Map<string, BuildingHandle>();
  const terraced = h.terrain.meta.buildings ?? [];

  for (const spot of spots) {
    if (!lotOf(spot.id, spot.carte)) throw new Error(`bâtiment inconnu « ${spot.id}${spot.carte ? ':' + spot.carte : ''} » (voir src/levels/building-lots.ts)`);
    const key = [spot.id, spot.carte ?? '', spot.usure ?? '', spot.ground ?? '', spot.lod ?? '', (spot.show ?? []).join('+'), (spot.hide ?? []).join('+')].join('|');
    let b = loaded.get(key);
    if (b) b = B.cloneBuilding(b);
    else {
      b = await B.loadBuilding(spot.id as any, { carte: spot.carte, usure: spot.usure, ground: spot.ground, lod: spot.lod, show: spot.show, hide: spot.hide });
      loaded.set(key, b);
    }
    // altitude : celle qu'impose le niveau, sinon celle du terrassement, sinon le relief en place
    const t = terraced.find((m) => m.id === spot.id && (m.carte ?? '') === (spot.carte ?? '') && Math.hypot(m.x - spot.x, m.z - spot.z) < 1);
    const ground = spot.groundY ?? t?.groundY ?? h.terrain.heightAt(spot.x, spot.z);
    if (spot.groundY === undefined && !t) console.warn(`[bâtiments] « ${spot.id} » n'est pas terrassé dans le relief (lib.flattenBuildings) : posé à l'altitude du relief en place`);
    const groundY = ground + lift(Math.hypot(spot.x, spot.z));
    const placed = B.placeBuilding(b, { x: spot.x, z: spot.z, yaw: spot.yaw, groundY });
    group.add(b.group);
    B.registerBuildingColliders(placed, h.col, { glassAs: spot.glassStops ? 'stone' : null, walkSegments: !!spot.walkable });

    let points: BuildingPoint[] | null = null;
    const bb = b;
    const handle: BuildingHandle = {
      spot, name: spot.name ?? spot.id, x: spot.x, z: spot.z, yaw: spot.yaw, groundY, height: b.bounds.max.y,
      points: (...kinds) => {
        points ??= B.pointsOfInterest(bb).points.map((p) => {
          const w = B.poiToWorld(placed, p);
          return { kind: p.kind, position: w.position, stand: w.stand, nx: w.nx, nz: w.nz, bearing: w.bearing, width: p.width, height: p.height, clear: p.clear, note: p.note, source: p.source };
        });
        return kinds.length ? points.filter((p) => kinds.includes(p.kind)) : points;
      },
      toWorld: (x, y, z) => new Vector3(x, y, z).applyMatrix4(placed.matrix),
    };
    all.push({ b, placed, handle });
    if (!names.has(handle.name)) names.set(handle.name, handle);
  }

  // qualité basse ou téléphone : le niveau lointain arrive un peu plus tôt
  const bias = h.engine.touchMode || h.engine.q.name === 'low' ? 0.8 : 1;
  let wait = 0, lastZoom = -1;
  const set: BuildingSet = {
    group,
    list: all.map((a) => a.handle),
    get: (name) => names.get(name),
    update(cam, zoomK, dt) {
      wait -= dt;
      // le grossissement change : on n'attend pas (un bâtiment simplifié en pleine lunette se verrait)
      if (wait > 0 && Math.abs(zoomK - lastZoom) < 0.02 * Math.max(zoomK, lastZoom)) return;
      wait = LOD_PERIOD;
      lastZoom = zoomK;
      for (const a of all) B.updateBuildingLod(a.b, cam, zoomK, bias);
    },
    dispose() {
      for (const a of all) B.disposeBuilding(a.b);
      all.length = 0;
      names.clear();
      set.list.length = 0;
      B.resetBuildingTextures();
    },
    stats: () => all.map((a) => ({ name: a.handle.name, lod: a.b.lod, triangles: a.b.stats.triangles, drawCalls: a.b.stats.drawCalls })),
  };
  h.buildings = set;
  return set;
}
