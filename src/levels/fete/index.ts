// Niveau « fete » : La Fête foraine. Assemble les données (map.ts), la terrasse du toit (site.ts), le décor
// (scenery.ts), les cibles (targets.ts) et la mission (mission.ts) en un module `level` que le jeu charge par le
// registre ; et joue les séries chronométrées (bandeau, bonus d'enchaînement et de rapidité).
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { AudioEngine } from '../../audio/engine';
import type { Landmarks } from '../../audio/types';
import { SeriesTracker } from '../../game/extra/fair';
import type { ImpactReport } from '../../game/shots';
import type { Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { VegetationSpec } from '../../world/vegetation';
import { lotOf } from '../building-lots';
import type { Level, LevelData, LevelHost, LevelScene } from '../types';
import type { LevelRuntime } from '../runtime';
import * as M from './map';
import { meta } from './meta';
import { SERIES, STEPS, STEP_POST } from './mission';
import { Seafront } from './scenery';
import { buildDeck, grassBlocked, nav } from './site';
import { buildTargets, type FairTargets } from './targets';

/** disque qui couvre un lot : pas de relief de détail sous un bâtiment */
const lotPad = (b: { id: string; carte?: string; x: number; z: number }): { x: number; z: number; r0: number; r1: number } => {
  const l = lotOf(b.id, b.carte)!;
  const r = Math.hypot(l.l, l.p) / 2 + 6;
  return { x: b.x, z: b.z, r0: r / 0.6, r1: r / 0.6 + 26 };
};

const data: LevelData = {
  id: 'fete',
  terrain: {
    dir: 'fete', size: M.TERRAIN_SIZE, res: M.TERRAIN_RES, waterLevel: M.WATER_LEVEL,
    // tout le front de mer est lisse : esplanade, plage, lots, emprise du Grand Hôtel
    pads: [{ x: 0, z: -200, r0: 800, r1: 900 }, ...M.BUILDINGS.map(lotPad)],
    sculpt: M.SCULPT, clear: M.CLEAR,
    slopeRockFrom: 430,
  },
  render: M.RENDER,
  sun: { bearing: M.SUN_BEARING, elevation: M.SUN_ELEVATION },
  echo: M.ECHO,
  wind: M.WIND,
  sky: M.SKY,
  atmosphere: M.ATMOSPHERE,
  palette: M.PALETTE,
  weapons: M.WEAPON_IDS,
  startWeapon: '22lr',
  difficulty: meta.difficulty,
  rangeLimit: M.RANGE_LIMIT,
  dopeLimit: M.DOPE_LIMIT,
  physics: M.PHYSICS,
  buildings: M.BUILDINGS,
  ways: M.WAYS,
  site: { baseY: M.BASE_Y, start: M.DECK.start, rack: M.DECK.rack },
  posts: M.POSTS,
  sightlines: M.SIGHTLINES,
  steps: STEPS,
  stepPost: STEP_POST,
  alertZone: null,
  alertLabel: '',
  failNote: 'Reprenez la série depuis le début.',
  bonusMax: M.BONUS_MAX,
  tutorial: {
    post: 'appui', near: 'plate1', far: 'plate2', postPhrase: 'le bord nord de la terrasse', postShort: 'bord nord',
    nearHint: 'au nord, en contrebas, au bord de l’esplanade, près du fanion rouge', rackHint: 'sous l’abri, au sud de la terrasse',
  },
  testPlan: M.TEST_PLAN,
  testWalk: M.TEST_WALK,
  testTouch: M.TEST_TOUCH,
  testViews: M.TEST_VIEWS,
};

class FairScene implements LevelScene {
  nav = nav;
  front = new Seafront();
  private t!: FairTargets;
  private fx: Fx | null = null;
  /** série de l'objectif en cours, et ce que les crochets d'impact lui laissent à traiter à l'image suivante */
  private series = new SeriesTracker();
  private seriesStep = '';
  private hits = 0;
  private shots = 0;
  private splash: Vector3[] = [];
  private time = 0;
  private host: LevelHost | null = null;

  async buildSite(h: LevelHost): Promise<{ group: Object3D; vegetation: VegetationSpec }> {
    this.host = h;
    const site = await buildDeck(h);
    return {
      group: site.group,
      vegetation: {
        baseY: M.BASE_Y, treeRange: M.RENDER.treeRange, posts: M.POSTS, sightlines: M.SIGHTLINES,
        // aucun bosquet semé d'office autour du site : c'est une ville
        corridors: [[0, 180]],
        nearTrees: [], paved: [[0, 0, 40]], footprints: site.footprints, rubble: site.rubble, wallFeet: site.wallFeet,
        grassBlocked, lanes: [], laneSegs: [], boulders: [], deadwood: [],
        rocks: M.ROCKS, trees: M.TREES, clumps: 0,
      },
    };
  }

  async buildScenery(h: LevelHost): Promise<Object3D> {
    await this.front.build(h.engine, h.terrain, h.col, h.wind);
    return this.front.group;
  }

  buildTargets(h: LevelHost, fx: Fx): Target[] {
    this.fx = fx;
    this.t = buildTargets(h.engine, this.front.anchors, this.front.wheel, this.front.carousel);
    return this.t.list;
  }

  /** Ni foule ni cloche d'église ni campement : le ressac, et la cloche du tape-fort quand on la touche. */
  landmarks(): Landmarks {
    return { village: null, bell: null, camp: null, lake: [M.SHORE_X - 6, M.SEA, -30] };
  }

  /** Quatre plans : la terrasse et le front de mer, la roue au téléobjectif, la plage au ras de la digue, le manège et la guirlande. */
  menuCamera(cam: PerspectiveCamera, i: number, u: number): number {
    const H = M.BASE_Y;
    let fov = 44;
    if (i === 0) { cam.position.set(7 - u * 3, H + 4.2 - u * 0.8, 16 - u * 3); cam.lookAt(-8, H - 9, -150); }
    else if (i === 1) { cam.position.set(-30 + u * 8, 9, -120 - u * 10); cam.lookAt(M.WHEEL.x, M.WHEEL.hub, M.WHEEL.z); fov = 32; }
    else if (i === 2) { cam.position.set(-31 - u * 2, 2.4, -40 - u * 14); cam.lookAt(-24, 4, -200); fov = 50; }
    else { cam.position.set(30 - u * 8, 7, -200 - u * 10); cam.lookAt(10, 4, -330); fov = 30; }
    return fov;
  }

  /** La manche à air de la terrasse n'est pas dans les collisions : le plan proche de la lunette ne doit pas la couper. */
  viewObstacles(): { x: number; y: number; z: number; r: number }[] {
    return [{ x: M.DECK.x0, y: M.BASE_Y + 3.2, z: M.DECK.z0, r: 1.6 }];
  }

  onShot(): void {
    this.shots++;
  }

  onImpact(r: ImpactReport, stepId: string, _audio: AudioEngine): string | null {
    // touche utile de l'objectif en cours : la série avance (traitée dans frame, où sont le temps, le score et les messages)
    if (r.result?.success && r.target && STEPS.find((s) => s.id === stepId)?.targets.includes(r.target.id)) this.hits++;
    // balle tombée à l'eau : la gerbe du socle naît 1,6 m sous la surface (WATER_LEVEL), on la redessine dessus
    if (r.kind === 'water') this.splash.push(new Vector3(r.point.x, M.SEA + 0.05, r.point.z));
    return null;
  }

  frame(rt: LevelRuntime): void {
    this.time = rt.time;
    this.front.setTime(rt.time);
    for (const p of this.splash) {
      this.fx?.puff(p, { count: 16, speed: 1.6, up: 3.2, spread: 0.5, life: 0.9, size: [0.08, 0.5], color: 0xe8f2f2, alpha: 0.8, gravity: 7, drag: 0.6, wind: 0.2 });
      this.fx?.puff(p, { count: 8, speed: 1.2, up: 0.4, life: 1.4, size: [0.2, 0.9], color: 0xd8ecec, alpha: 0.45, gravity: 0.5, drag: 1.5, wind: 0.3 });
    }
    this.splash.length = 0;
    // changement d'objectif : nouvelle série
    if (rt.stepId !== this.seriesStep) {
      this.seriesStep = rt.stepId;
      const rule = SERIES[rt.stepId];
      if (rule) this.series.begin(rule);
      this.hits = this.shots = 0;
    }
    if (!this.series.rule) return;
    if (this.shots > 0) { this.series.shot(rt.time); this.shots = 0; }
    for (; this.hits > 0; this.hits--) {
      const h = this.series.hit(rt.time);
      if (!h) break;
      const got = h.chain > 0 ? rt.mission.addBonus(h.chain) : 0;
      if (h.finished) {
        const speed = h.speed > 0 ? rt.mission.addBonus(h.speed) : 0;
        const sec = h.seconds.toFixed(1).replace('.', ',');
        const bonus = got + speed;
        rt.toast(h.total > 1 ? `Série complète en ${sec} s` : `Touché en ${sec} s`, bonus > 0 ? `+${bonus} points${speed > 0 ? ` dont ${speed} de rapidité` : ''}` : 'Pas de bonus cette fois : enchaînez plus vite', 3);
      } else if (got > 0) rt.toast(`Enchaînement ×${h.rank}`, `+${got} points · ${h.done}/${h.total}`, 1.6);
    }
    // en portrait, le HUD sort cette ligne du bloc de l'objectif (sous la boussole, ou en haut du champ en lunette)
    rt.banner(rt.playing || this.series.finished ? this.series.banner(rt.time) : null);
  }

  /** La roue se tire à l'arrêt, avec assez de temps devant soi pour viser et tirer. */
  testReady(id: string, canSee: boolean): boolean {
    if (id.startsWith('wheel')) return canSee && this.front.wheel.holding(this.time, 2.5);
    return true;
  }
}

export const level: Level = { data, createScene: () => new FairScene() };
