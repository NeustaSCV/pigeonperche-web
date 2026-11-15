// Niveau « facile » : le Guet. Assemble les données (map.ts), la cour (site.ts), le décor (scenery.ts), les cibles
// (targets.ts) et la mission (mission.ts) en un module `level` que le jeu charge par le registre.
import type { Object3D, PerspectiveCamera } from 'three';
import type { Landmarks } from '../../audio/types';
import type { Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import { lotOf } from '../building-lots';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import * as M from './map';
import { meta } from './meta';
import { STEPS, STEP_POST } from './mission';
import { Vale } from './scenery';
import { buildFarm, grassBlocked, nav } from './site';
import { buildTargets, type EasyTargets } from './targets';

/** disque qui couvre un lot : pas de relief de détail sous un bâtiment */
const lotPad = (b: { id: string; carte?: string; x: number; z: number }): { x: number; z: number; r0: number; r1: number } => {
  const l = lotOf(b.id, b.carte)!;
  const r = Math.hypot(l.l, l.p) / 2 + 6;
  return { x: b.x, z: b.z, r0: r / 0.6, r1: r / 0.6 + 26 };
};

const data: LevelData = {
  id: 'facile',
  terrain: {
    dir: 'facile', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: null,
    pads: [M.SITES.plate1, { x: 36, z: -42, r0: 34, r1: 48 }, M.SITES.plate2, M.SITES.balloon, M.SITES.quarry, M.SITES.track, ...M.BUILDINGS.map(lotPad)],
    sculpt: M.SCULPT, clear: M.CLEAR,
    // talus des cônes de vue (à moins de 110 m) en herbe, pas en roche
    slopeRockFrom: 110,
  },
  render: M.RENDER,
  sun: { bearing: M.SUN_BEARING, elevation: M.SUN_ELEVATION },
  echo: M.ECHO,
  wind: M.WIND,
  sky: M.SKY,
  weapons: M.WEAPON_IDS,
  startWeapon: '22lr',
  difficulty: meta.difficulty,
  rangeLimit: M.RANGE_LIMIT,
  dopeLimit: M.DOPE_LIMIT,
  physics: M.PHYSICS,
  buildings: M.BUILDINGS,
  ways: M.WAYS,
  site: { baseY: M.BASE_Y, start: M.FARM.start, rack: M.FARM.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  alertZone: null,
  alertLabel: '',
  failNote: 'Reprenez l’objectif depuis le début.',
  tutorial: {
    post: 'est', near: 'plate1', far: 'plate2', postPhrase: 'le pas de tir', postShort: 'pas de tir',
    nearHint: 'au nord-est, près du fanion rouge', rackHint: 'sous l’abri au sud de la cour',
  },
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

class EasyScene implements LevelScene {
  nav = nav;
  vale = new Vale();
  private t!: EasyTargets;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    const farm = await buildFarm(h);
    return {
      group: farm.group,
      vegetation: {
        baseY: M.BASE_Y, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES, corridors: M.CORRIDORS,
        nearTrees: M.NEAR_TREES, paved: M.FARM.paved, footprints: farm.footprints, rubble: farm.rubble, wallFeet: farm.wallFeet,
        grassBlocked, lanes: M.LANES, laneSegs: M.LANE_SEGS, boulders: M.BOULDERS, deadwood: M.DEADWOOD,
        rocks: M.ROCKS, trees: M.TREES,
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.vale.build(h.engine, h.terrain, h.col, h.wind);
    return this.vale.group;
  }

  buildTargets(h: LevelHost, _fx: Fx): Target[] {
    this.t = buildTargets(h.engine, this.vale.anchors, h.buildings, (x, z) => h.terrain.heightAt(x, z));
    return this.t.list;
  }

  addEmitters(fx: Fx): void {
    for (const c of this.vale.anchors.chimneys) fx.addEmitter(c, 2.4, { speed: 0.2, up: 0.9, life: 8, size: [0.4, 3.6], color: 0xc4c0b8, alpha: 0.3, drag: 0.25, wind: 1 });
  }

  /** La cloche du bourg sonne de loin en loin ; ni foule, ni campement, ni lac. */
  landmarks(): Landmarks {
    const b = this.t.bell.group.position;
    return { village: null, bell: [b.x, b.y, b.z], camp: null, lake: null };
  }

  /** Quatre plans : la cour et la vallée vues du sud, la plate-forme au ras de l'herbe, le bourg au téléobjectif, le pas de tir. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const H = M.BASE_Y;
    const E = M.LOTS.eglise;
    let fov = 42;
    if (i === 0) { cam.position.set(9 - u * 5, H + 6.5 - u * 1.2, 14 - u * 4); cam.lookAt(-40, H - 22, -230); }
    else if (i === 1) { cam.position.set(1.5 - u * 3, H + 0.6, 4 - u * 1.5); cam.lookAt(-14, H + 3.2, -10.5); }
    else if (i === 2) { cam.position.set(30 - u * 12, H + 9, -40 - u * 6); cam.lookAt(E.x - 12, 30, E.z + 10); fov = 15; }
    else { cam.position.set(8 + u * 3, H + 1.7, -13 + u * 1.2); cam.lookAt(90, H - 16, -110); fov = 48; }
    return fov;
  }

  /** La cible mobile se tire en mouvement : on attend qu'elle roule, en vue. */
  testReady(id: string, canSee: boolean): boolean {
    return id === 'runner' ? canSee && this.t.runner.speed > 0 : true;
  }
}

export const level: Level = { data, createScene: () => new EasyScene() };
