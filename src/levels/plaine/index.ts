// Niveau « Le Château d'eau » (plaine). Assemble les données (map.ts), le site (site.ts), le décor (scenery.ts), les
// cibles (targets.ts) et la mission (mission.ts), et porte les règles propres à la carte :
//  - l'alerte : chaque tir manqué la fait monter ; pleine, l'objectif en cours est manqué et se reprend ;
//  - le signal abattu, le convoi se range et s'immobilise, la citerne dans la trouée (elle se tire à l'arrêt) ;
//  - la lunette du théâtre : un seul tir, dans un délai affiché ;
//  - bonus : objectif réussi sans tir manqué, mission sans aucun tir manqué.
import type { Object3D, PerspectiveCamera } from 'three';
import type { AudioEngine } from '../../audio/engine';
import type { Landmarks } from '../../audio/types';
import type { WeaponDef } from '../../config/weapons';
import type { ImpactReport } from '../../game/shots';
import type { Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import type { LevelRuntime } from '../runtime';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import * as M from './map';
import { meta } from './meta';
import { STEPS, STEP_POST } from './mission';
import { PlainScenery } from './scenery';
import { buildSite, grassBlocked, nav } from './site';
import { buildTargets, type PlaineTargets } from './targets';

const data: LevelData = {
  id: 'plaine',
  terrain: {
    dir: 'plaine', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: null,
    pads: [], sculpt: M.SCULPT, clear: M.CLEAR, slopeRockFrom: 6000,
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
  site: { baseY: M.DECK_Y, start: M.SITE.start, rack: M.SITE.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  // La jauge est celle de la carte (tirs manqués) : la zone d'alerte du socle est repoussée hors de la carte, pour que
  // ses règles de campement (claquement supersonique, impacts proches) ne s'y ajoutent pas.
  alertZone: { x: 0, z: 40000 },
  alertLabel: 'Alerte de la plaine',
  alertTexts: {
    raised: 'L’alerte est donnée',
    raisedSub: 'Trop de tirs perdus : la plaine vous cherche',
    endRaised: 'L’alerte a été donnée.',
    endQuiet: 'Aucune alerte donnée',
  },
  alertDecay: M.ALERT.decay,
  bonusMax: M.BONUS_MAX,
  failNote: 'Reprenez l’objectif : l’alerte est retombée, mais pas tout à fait.',
  tutorial: null,
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

class PlaineScene implements LevelScene {
  nav = nav;
  scenery = new PlainScenery();
  private t!: PlaineTargets;
  private stepId = '';
  private index = 0;
  private ended = false;
  private banner: string | null = null;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    const site = await buildSite(h);
    return {
      group: site.masonry.group,
      vegetation: {
        baseY: M.DECK_Y, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES, corridors: [],
        nearTrees: [], trees: { nearCount: 0, density: 0.8, broadleaf: 0.9 }, rocks: { count: 0 }, clumps: 20,
        paved: [], footprints: [], rubble: [], wallFeet: [], grassBlocked, lanes: [], laneSegs: [], boulders: [], deadwood: [],
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.scenery.build(h);
    return this.scenery.group;
  }

  buildTargets(h: LevelHost, _fx: Fx): Target[] {
    this.t = buildTargets(h);
    return this.t.list;
  }

  /** Panaches : indices de vent à lire à la lunette, à l'usine (1 150 m), à la gare (2 400 m) et dans les champs. */
  addEmitters(fx: Fx): void {
    for (const s of this.scenery.smokes) {
      if (s.kind === 'steam') fx.addEmitter(s.pos, 3, { speed: 1, up: 2.6, life: 9, size: [3, 26], color: 0xe9e7e2, alpha: 0.5, drag: 0.25, wind: 1 });
      else if (s.kind === 'stack') fx.addEmitter(s.pos, 3, { speed: 0.6, up: 2.2, life: 10, size: [2, 20], color: 0x8a8580, alpha: 0.5, drag: 0.25, wind: 1 });
      else fx.addEmitter(s.pos, 2.4, { speed: 0.4, up: 1.6, life: 10, size: [1.2, 14], color: 0xb9b4ac, alpha: 0.42, drag: 0.25, wind: 1 });
    }
  }

  /** Ni village, ni cloche, ni sirène : le vent de la plaine. */
  landmarks(): Landmarks {
    return { village: null, bell: null, camp: null, lake: null };
  }

  /** Quatre plans : le château d'eau vu de la plaine, la plate-forme, le triage au téléobjectif, le bourg et la gare. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const Y = M.DECK_Y;
    let fov = 42;
    if (i === 0) { cam.position.set(-70 + u * 14, M.KNOLL + 9 + u * 3, 96 - u * 8); cam.lookAt(0, M.KNOLL + 21, 0); fov = 40; }
    else if (i === 1) { cam.position.set(5.5 - u * 1.5, Y + 2.0, 6.2 - u * 0.8); cam.lookAt(-40, Y - 6, -120); fov = 50; }
    else if (i === 2) { cam.position.set(6, Y + 1.7, -2 + u * 3); cam.lookAt(M.GAP.x, M.PLAIN + 5, M.GAP.z - 40 + u * 60); fov = 5; }
    else { cam.position.set(-3 + u * 3, Y + 1.7, -6); cam.lookAt(-300 + u * 200, M.PLAIN + 10, -1800); fov = 16; }
    return fov;
  }

  frame(rt: LevelRuntime): void {
    const m = rt.mission, t = this.t;
    if (!t) return;
    this.stepId = rt.stepId;
    // --- alerte : pleine, l'objectif en cours est manqué (il se reprend, alerte en partie retombée) ---
    if (t.stealth.frame(m) && rt.playing) rt.fail('L’alerte est donnée : trop de tirs perdus.');
    // --- bonus : objectif validé sans tir manqué ; mission sans aucun tir manqué ---
    if (m.index > this.index) {
      this.index = m.index;
      if (t.stealth.stepMisses === 0) m.addBonus(M.BONUS.clean);
      t.stealth.nextStep();
    }
    if (m.finished && !this.ended) {
      this.ended = true;
      if (t.stealth.misses === 0) m.addBonus(M.BONUS.flawless);
    }
    // --- signal abattu : le convoi se range, la citerne dans la trouée, et ne bouge plus ---
    if (t.signal.down && !t.train.held) t.train.halt(t.gapS);
    // --- lunette du théâtre : le délai court dès que l'objectif se joue ---
    let banner: string | null = null;
    if (rt.stepId === 'lunette' && !m.finished && !t.glint.done) {
      if (rt.playing) {
        if (t.glint.left === Infinity) t.glint.arm(M.ALERT.glint);
        if (t.glint.tick(rt.dt)) rt.fail('Délai écoulé : la lunette du théâtre vous a repéré.');
      }
      if (t.glint.left !== Infinity) banner = `Repéré dans <b>${clock(Math.max(0, t.glint.left))}</b> · un seul tir`;
    } else if (rt.stepId === 'wagon' && rt.playing && !t.train.done) {
      banner = t.train.stopped ? 'Convoi à l’arrêt · <b>citerne en vue</b>' : `Le convoi se range · arrêt dans <b>${Math.max(1, Math.round(t.train.remaining))} m</b>`;
    } else if (rt.stepId === 'signal' && rt.playing && t.signal.down && !t.train.stopped) {
      banner = 'Voie fermée : <b>le convoi se range</b>';
    }
    if (banner !== null || this.banner !== null) rt.banner(banner);
    this.banner = banner;
  }

  /** La détonation seule coûte peu, quel que soit le calibre (voir `Stealth`). */
  onShot(def: WeaponDef, _stepId: string): void {
    this.t.stealth.shot(def);
  }

  /** Tir manqué : l'alerte monte. Devant la lunette du théâtre, il n'y a qu'un tir. */
  onImpact(r: ImpactReport, stepId: string, _audio: AudioEngine): string | null {
    const missed = this.t.stealth.impact(r);
    if (missed && stepId === 'lunette' && !this.t.glint.done) return 'Tir manqué : la lunette du théâtre vous a localisé.';
    return null;
  }

  /** Reprise d'un objectif : l'alerte retombe à un niveau jouable, le délai de la lunette repart. */
  retry(_h: LevelHost, _fx: Fx): { remove: Target[]; add: Target[] } | null {
    this.t.stealth.retry();
    if (this.stepId === 'lunette' && !this.t.glint.done) this.t.glint.arm(M.ALERT.glint);
    return null;
  }

  /**
   * Essais. La lunette : balayage arrêté, éclat allumé. Le wagon : hors de son objectif (vue de mesure, capture), le
   * convoi est rangé d'office ; pendant la mission, c'est le signal abattu qui le range.
   */
  testPrepare(id: string): void {
    if (id === 'lunette') this.t.glint.frozen = true;
    if (id === 'wagon' && this.stepId !== 'wagon' && !this.t.train.held) this.t.train.halt(this.t.gapS);
  }
  /** La citerne ne se tire qu'à l'arrêt complet du convoi. */
  testReady(id: string, canSee: boolean): boolean {
    if (id === 'wagon') return this.t.train.stopped && canSee;
    return canSee;
  }
}

export const level: Level = { data, createScene: () => new PlaineScene() };
