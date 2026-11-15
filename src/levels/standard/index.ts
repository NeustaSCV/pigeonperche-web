// Niveau « standard » : la haute ruine. Assemble les données (map.ts), le site (site.ts), le décor (scenery.ts),
// les cibles (targets.ts) et la mission (mission.ts) en un module `level` que le jeu charge par le registre.
import type { Object3D, PerspectiveCamera } from 'three';
import type { AudioEngine } from '../../audio/engine';
import type { Landmarks } from '../../audio/types';
import type { ImpactReport } from '../../game/shots';
import { Market, type Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import * as M from './map';
import { meta } from './meta';
import { STEPS, STEP_POST } from './mission';
import { Valley } from './scenery';
import { buildRuin, grassBlocked, nav } from './site';
import { buildTargets, type StandardTargets } from './targets';

const data: LevelData = {
  id: 'standard',
  terrain: {
    dir: 'standard', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: M.LAKE_LEVEL,
    pads: [M.SITES.plate1, M.SITES.plate2, M.SITES.balloon], sculpt: M.SCULPT, clear: M.CLEAR,
  },
  render: M.RENDER,
  sun: { bearing: M.SUN_BEARING, elevation: M.SUN_ELEVATION },
  echo: M.ECHO,
  // vent d'origine du jeu, désormais déclaré (mêmes valeurs que le défaut du moteur)
  wind: { fromBearing: 255, speed: 3.5 },
  weapons: M.WEAPON_IDS,
  startWeapon: '22lr',
  difficulty: meta.difficulty,
  rangeLimit: M.RANGE_LIMIT,
  dopeLimit: M.DOPE_LIMIT,
  physics: M.PHYSICS,
  buildings: M.BUILDINGS,
  ways: M.WAYS,
  site: { baseY: M.SUMMIT_HEIGHT, start: M.RUIN.start, rack: M.RUIN.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  alertZone: { x: M.SITES.camp.x, z: M.SITES.camp.z },
  alertLabel: 'Campement',
  alertTexts: { raised: 'Le campement donne l’alerte', endRaised: 'Le campement a donné l’alerte.', endQuiet: 'Campement jamais alerté' },
  failNote: 'La place se vide. Reprenez l’objectif depuis le début.',
  tutorial: {
    post: 'est', near: 'plate1', far: 'plate2', postPhrase: 'la brèche est', postShort: 'brèche est',
    nearHint: 'à l’est, près du fanion rouge', rackHint: 'sous l’abri au sud de la cour',
  },
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

class StandardScene implements LevelScene {
  nav = nav;
  valley = new Valley();
  market!: Market;
  private t!: StandardTargets;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    const ruin = await buildRuin(h);
    return {
      group: ruin.group,
      vegetation: {
        baseY: M.SUMMIT_HEIGHT, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES, corridors: M.CORRIDORS,
        nearTrees: M.NEAR_TREES, paved: M.RUIN.paved, footprints: ruin.footprints, rubble: ruin.rubble, wallFeet: ruin.wallFeet,
        grassBlocked, lanes: M.LANES, laneSegs: M.LANE_SEGS, boulders: M.BOULDERS, deadwood: M.DEADWOOD,
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.valley.build(h.engine, h.terrain, h.col, h.wind);
    return this.valley.group;
  }

  buildTargets(h: LevelHost, fx: Fx): Target[] {
    this.t = buildTargets(h.engine, this.valley.anchors, h.terrain, fx);
    this.market = this.t.market;
    return this.t.list;
  }

  addEmitters(fx: Fx): void {
    const A = this.valley.anchors;
    for (const c of A.chimneys) fx.addEmitter(c, 3.2, { speed: 0.25, up: 1.1, life: 9, size: [0.4, 4.5], color: 0xb9b4ac, alpha: 0.42, drag: 0.25, wind: 1 });
    fx.addEmitter(A.campfire, 3, { speed: 0.25, up: 1.3, life: 8, size: [0.35, 4], color: 0x9a968e, alpha: 0.45, drag: 0.25, wind: 1 });
  }

  landmarks(): Landmarks {
    const A = this.valley.anchors;
    // rumeur du marché sur la place, cloche dans le clocher de l'église, sirène au campement
    return { village: [A.market.x, A.market.y + 3, A.market.z], bell: [A.church.x, A.church.y, A.church.z], camp: [A.camp.x, A.camp.y, A.camp.z], lake: M.LAKE_SOUND };
  }

  /** Quatre plans : la ruine vue du sud, la cour au ras du sol, le village au téléobjectif, la brèche est. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const H = M.SUMMIT_HEIGHT;
    let fov = 42;
    if (i === 0) { cam.position.set(-34 + u * 6, H + 9 - u * 1.5, 46 - u * 4); cam.lookAt(14, H + 1, -60); }
    else if (i === 1) { cam.position.set(-9 + u * 3, H + 0.55, 6 - u * 1.5); cam.lookAt(16, H + 4.2, -11); }
    else if (i === 2) { cam.position.set(60 - u * 14, H + 30, -120 - u * 10); cam.lookAt(M.SITES.village.x, 40, M.SITES.village.z); fov = 30; }
    else { cam.position.set(30 - u * 5, H + 2.2, -6 + u * 2); cam.lookAt(-60, H + 6, 20); fov = 48; }
    return fov;
  }

  audioFrame(audio: AudioEngine): number {
    const { vehicle, drone } = this.t;
    const vp = vehicle.position;
    audio.vehicle(vp.x, vp.y, vp.z, Math.min(1, vehicle.speed / 10));
    const dp = drone.position;
    audio.drone(dp.x, dp.y, dp.z, drone.done ? 0 : 1);
    return this.market.activity;
  }

  onImpact(r: ImpactReport, stepId: string, audio: AudioEngine): string | null {
    if (r.target === this.market) audio.crowdPanic(r.point.x, r.point.y, r.point.z);
    // un tir manqué sur la place disperse la foule : la cible s'enfuit
    const mk = this.valley.anchors.market;
    if (!r.target && stepId === 'hostile' && Math.hypot(r.point.x - mk.x, r.point.z - mk.z) < 26 && !this.market.panic && !this.market.done) {
      this.market.startPanic();
      audio.crowdPanic(mk.x, mk.y, mk.z);
      return 'La cible s’est fondue dans la foule en fuite.';
    }
    return null;
  }

  /** Après un échec : on repeuple le marché. */
  retry(h: LevelHost): { remove: Target[]; add: Target[] } {
    const old = this.market;
    this.market = this.t.market = new Market(h.engine, this.valley.anchors, h.terrain);
    return { remove: [old], add: [this.market] };
  }

  /** Sur la place, la cible attend d'ordinaire d'être dégagée des passants : pour le test on la fige à découvert. */
  testPrepare(id: string): void {
    const m = this.valley.anchors.market;
    if (id === 'hostile') this.market.freezeHostile(m.x + 2, m.z + 13.5);
  }
  /** Le véhicule n'est en vue que sur une partie de sa navette : on l'attend, en mouvement. */
  testReady(id: string, canSee: boolean): boolean {
    return id === 'vehicle' ? canSee && this.t.vehicle.speed > 5 : true;
  }
}

export const level: Level = { data, createScene: () => new StandardScene() };
