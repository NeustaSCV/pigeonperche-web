// Carte « ville » : la Ville nouvelle, 4,4 km de côté d'après des données ouvertes, vue depuis trente-neuf
// emplacements en hauteur. Carte du mode en ligne (`data.online`) : pas de site de tir à l'origine, pas de mission,
// pas de râtelier, pas de végétation commune ; le relief est le sien (terrain.ts). Rendu en aplats : sol, façades et
// eau gardent leurs shaders, sans ombre portée, sous l'atmosphère et le post-traitement du jeu.
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, type Object3D, type PerspectiveCamera } from 'three';
import type { Landmarks } from '../../audio/types';
import type { Target } from '../../game/targets';
import type { Crowd } from '../../player/character';
import type { Fx } from '../../world/fx';
import type { Level, LevelData, LevelHost, LevelScene, SiteNav, TestView } from '../types';
import { buildingChunks, buildingMeshes, chunkTriangles } from './buildings';
import { EYE, type VilleWorld } from './data';
import { buildLandmarks } from './landmarks';
import * as M from './map';
import { meta } from './meta';
import { buildPerches } from './perches';
import { SUN_BEARING, SUN_ELEVATION, lit } from './shade';
import { buildSilhouettes, type Silhouette } from './targets';
import { VilleTerrain } from './terrain';
import { buildTrees } from './trees';

const data: LevelData = {
  id: 'ville',
  // le relief vient de public/ville/ (terrain.ts) : ces cotes ne servent qu'à la cohérence du contrat
  terrain: { dir: 'ville', size: 4400, res: 551, waterLevel: null, pads: [], sculpt: [], clear: [] },
  render: M.RENDER,
  sun: { bearing: SUN_BEARING, elevation: SUN_ELEVATION },
  wind: M.WIND,
  sky: M.SKY,
  atmosphere: M.ATMOSPHERE,
  weapons: [M.WEAPON],
  startWeapon: M.WEAPON,
  difficulty: meta.difficulty,
  rangeLimit: M.RANGE_LIMIT,
  dopeLimit: M.DOPE_LIMIT,
  physics: M.PHYSICS,
  buildings: [],
  site: { baseY: M.BASE_Y, start: { x: 0, z: 0, yaw: 0 }, rack: null },
  posts: {},
  sightlines: [],
  // objectif factice, jamais lancé : une carte en ligne n'a pas de mission, mais le jeu en veut un
  steps: [{ id: 'manche', title: 'Ville nouvelle', targets: [], brief: '', intel: '', zone: '', posts: '', weapon: M.WEAPON }],
  stepPost: {},
  alertZone: null,
  alertLabel: '',
  failNote: '',
  tutorial: null,
  testPlan: [],
  preload: M.PRELOAD,
  online: M.ONLINE,
};

class VilleScene implements LevelScene {
  nav: SiteNav = { allowed: () => true, surfaceAt: () => 'wood' };
  private site = new Group();
  private world!: VilleWorld;
  private crowd: Crowd | null = null;
  private shooters: Silhouette[] = [];

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: null }> {
    const terrain = h.terrain as VilleTerrain, w = (this.world = terrain.world), e = h.engine;
    // vent régulier : ni rafales ni errance du cap et de la force
    h.wind.configure({ wander: 0, gusts: 0 });

    // bâtiments : maillages par pavé, et tous leurs triangles dans le BVH des balles et des lignes de visée
    const chunks = buildingChunks(w);
    this.site.add(buildingMeshes(w, chunks, terrain.tiles));
    h.col.addBuffer(chunkTriangles(chunks), 'stone');
    { // voûte du centre aquatique
      const pos = w.raw.dome.slice();
      for (let i = 0; i < pos.length; i += 3) pos[i + 1] += w.bendY(pos[i], pos[i + 2]);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      this.site.add(new Mesh(g, lit(e, { color: 0xdcdcd6, side: DoubleSide }, 'voute')));
      h.col.addBuffer(pos, 'metal');
    }
    this.site.add(buildTrees(e, w).group);
    this.site.add(buildLandmarks(e, w, terrain.water, terrain.extras).group);
    this.site.add(buildPerches(e, w));

    // plancher de chaque emplacement : c'est sur lui que `player.teleport` pose le tireur
    for (const emp of w.emp) {
      const eye = w.eyeOf(emp), y = eye.y - EYE;
      h.col.surfaces.push({ x0: eye.x - 0.6, x1: eye.x + 0.6, z0: eye.z - 0.6, z1: eye.z + 0.6, h: () => y, kind: 'wood' });
    }
    data.testViews = testViews(w);
    // tout est rendu ici, rien par `buildScenery` : le décor de celui-ci devient solide autour des cibles, et un
    // garde-corps ne doit arrêter aucune balle
    return { group: this.site, vegetation: null };
  }

  async buildScenery(): Promise<Object3D> {
    return new Group();
  }

  buildTargets(h: LevelHost, _fx: Fx): Target[] {
    const s = buildSilhouettes(h.engine, this.world);
    this.crowd = s.crowd;
    this.shooters = s.list;
    this.site.add(s.crowd.group);
    return s.list;
  }

  landmarks(): Landmarks {
    return { village: null, bell: null, camp: null, lake: null };
  }

  /** Quatre plans au-dessus du centre de la carte (la carte en ligne n'a pas de menu : ils ne servent qu'au chargement). */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const a = (i * Math.PI) / 2 + u * 0.3, r = 420;
    cam.position.set(Math.sin(a) * r, 330, -Math.cos(a) * r + 60);
    cam.lookAt(0, 175, 60);
    return 44;
  }

  /** Une silhouette qui se couche ou se relève : la foule instanciée est recalée. */
  frame(): void {
    let dirty = false;
    for (const s of this.shooters) if (s.dirty) { dirty = true; s.dirty = false; }
    if (dirty) this.crowd?.sync();
  }
}

/** Vues de mesure (e2e/perf.mjs) depuis l'emplacement de départ : à l'œil nu, puis lunette sur le tireur en vue le plus proche et le plus lointain. */
function testViews(w: VilleWorld): Record<string, TestView> {
  const i = w.emp.findIndex((e) => e.n === M.DEFAULT_POSTE), e = w.emp[i], eye = w.eyeOf(e);
  const at: TestView['at'] = [eye.x, eye.z, w.yawToCentre(e), 'stand', eye.y - EYE - M.BASE_Y];
  const seen = (w.raw.visibles[i] ?? []).map((n) => w.emp.find((q) => q.n === n)).filter((q): q is NonNullable<typeof q> => !!q)
    .sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z));
  const views: Record<string, TestView> = { oeil: { at, pitch: -0.06 } };
  if (seen.length) {
    views.lunette5 = { at, scope: { weapon: M.WEAPON, zoom: 5, target: 'emp' + seen[0].n } };
    views.lunette25 = { at, scope: { weapon: M.WEAPON, zoom: 25, target: 'emp' + seen[seen.length - 1].n } };
  }
  return views;
}

export const level: Level = {
  data,
  createScene: () => new VilleScene(),
  createTerrain: (spec, look) => new VilleTerrain(spec, look),
};
