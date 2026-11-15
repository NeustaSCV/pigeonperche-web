// Niveau « avancé » : le Rebord. Assemble les données (map.ts), le site (site.ts), le décor (scenery.ts), les cibles
// (targets.ts) et la mission (mission.ts) en un module `level` que le jeu charge par le registre.
import type { Object3D, PerspectiveCamera } from 'three';
import type { Landmarks } from '../../audio/types';
import type { Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import * as M from './map';
import { meta } from './meta';
import { STEPS, STEP_POST } from './mission';
import { Plain } from './scenery';
import { buildSite, grassBlocked, nav } from './site';
import { buildTargets, type AvanceTargets } from './targets';

const data: LevelData = {
  id: 'avance',
  terrain: {
    dir: 'avance', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: null,
    pads: [], sculpt: M.SCULPT, clear: M.CLEAR,
  },
  render: M.RENDER,
  sun: { bearing: M.SUN_BEARING, elevation: M.SUN_ELEVATION },
  echo: M.ECHO,
  wind: M.WIND,
  atmosphere: M.ATMOSPHERE,
  sky: M.SKY,
  palette: M.PALETTE,
  weapons: M.WEAPON_IDS,
  startWeapon: M.START_WEAPON,
  difficulty: meta.difficulty,
  rangeLimit: M.RANGE_LIMIT,
  dopeLimit: M.DOPE_LIMIT,
  physics: M.PHYSICS,
  buildings: M.BUILDINGS,
  ways: M.WAYS,
  site: { baseY: M.RIM_HEIGHT, start: M.SITE.start, rack: M.SITE.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  alertZone: null,
  alertLabel: '',
  failNote: 'Reprenez l’objectif depuis le début.',
  tutorial: null,
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

class AvanceScene implements LevelScene {
  nav = nav;
  plain = new Plain();
  private t!: AvanceTargets;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    const site = await buildSite(h);
    return {
      group: site.masonry.group,
      vegetation: {
        baseY: M.RIM_HEIGHT, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES, corridors: M.CORRIDORS,
        nearTrees: M.NEAR_TREES, paved: M.SITE.paved, footprints: site.footprints, rubble: [], wallFeet: [],
        grassBlocked, lanes: M.LANES, laneSegs: M.LANE_SEGS, boulders: M.BOULDERS, deadwood: M.DEADWOOD,
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.plain.build(h);
    return this.plain.group;
  }

  buildTargets(h: LevelHost, _fx: Fx): Target[] {
    this.t = buildTargets(h);
    return this.t.list;
  }

  /** Panaches : indices de vent à lire à la lunette, à 1 200, 1 800 et 2 600 m. */
  addEmitters(fx: Fx): void {
    for (const s of this.plain.smokes) {
      if (s.kind === 'steam') fx.addEmitter(s.pos, 3.2, { speed: 1.2, up: 3.2, life: 11, size: [9, 46], color: 0xe9e7e2, alpha: 0.5, drag: 0.22, wind: 1 });
      else if (s.kind === 'furnace') fx.addEmitter(s.pos, 3, { speed: 0.6, up: 2.2, life: 9, size: [2.5, 20], color: 0x8a7f74, alpha: 0.5, drag: 0.25, wind: 1 });
      else fx.addEmitter(s.pos, 2.4, { speed: 0.4, up: 1.6, life: 10, size: [1.2, 14], color: 0xb9b4ac, alpha: 0.42, drag: 0.25, wind: 1 });
    }
  }

  /** Ni village, ni cloche, ni campement, ni lac : seulement le vent du plateau. */
  landmarks(): Landmarks {
    return { village: null, bell: null, camp: null, lake: null };
  }

  /** Quatre plans : le site vu du plateau, les dalles au ras du sol, l'aciérie au téléobjectif, le mirador. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const H = M.RIM_HEIGHT;
    let fov = 42;
    if (i === 0) { cam.position.set(-17 + u * 5, H + 8.5 - u * 1.2, 37 - u * 3); cam.lookAt(12, H - 5, -80); }
    else if (i === 1) { cam.position.set(-7 + u * 3, H + 0.6, -12 - u * 1.5); cam.lookAt(40, H - 14, -160); fov = 46; }
    else if (i === 2) { const f = M.BUILDINGS[2]; cam.position.set(40 - u * 12, H + 16, -60 - u * 8); cam.lookAt(f.x, f.groundY + 26, f.z); fov = 7; }
    else { cam.position.set(-16 + u * 4, H + 2.2, -4 + u * 2); cam.lookAt(30, H + 3.5, -40); fov = 48; }
    return fov;
  }

  /** La cible mobile se tire en mouvement comme à l'arrêt : le tireur automatique prend l'avance voulue. */
  testReady(_id: string, canSee: boolean): boolean {
    return canSee;
  }
}

export const level: Level = { data, createScene: () => new AvanceScene() };
