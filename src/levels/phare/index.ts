// Niveau « Le Phare ». Assemble les données (map.ts), le site (site.ts), le décor (scenery.ts), les cibles (targets.ts)
// et la mission (mission.ts) en un module `level` que le jeu charge par le registre. Mécaniques propres à la carte
// (frame) : la houle, le passage de la galerie au musoir par la trappe, le compte à rebours du canot, les bonus.
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { Landmarks } from '../../audio/types';
import type { WeaponDef } from '../../config/weapons';
import type { Mission } from '../../game/mission';
import type { Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import type { LevelRuntime } from '../runtime';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import * as M from './map';
import { meta } from './meta';
import { STEPS, STEP_POST } from './mission';
import { Coast } from './scenery';
import { buildSite, nav, onGallery } from './site';
import { buildTargets, type PhareTargets } from './targets';

const data: LevelData = {
  id: 'phare',
  terrain: { dir: 'phare', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: M.SEA_LEVEL, pads: [], sculpt: [], clear: [] },
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
  site: { baseY: M.BASE_Y, start: M.SITE.start, rack: M.SITE.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  alertZone: null,
  alertLabel: '',
  failNote: 'Le canot repart de la barge : reprenez l’objectif.',
  bonusMax: M.BONUS_MAX,
  tutorial: null,
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

class PhareScene implements LevelScene {
  nav = nav;
  coast = new Coast();
  private t!: PhareTargets;
  private soft: { x: number; y: number; z: number; r: number }[] = [];
  private mission: Mission | null = null;
  // --- passage galerie ↔ musoir ---
  private dwell = 0;
  private armed = true;
  // --- canot ---
  private skiffPaid = false;
  // --- objectifs sans balle perdue ---
  private lastStep = '';
  private lastIndex = 0;
  private shots = 0;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    const site = await buildSite(h);
    this.soft = site.soft;
    return {
      group: site.group,
      vegetation: {
        baseY: M.BASE_Y, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES, corridors: M.CORRIDORS,
        // le site est une galerie à 26 m du sol : ni arbres, ni rochers, ni herbe semés autour (la lande est celle du phare)
        nearTrees: [], trees: { nearCount: 0, density: 0.7, broadleaf: 0.5 }, rocks: { count: 0 }, clumps: 0,
        paved: [], footprints: [], rubble: M.ROCKS, wallFeet: [], grassBlocked: () => true, lanes: [], laneSegs: [], boulders: [], deadwood: [],
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.coast.build(h);
    return this.coast.group;
  }

  buildTargets(h: LevelHost, _fx: Fx): Target[] {
    this.t = buildTargets(h, this.coast.swell);
    this.coast.group.add(this.t.carriers);
    return this.t.list;
  }

  /** Fumée du caboteur sous pression et d'une cheminée du port : le vent à lire à 700 m. */
  addEmitters(fx: Fx): void {
    const c = Math.cos(M.SHIP.heading), s = Math.sin(M.SHIP.heading), lx = -M.SHIP.length * 0.37;
    fx.addEmitter(new Vector3(M.SHIP.x + lx * c, 6.4, M.SHIP.z - lx * s), 1.4, { speed: 0.4, up: 1.4, life: 6, size: [0.5, 4.5], color: 0x8a8580, alpha: 0.32, drag: 0.25, wind: 1 });
  }

  /** Ni village, ni cloche, ni campement : le vent et la mer. */
  landmarks(): Landmarks {
    return { village: null, bell: null, camp: null, lake: null };
  }

  /** Quatre plans : le phare vu de la lande, la galerie, la crique au téléobjectif, le musoir. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const H = M.BASE_Y;
    let fov = 42;
    if (i === 0) { cam.position.set(-58 + u * 8, M.PHARE.groundY + 6 + u * 2, -46 + u * 4); cam.lookAt(6, M.PHARE.groundY + 17, 30); fov = 50; }
    else if (i === 1) { cam.position.set(-1.2 + u * 0.8, H + 1.7, 3.05); cam.lookAt(300, H - 22, 150); fov = 52; }
    else if (i === 2) { cam.position.set(-2.6 + u * 1.2, H + 1.6, -1.8); cam.lookAt(M.SHIP.x - u * 40, 4, M.SHIP.z); fov = 9; }
    else { cam.position.set(M.MOLE.x - 1 + u * 1.5, M.DIGUE_TOP + 1.7, M.MOLE.z1 - 9); cam.lookAt(M.BARGE.x, 6, M.BARGE.z); fov = 46; }
    return fov;
  }

  viewObstacles(): { x: number; y: number; z: number; r: number }[] {
    return this.soft;
  }

  onShot(_def: WeaponDef, stepId: string): void {
    if (stepId === this.lastStep) this.shots++;
  }

  frame(rt: LevelRuntime): void {
    this.coast.sea.setTime(rt.time);
    this.mission = rt.mission;
    const m = rt.mission, skiff = this.t.skiff;
    let banner: string | null = null;

    // --- objectif terminé sans balle perdue : bonus ---
    if (rt.stepId !== this.lastStep || m.index !== this.lastIndex) {
      if (this.lastStep && m.index > this.lastIndex) {
        const prev = STEPS.find((s) => s.id === this.lastStep);
        if (prev && this.shots > 0 && this.shots <= prev.targets.length) {
          const got = m.addBonus(M.BONUS.clean);
          if (got > 0) rt.toast('Sans une balle perdue', `Bonus + ${got}`, 2.4);
        }
      }
      this.lastStep = rt.stepId;
      this.lastIndex = m.index;
      this.shots = 0;
    }

    // --- le canot : il part quand son objectif commence ; s'il atteint la passe, l'objectif échoue ---
    if (rt.stepId === 'canot' && rt.playing) {
      const done = this.t.motor.done;
      if (!done) {
        skiff.start(rt.time);
        const left = skiff.timeLeft(rt.time);
        if (skiff.arrivedAt(rt.time)) rt.fail('Le canot a passé la pointe avec le chargement.');
        else {
          const w = skiff.waitLeft(rt.time);
          banner = (w > 0 ? `Canot <b>à l’arrêt</b> ${Math.ceil(w)} s` : 'Canot <b>en route</b>') + ` · passe <b>${clock(left)}</b>`;
        }
      } else if (!this.skiffPaid) {
        this.skiffPaid = true;
        const got = m.addBonus(M.BONUS.skiff * (skiff.timeLeft(rt.time) / skiff.duration));
        if (got > 0) rt.toast('Canot arrêté tôt', `Bonus + ${got}`, 2.6);
      }
    }

    // --- passage galerie ↔ musoir : rester un instant sur la trappe (ou sur le caillebotis du poteau), sans courir ---
    const pl = rt.player;
    if (rt.state === 'play' && pl) {
      const up = onGallery(pl.pos.y);
      const Z = up ? M.HATCH : M.RETURN;
      const inside = Math.hypot(pl.pos.x - Z.x, pl.pos.z - Z.z) < Z.r;
      if (!inside) { this.armed = true; this.dwell = 0; }
      else if (this.armed && !rt.inScope) {
        if (pl.speed < 2.6) this.dwell += rt.dt;
        if (banner === null) banner = up ? 'Trappe : <b>descente au musoir</b>…' : 'Poteau : <b>retour à la galerie</b>…';
        if (this.dwell >= Z.dwell) {
          this.dwell = 0;
          this.armed = false;
          rt.fade();
          const A = up ? M.ARRIVE_DIGUE : M.ARRIVE_GALLERY;
          pl.teleport(A.x, A.z, A.yaw, 'stand', 0);
          rt.toast(up ? 'Musoir de la digue' : 'Galerie du phare', up ? 'Par l’escalier de la tour et le chemin du rivage' : 'Par le chemin du rivage et l’escalier de la tour', 2.6);
        }
      }
    } else this.dwell = 0;

    rt.banner(banner);
  }

  /** Échec du canot : il revient à la barge, à l'arrêt ; il repartira à la reprise de l'objectif. */
  retry(): { remove: Target[]; add: Target[] } | null {
    this.t.skiff.reset();
    this.skiffPaid = false;
    this.shots = 0;
    if (this.mission) this.mission.alarm = false;
    return null;
  }

  /** Le canot se tire à l'arrêt, avec assez de marge pour viser et pour le vol de la balle. */
  testReady(id: string, canSee: boolean): boolean {
    if (id !== 'canot') return canSee;
    const s = this.t.skiff;
    return canSee && s.started && s.stoppedAt(s.time) && s.waitLeft(s.time) > 4.5;
  }
}

export const level: Level = { data, createScene: () => new PhareScene() };
