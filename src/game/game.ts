// Chef d'orchestre : chargement, états du jeu, boucle principale, tir, caméra de balle, liaison avec le son et l'interface.
import { BackSide, Box3, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3, type PerspectiveCamera } from 'three';
import { AudioEngine } from '../audio/engine';
import type { ImpactKind } from '../audio/types';
import type { BallisticEnv } from '../ballistics/environment';
import { firingSolution, solutionTable, splitElevation, type FiringSolution } from '../ballistics/firing-solution';
import { makeFlight } from '../ballistics/flight';
import { GAME_AIR, ballisticTable, loadDrag } from '../ballistics/solver';
import { CLICK_MIL, RETICLE_HOLD_MIL, SIGHT_HEIGHT, WEAPONS, weaponById, type WeaponDef } from '../config/weapons';
import { Engine, REF_FOV, REF_SCOPE_R, type QualityName, type View } from '../core/engine';
import { Input } from '../core/input';
import { report, showError } from '../core/diag';
import { Preloader, meteredConnection, preloadList } from '../core/preload';
import { showBackdrop } from '../ui/backdrop';
import { canFullscreen, goFullscreen, installGestureGuards, isTablet, isTouchDevice, lockPortrait, needsHomeScreenTip, safeInsets } from '../core/device';
import { loadTex, setTextureLimit } from '../core/assets';
import { damp } from '../core/noise';
import { Player } from '../player/player';
import { UI, type BookData, type HudState } from '../ui/hud';
import { TouchControls, type TouchFrame } from '../ui/touch';
import { Rifle, buildRifleModel, type RifleParts } from '../weapons/rifle';
import { handleRifle, shoulderMount } from '../weapons/handling';
import { Scope } from '../weapons/scope';
import { Colliders } from '../world/colliders';
import { Fx } from '../world/fx';
import { ShotFx, type GroundKind } from '../world/shotfx';
import { shotFxParams } from '../world/shotfx-params';
import { Sky } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Vegetation, type VegetationSpec } from '../world/vegetation';
import { Wind, type WindSample } from '../world/wind';
import { LEVELS, checkLevel, switchLevel } from '../levels';
import { lotOf } from '../levels/building-lots';
import { placeBuildings, type BuildingSet } from '../levels/buildings';
import type { Level, LevelData, LevelHost, LevelPhysics, LevelScene } from '../levels/types';
import { Mission, type Difficulty, type Step } from './mission';
import { ScoreService, type ScoreResult } from './scores';
import { AIM_WINDOW_MIL, CoachTracker, assessWeapon, buildAdvice, diagnose } from './coach';
import { Shots, type Bullet, type ImpactReport, type Prediction } from './shots';
import { Tutorial, type TutoSnap } from './tutorial';
import type { Target, TargetCtx } from './targets';

type State = 'menu' | 'brief' | 'play' | 'rack' | 'book' | 'pause' | 'fail' | 'end';
const fr = (n: number, d = 0): string => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const STANCE_LABEL = { stand: 'Debout', crouch: 'Accroupi', prone: 'Couché' };
/** le râtelier loge douze armes ; au-delà, c'est au niveau de choisir */
export const RACK_MAX = 12;
/** touches du râtelier, par position sur le clavier : la rangée des chiffres, de 1 à la touche à droite du 0 */
const RACK_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
/** plan proche d'origine de la vue lunette (m) : plancher du plan proche adaptatif */
const SCOPE_NEAR = 0.55;
/** vent traversier de référence du carnet de tir, m/s */
const BOOK_WIND = 5;

/**
 * Essais : `?phys=` remplace la physique du niveau. `full` active tout ; sinon une liste parmi `coriolis`, `spin`,
 * `jump`, `air` (densité selon l'altitude) ; `none` coupe tout. `?lat=`, `?alt=`, `?temp=` règlent latitude (°),
 * altitude (m) et température (°C). Sans `?phys`, la physique du niveau est rendue telle quelle.
 * Comme `?arsenal` et `?dope`, ces paramètres d'essai n'agissent qu'en mode test (`?test`) : une partie normale joue
 * toujours la carte telle qu'elle est écrite.
 */
function physicsFor(params: URLSearchParams, base: LevelPhysics): LevelPhysics {
  const v = params.has('test') ? params.get('phys') : null;
  if (v === null) return base;
  const on = v.split(',');
  const all = on.includes('full');
  const num = (k: string, d: number): number => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
  return {
    ...base,
    latitudeDeg: num('lat', base.latitudeDeg), altitudeM: num('alt', base.altitudeM), temperatureC: num('temp', base.temperatureC),
    coriolis: all || on.includes('coriolis'), spinDrift: all || on.includes('spin'), aeroJump: all || on.includes('jump'), densityFromAltitude: all || on.includes('air'),
  };
}

interface BulletCam {
  bullet: Bullet;
  pred: Prediction;
  phase: 'follow' | 'impact';
  hold: number;
  camPos: Vector3;
  look: Vector3;
}

export class Game {
  engine: Engine;
  wind = new Wind();
  terrain: Terrain;
  sky = new Sky();
  col = new Colliders();
  veg = new Vegetation();
  /** niveau joué : ses données, et sa scène (site de tir, décor, cibles, règles propres) */
  level: Level;
  data: LevelData;
  scene: LevelScene;
  /** armes du râtelier de ce niveau */
  weapons: WeaponDef[];
  /** physique du tir en vigueur : celle du niveau, ou celle de `?phys=` (essais) */
  physics: LevelPhysics;
  /** bâtiments posés (data.buildings) ; null tant qu'ils ne sont pas chargés */
  buildings: BuildingSet | null = null;
  private siteGroup = new Group();
  private sceneryGroup = new Group();
  fx!: Fx;
  /** effets visuels du coup de feu (flamme, poussière, recul, douille, voile de lunette) */
  shotFx!: ShotFx;
  audio = new AudioEngine();
  input: Input;
  ui: UI;
  player!: Player;
  scope = new Scope();
  rifle!: Rifle;
  shots!: Shots;
  mission!: Mission;
  /** classements : API du serveur si elle répond, navigateur sinon */
  scores = new ScoreService();
  /** résultat de la mission terminée, en attente d'inscription */
  private endResult: ScoreResult | null = null;
  /** conseil après plusieurs tirs manqués sur la même cible (voir coach.ts) */
  coach = new CoachTracker();
  private coachPref: string | null = null;
  /** dernière distance mesurée au télémètre, et l'objectif pendant lequel elle l'a été */
  private coachRange: { v: number; step: string } | null = null;
  /** énergie du dernier impact resté sans effet sur la cible, J */
  private coachWeakE: number | null = null;
  private coachSols = new Map<string, FiringSolution | null>();
  targets = new Map<string, Target>();
  state: State = 'menu';
  timeScale = 1;
  difficulty: Difficulty;
  /** mode test : pas de verrouillage du pointeur, pas de pause automatique */
  testMode: boolean;
  ready = false;
  cinematic = true;
  private ctx!: TargetCtx;
  private host!: LevelHost;
  private rifleNode = new Group();
  private rifleParts: RifleParts | null = null;
  /** tests : caméra imposée (position, point visé, champ) ; null = caméra du jeu */
  private elapsedBlocked = 0;
  testCam: { pos: [number, number, number]; look: [number, number, number]; fov: number } | null = null;
  /** tests : garde la vue extérieure (tireur visible) même en visée */
  forceThirdPerson = false;
  private studioGroup: Group | null = null;
  private studioHidden: Object3D[] = [];
  private rackModels: RifleParts[] = [];
  private bulletMesh!: Mesh;
  private bc: BulletCam | null = null;
  private last = 0;
  private menuT = 0;
  private range: number | null = null;
  private rangeT = 0;
  private aimDist = 400;
  private aimT = 0;
  private predT = 0;
  private predMil: { x: number; y: number } | null = null;
  private ws: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
  private prevStep: { step: Step; s: any } | null = null;
  private volume: number;
  private fpsAvg = 60;
  private showFps: boolean;
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private hudState!: HudState;
  private guide = { x: 0, z: 0, dist: 0, bearing: 0, hint: '', label: '', arrived: false };
  private gameTime = 0;
  private fade = 1;
  /** temps CPU lissés (ms) : simulation, soumission du rendu */
  perf = { step: 0, submit: 0, frames: 0 };
  private repeat = Number(new URLSearchParams(location.search).get('rep') ?? 1);
  private clothTex: any = null;
  /** appareil tactile : commandes à l'écran, pas de verrouillage du pointeur ; portrait uniquement sur téléphone */
  touch: boolean;
  touchCtl: TouchControls | null = null;
  /** protections posées contre les gestes du navigateur mobile (tests) */
  guards: string[] = [];
  /** téléphone tenu à l'horizontale : écran de rotation affiché, jeu figé */
  blocked = false;
  /** échelle des boutons tactiles (variable CSS --ts) */
  private ts = 1;
  private scopeWas = false;
  private tutoRev = 0;
  private touchFrame: TouchFrame = { play: false, bulletCam: false, scope: false, stance: 'stand', nearRack: false, canReload: false, canRange: true, zoom: 8, elev: 0, wind: 0, halo: [] };
  /** tutoriel du premier objectif (aides « assist » et « standard », niveau qui le déclare), ou null */
  tutorial: Tutorial | null = null;
  /** choix mémorisé : 'on', 'off', 'done' (tutoriel terminé) ou null (jamais proposé) */
  private tutoPref: string | null;
  private tutoOffered = false;
  private tutoRanged = false;
  private tutoNeed = new Map<string, number>();
  private bookCache = new Map<string, BookData>();
  private tutoSnap = {} as TutoSnap;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, private params: URLSearchParams, level: Level) {
    this.level = level;
    this.data = level.data;
    this.scene = level.createScene();
    // un bâtiment posé près du site de tir (moins de 480 m) : pas de relief de détail sous son lot
    const pads = level.data.buildings.filter((b) => Math.hypot(b.x, b.z) < 480).map((b) => {
      const lot = lotOf(b.id, b.carte);
      const r = lot ? Math.hypot(lot.l, lot.p) / 2 : 40;
      return { x: b.x, z: b.z, r0: (r + 6) / 0.6, r1: (r + 6) / 0.6 + 24 };
    });
    this.terrain = new Terrain(pads.length ? { ...level.data.terrain, pads: [...level.data.terrain.pads, ...pads] } : level.data.terrain, { palette: level.data.palette, valleyY: level.data.atmosphere?.valleyY });
    this.sky.sun = level.data.sun;
    this.sky.spec = level.data.sky ?? {};
    // vent et abri de la vallée du niveau, en place dès la première image
    this.wind.configure({ ...level.data.wind, valleyY: level.data.atmosphere?.valleyY });
    this.physics = physicsFor(params, level.data.physics);
    // armes du niveau, dans son ordre ; un identifiant inconnu (calibre pas encore livré) est ignoré.
    // `?test&arsenal=id,id,…` (essais) remplace la liste du niveau.
    const ids = (params.has('test') ? params.get('arsenal') : null)?.split(',').filter(Boolean) ?? level.data.weapons;
    this.weapons = ids.map((id) => WEAPONS.find((w) => w.id === id)).filter((w): w is WeaponDef => !!w);
    if (this.weapons.length < ids.length) console.warn('[niveau] armes inconnues ignorées :', ids.filter((id) => !WEAPONS.some((w) => w.id === id)).join(', '));
    if (this.weapons.length > RACK_MAX) {
      console.warn(`[niveau] ${this.weapons.length} armes pour un râtelier de ${RACK_MAX} : les dernières sont écartées (${this.weapons.slice(RACK_MAX).map((w) => w.id).join(', ')})`);
      this.weapons.length = RACK_MAX;
    }
    this.touch = isTouchDevice(params);
    document.documentElement.classList.toggle('touch', this.touch);
    // sur appareil tactile, qualité basse par défaut (l'utilisateur peut la changer) et ratio de pixels plafonné
    const quality = (params.get('q') as QualityName) || (localStorage.getItem('hr.quality') as QualityName) || (this.touch ? 'low' : 'medium');
    // chaque niveau porte son préréglage d'aides ; `?d=assist|standard|real` le force (essais, tutoriel)
    this.difficulty = (params.get('d') as Difficulty) || level.data.difficulty;
    this.volume = Number(localStorage.getItem('hr.volume') ?? '0.8');
    this.testMode = params.has('test');
    this.showFps = params.has('fps');
    this.tutoPref = localStorage.getItem('hr.tuto');
    try { this.coachPref = localStorage.getItem('hr.coach'); } catch { /* stockage indisponible */ }
    // téléphone : textures à 512 px de côté au plus (la mémoire graphique d'un onglet mobile est très limitée)
    if (this.touch && params.get('tex') !== 'full') setTextureLimit(Number(params.get('tex')) || 512);
    this.engine = new Engine(canvas, quality, this.touch ? (quality === 'low' ? 1.5 : 2) : 2);
    this.engine.setRange(level.data.render.cameraFar, level.data.render.shadowFar);
    if (this.touch) {
      // même densité qu'avant en portrait, et un budget de pixels rendus pour les grands écrans (tablettes)
      this.engine.touchMode = true;
      this.engine.pixelBudget = Number(params.get('px')) || (quality === 'low' ? 1.5e6 : 2.6e6);
      this.engine.portraitMode = true;
      this.engine.layoutView = (v) => this.scopeLayout(v);
    }
    if (params.get('dr') === '0') this.engine.dynamicRes = false;
    this.input = new Input(canvas);
    this.input.touch = this.touch;
    // tests sur ordinateur : la souris simulée est lue sans capture
    this.input.free = this.testMode && !this.touch;
    // téléphone : plein écran et verrouillage en portrait là où le navigateur les offre ; tablette : plein écran seul
    const phone = (): boolean => !isTablet(window.innerWidth, window.innerHeight);
    const autoFs = (): void => { if (this.touch && !this.testMode && params.get('fs') !== '0') void goFullscreen(phone()); };
    this.ui = new UI(
      uiRoot,
      {
        start: () => { autoFs(); if (this.ready) this.startMission(); else void this.loadAndStart(); },
        resume: () => { autoFs(); this.setState('play'); },
        close: () => { if (this.state === 'rack' || this.state === 'book') this.setState('play'); },
        setTutorial: (on) => this.setTutoPref(on ? 'on' : 'off'),
        skipTutorial: () => this.skipTutorial(),
        fullscreen: () => void goFullscreen(phone()),
        restart: () => location.reload(),
        retry: () => this.retryStep(),
        setLevel: (id) => { if (id !== this.data.id) switchLevel(id); },
        setQuality: (q) => { if (q !== this.engine.q.name) { localStorage.setItem('hr.quality', q); location.reload(); } },
        setVolume: (v) => { this.volume = v; localStorage.setItem('hr.volume', String(v)); this.audio.setMasterVolume(v); },
        pickWeapon: (id) => { this.equip(id); this.audio.ui('confirm'); this.setState('play'); },
        turret: (k, n) => { if (k === 'elev') this.rifle.clickElev(n); else this.rifle.clickWind(n); this.ui.bookTurrets(this.rifle.elevMil, this.rifle.windMil); },
        continueBrief: () => this.continueBrief(),
        hover: () => this.audio.ui('hover'),
        setCoach: (on) => { this.coachPref = on ? 'on' : 'off'; try { localStorage.setItem('hr.coach', this.coachPref); } catch { /* stockage indisponible */ } if (!on) this.closeCoach(); },
        closeCoach: () => this.closeCoach(),
        submitScore: async (name) => {
          if (!this.endResult || !this.rankedGame()) return { status: 'refused', message: 'Partie d’essai : score non classé.' };
          const out = await this.scores.submit(this.data.id, this.endResult, name);
          if (out.status === 'ok') { this.audio.ui('confirm'); this.showBoards(); }
          return out;
        },
        clearLocalScores: () => { this.scores.clearLocal(); this.showBoards(); },
      },
      {
        difficulty: this.difficulty, quality, volume: this.volume, touch: this.touch, tutorial: this.tutoPref === null || this.tutoPref === 'on', coach: this.coachPref !== 'off', fullscreen: this.touch && canFullscreen(), homeTip: this.touch && needsHomeScreenTip(params),
        levels: LEVELS, level: this.data.id, steps: this.data.steps, weapons: this.weapons, hasTutorial: !!this.data.tutorial,
        alertLabel: this.data.alertZone ? this.data.alertLabel : null, alertTexts: this.data.alertTexts, failNote: this.data.failNote,
      },
    );
    this.showBoards();
    void this.scores.load().then(() => this.showBoards());
    if (this.touch) {
      this.guards = installGestureGuards();
      this.touchCtl = new TouchControls(uiRoot, this.input);
      this.touchCtl.onPause = () => { if (this.state === 'play') this.setState('pause'); };
    }
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'play' && !this.testMode) this.setState('pause');
    };
    const layout = (): void => this.layout();
    window.addEventListener('resize', layout);
    if (!this.touch) this.layout();
    if (this.touch) {
      // les barres du navigateur mobile changent la hauteur utile sans toujours émettre « resize »
      window.visualViewport?.addEventListener('resize', layout);
      window.visualViewport?.addEventListener('scroll', layout);
      window.addEventListener('orientationchange', () => { layout(); setTimeout(layout, 300); });
      // clavier refermé après la saisie du nom : la mise en page est recalée
      document.addEventListener('focusout', () => setTimeout(layout, 250));
      this.layout();
      // application installée (ou navigateur qui l'accepte hors plein écran) : portrait verrouillé d'emblée
      if (phone() && !this.testMode) void lockPortrait();
    }
    const wake = (): void => { void this.audio.start().then(() => this.audio.setMasterVolume(this.volume)); };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    // iOS n'autorise le son que dans un geste terminé (fin de toucher, clic)
    window.addEventListener('touchend', wake);
    window.addEventListener('click', wake);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // onglet masqué, appel entrant, mise en veille : pause (le verrouillage du pointeur ne la déclenche pas au doigt)
        this.touchCtl?.releaseAll();
        if (this.state === 'play' && !this.testMode) this.setState('pause');
      } else if (this.audio.started) wake();
    });
    canvas.addEventListener('click', () => { if (this.state === 'play' && !this.testMode) this.input.lock(); });
  }

  /**
   * Démarrage. Le menu s'affiche tout de suite, sur un fond d'images, sans rien charger de la carte : elle n'est
   * téléchargée et construite qu'au clic sur « Commencer » (`loadAndStart`). Changer de niveau ou de qualité au menu
   * ne recharge donc que la page, pas un monde. Entre-temps, les fichiers lourds sont préchargés en arrière-plan.
   * Les essais automatisés (`?test`) et `?play` chargent la carte d'emblée, comme avant ; `?lazy=1` force le menu léger.
   */
  async init(): Promise<void> {
    const eager = this.params.has('play') || (this.testMode && this.params.get('lazy') !== '1');
    if (eager) {
      await this.load();
      setTimeout(() => {
        this.ui.show('menu');
        if (this.params.has('play')) this.startMission();
      }, 500);
      return;
    }
    this.backdrop = showBackdrop();
    this.ui.show('menu');
    if (this.params.get('preload') !== '0' && !meteredConnection()) {
      this.preloader = new Preloader();
      const start = (): void => this.preloader?.start(preloadList({ terrainDir: this.data.terrain.dir, sky: this.engine.q.name === 'low' ? 'sky_1k.hdr' : 'sky_2k.hdr' }));
      // après l'affichage du menu et de son fond, pour ne pas leur disputer la connexion
      setTimeout(start, 600);
    }
  }

  private loading = false;
  private backdrop: HTMLElement | null = null;
  private preloader: Preloader | null = null;

  /** « Commencer » sur le menu léger : charge la carte (barre de progression), puis lance la mission. */
  private async loadAndStart(): Promise<void> {
    if (this.loading || this.ready) return;
    this.loading = true;
    // le son démarre sur ce geste : l'attendre plus tard le ferait refuser par le navigateur
    void this.audio.start().then(() => this.audio.setMasterVolume(this.volume));
    this.audio.ui('confirm');
    this.ui.setLoading(0, 'Chargement');
    this.ui.show('loading');
    try {
      await this.load();
      // échauffement derrière le rideau : le menu n'affiche plus la carte, il ne compile donc plus les shaders ni ne
      // remplit les ombres avant la partie. On tourne quelques images sur la vue du menu puis sur celle du joueur,
      // sinon les premières secondes de jeu saccadent.
      this.ui.setLoading(1, 'Préparation');
      await this.warmUp(0.9);
      this.player.applyCamera(this.engine.camera, 0, true);
      await this.warmUp(0.9);
      this.backdrop?.remove();
      this.backdrop = null;
      this.startMission();
    } catch (e) {
      console.error(e);
      showError('Erreur de chargement', String((e as Error)?.stack || e));
    }
  }

  /** Laisse tourner le rendu `sec` secondes (au moins vingt images). */
  private warmUp(sec: number): Promise<void> {
    return new Promise((done) => {
      const t0 = performance.now();
      let n = 0;
      const tick = (): void => { if (++n >= 20 && performance.now() - t0 >= sec * 1000) done(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      // onglet passé en arrière-plan : plus d'images, on n'attend pas indéfiniment
      setTimeout(done, sec * 1000 + 3000);
    });
  }

  /** Télécharge et construit la carte. */
  private async load(): Promise<void> {
    this.preloader?.stop();
    const e = this.engine;
    const step = async (p: number, text: string, f: () => Promise<void> | void): Promise<void> => {
      this.ui.setLoading(p, text);
      report('step', text);
      await new Promise((r) => setTimeout(r, 16));
      await f();
    };
    await step(0.05, 'Relief', () => this.terrain.load());
    await step(0.15, 'Ciel', async () => {
      e.initShadows(new Vector3(-0.8, 0.25, 0.3).normalize());
      await this.sky.load(e);
      e.initPost(this.sky.lut);
      e.atmosphere.u('uHaze').value = this.data.render.haze;
      // cotes de la brume rapportées au fond de vallée du niveau ; ombres de nuages
      const at = this.data.atmosphere;
      e.atmosphere.u('uValleyY').value = at?.valleyY ?? 0;
      e.atmosphere.u('uMistLayer').value.set(at?.mistBase ?? 4, at?.mistTop ?? 110);
      if (at?.mist !== undefined) e.atmosphere.u('uMist').value = at.mist;
      if (this.data.sky?.cloudShadow !== undefined) e.atmosphere.u('uCloudShadow').value = 0.85 * this.data.sky.cloudShadow;
      this.sky.update(0, true);
      e.scene.add(this.sky.dome);
    });
    await step(0.3, 'Terrain', async () => { await this.terrain.build(e, this.wind); e.scene.add(this.terrain.group); });
    const host: LevelHost = { engine: e, terrain: this.terrain, col: this.col, wind: this.wind, params: this.params };
    this.host = host;
    let vegSpec!: VegetationSpec;
    await step(0.45, 'Site de tir', async () => { const site = await this.scene.buildSite(host); vegSpec = site.vegetation; this.siteGroup.add(site.group); e.scene.add(this.siteGroup); });
    await step(0.58, 'Végétation', async () => { await this.veg.build(e, this.terrain, this.wind, vegSpec); e.scene.add(this.veg.group); this.col.segs.push(...this.veg.rockSegs); });
    await step(0.75, 'Décor', async () => { this.sceneryGroup.add(await this.scene.buildScenery(host)); e.scene.add(this.sceneryGroup); });
    // bâtiments déclarés par le niveau (data.buildings) : point d'accroche unique, voir src/levels/buildings.ts
    // (avant `col.build()` : leurs collisions entrent dans le BVH ; avant les cibles : `host.buildings` leur sert d'appui)
    await step(0.82, 'Bâtiments', async () => {
      this.buildings = await placeBuildings(host, this.data.buildings);
      this.sceneryGroup.add(this.buildings.group);
      // changement de niveau (la page est rechargée) ou fermeture : géométries et textures des bâtiments rendues
      window.addEventListener('pagehide', (ev) => { if (!ev.persisted) this.buildings?.dispose(); });
    });
    await step(0.86, 'Équipement', async () => {
      this.clothTex = await loadTex('fabric', 'nor', 4);
      this.clothTex.repeat.set(5, 5);
    });
    await step(0.88, 'Cibles', () => {
      this.col.build();
      this.fx = new Fx(this.wind, this.sky.sunColor);
      e.scene.add(this.fx.group);
      // effets du coup de feu ; version allégée sur appareil tactile et en qualité basse
      const surf = { kind: 'stone' as 'stone' | 'wood' };
      this.shotFx = new ShotFx(this.fx, {
        setupMaterial: (m) => e.setupMaterial(m),
        ground: (x, z, nearY, out?: { kind: GroundKind }) => {
          const t = this.terrain.heightAt(x, z), s = this.col.surfaceAt(x, z, nearY, surf);
          if (out) out.kind = s > t ? surf.kind : 'soil';
          return Math.max(t, s);
        },
        dustColor: (x, z, out) => this.terrain.dustColorAt(x, z, out),
      }, this.touch || e.q.name === 'low');
      e.scene.add(this.shotFx.group);
      this.ctx = { fx: this.fx, wind: this.wind, terrain: this.terrain, time: 0 };
      this.buildTargets();
      const bad = checkLevel(this.data, [...this.targets.keys()], this.weapons.map((w) => w.id));
      if (bad.length) throw new Error(`Niveau « ${this.data.id} » incohérent :\n- ${bad.join('\n- ')}`);
      this.player = new Player(e, this.terrain, this.col, {
        footstep: (s, i) => this.audio.footstep(s, i),
        cloth: (i) => this.audio.cloth(i),
        // retour discret, au plus toutes les huit secondes ; rien contre un mur (la limite se voit)
        blocked: (why) => {
          if (!why || this.elapsedBlocked > performance.now()) return;
          this.elapsedBlocked = performance.now() + 8000;
          this.ui.toast(why === 'pente' ? 'Trop raide' : 'Clôture du site', why === 'pente' ? 'Le bord : on ne descend pas plus bas' : 'On ne s’éloigne pas davantage', 1.8);
        },
      }, this.clothTex, { baseY: this.data.site.baseY, start: this.data.site.start, posts: this.data.posts }, this.scene.nav);
      e.scene.add(this.player.group);
      this.buildRack();
      this.equip(this.params.get('w') || this.data.startWeapon);
      this.bulletMesh = new Mesh(new CylinderGeometry(0.0045, 0.0045, 0.034, 8), new MeshBasicMaterial({ color: 0xb8793a }));
      this.bulletMesh.geometry.rotateX(Math.PI / 2);
      this.bulletMesh.visible = false;
      e.scene.add(this.bulletMesh);
      this.scene.addEmitters?.(this.fx);
      this.audio.setLandmarks(this.scene.landmarks());
      this.audio.setEcho(this.data.echo);
    });
    // diagnostic : ?hide=grass,veg,valley,ruin,terrain,fx,targets masque des pans entiers de la scène
    const hide = (this.params.get('hide') || '').split(',');
    if (hide.includes('veg')) this.veg.group.visible = false;
    if (hide.includes('grass')) this.veg.setGrassVisible(false);
    if (hide.includes('valley')) this.sceneryGroup.visible = false;
    if (hide.includes('ruin')) this.siteGroup.visible = false;
    if (hide.includes('terrain')) this.terrain.group.visible = false;
    if (hide.includes('fx')) this.fx.group.visible = false;
    if (hide.includes('targets')) for (const t of this.targets.values()) t.group.visible = false;
    this.ui.setLoading(1, 'Prêt');
    // quelques images pour compiler les shaders avant de lever le rideau
    this.menuCamera(0);
    this.hudState = this.blankHud();
    this.ready = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Recale le rendu sur la taille utile et choisit la mise en page (appareil tactile) : portrait sur téléphone,
   * portrait ou paysage sur tablette. Un téléphone tenu à l'horizontale affiche l'écran de rotation, jeu en pause.
   */
  private layout(): void {
    if (!this.touch) {
      this.engine.resize();
      // bord gauche du champ de la lunette : le conseil affiché en visée s'y adosse, en version courte si la place manque
      const fieldL = this.engine.view.cx - this.engine.view.R;
      document.documentElement.style.setProperty('--field-l', fieldL.toFixed(0) + 'px');
      document.documentElement.classList.toggle('tightscope', fieldL - 44 < 300);
      document.documentElement.classList.toggle('noscopecoach', fieldL - 44 < 180);
      return;
    }
    // saisie du nom : le clavier à l'écran réduit la hauteur utile ; on ne change pas de mise en page (ni d'écran de
    // rotation) tant qu'il est ouvert, et on laisse le navigateur amener le champ en vue
    const ae = document.activeElement;
    if (ae instanceof HTMLInputElement && ae.type === 'text') return;
    const w = window.innerWidth, h = window.innerHeight;
    const portrait = h >= w;
    const turn = !portrait && !isTablet(w, h);
    const root = document.documentElement;
    root.classList.toggle('portrait', portrait);
    root.classList.toggle('turn', turn);
    this.ts = portrait ? Math.min(1.5, Math.max(1, Math.min(w / 375, h / 664))) : Math.min(1.45, Math.max(1, Math.min(h / 390, w / 844)));
    root.style.setProperty('--ts', this.ts.toFixed(3));
    // les barres de Safari qui apparaissent ou disparaissent peuvent laisser la page décalée
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    this.engine.resize();
    if (turn && !this.blocked) {
      this.touchCtl?.releaseAll();
      if (this.state === 'play') this.setState('pause');
    }
    this.blocked = turn;
  }

  /**
   * Portrait : place le champ de la lunette. Diamètre ≈ 93 % de la largeur, collé en haut de la zone sûre (sous la
   * carte du tutoriel quand elle est affichée), réduit si la hauteur manque pour les commandes de la moitié basse.
   * Les mêmes valeurs sont données à la feuille de style (--scx, --scy, --scr) pour ranger les boutons autour.
   */
  private scopeLayout(v: View): void {
    const ins = safeInsets();
    const ts = this.ts;
    const tutoH = this.ui ? this.ui.tutoHeight() : 0;
    const top = ins.top + 6 + (tutoH > 0 ? tutoH + 6 : 0);
    // sous le champ : ligne d'informations, deux rangées de tourelles, puis les boutons du bas et la marge basse
    const below = 26 + (88 * ts + 6) + 8 + 82 * ts + Math.max(ins.bottom, 10) + 12;
    v.R = Math.max(70, Math.min(0.465 * v.w, (v.h - top - below) / 2));
    v.cx = v.w / 2;
    v.cy = top + v.R;
    const st = document.documentElement.style;
    st.setProperty('--scx', v.cx.toFixed(1) + 'px');
    st.setProperty('--scy', v.cy.toFixed(1) + 'px');
    st.setProperty('--scr', v.R.toFixed(1) + 'px');
  }

  private setTutoPref(v: string): void {
    this.tutoPref = v;
    try { localStorage.setItem('hr.tuto', v); } catch { /* stockage indisponible */ }
    this.ui.setTutorialChoice(v === 'on');
  }
  /** le joueur veut-il le tutoriel ? `?tuto=1` / `?tuto=0` forcent ; en mode test il est coupé par défaut */
  private tutoWanted(): boolean {
    const f = this.params.get('tuto');
    if (f === '1') return true;
    if (f === '0' || this.testMode) return false;
    return this.tutoPref === null || this.tutoPref === 'on';
  }
  /** le tutoriel existe sur ce niveau (deux cibles fixes déclarées) et n'est pas proposé sans aides */
  private tutoAvailable(): boolean {
    return !!this.data.tutorial && this.difficulty !== 'real';
  }
  skipTutorial(): void {
    if (!this.tutorial || this.tutorial.finished) return;
    this.tutorial.skip();
    this.setTutoPref('off');
    this.ui.tuto(null, this.state);
    this.ui.toast('Tutoriel passé', 'Il se relance depuis le menu', 2.4);
  }

  private blankHud(): HudState {
    return { visible: false, scope: false, objective: null, index: 0, weapon: null, mag: 0, chambered: true, busy: '', stance: '', post: null, heading: 0, guide: null, prompt: '', heart: 60, air: 1, breath: 'normal', zoom: 8, elev: 0, wind: 0, range: null, rangeFlat: null, hold: '', windSpeed: null, windRel: 0, alert: 0, alarm: false, fps: 60, showFps: this.showFps };
  }

  private buildTargets(): void {
    const e = this.engine;
    for (const t of this.scene.buildTargets(this.host, this.fx)) {
      this.targets.set(t.id, t);
      e.scene.add(t.group);
    }
    this.shots = new Shots(this.terrain, this.col, this.wind, this.ctx, { waterLevel: this.data.terrain.waterLevel, alertZone: this.data.alertZone, physics: this.physics });
    this.shots.targets = [...this.targets.values()];
    this.shots.onImpact = (r) => this.onImpact(r);
    this.mission = new Mission(this.targets, this.data.steps, this.data.alertZone);
    this.mission.difficulty = this.difficulty;
    this.mission.onStepDone = (step, s) => {
      this.coach.clear();
      this.ui.coach(null);
      this.prevStep = { step, s };
      this.audio.ui('success');
      this.scope.exit();
      // le premier objectif validé clôt le tutoriel, même inachevé
      if (this.tutorial && !this.tutorial.finished) { this.tutorial.skip(); this.setTutoPref('done'); this.ui.tuto(null, 'brief'); }
      if (this.mission.finished) this.endMission();
      else { this.ui.setBrief(this.mission.step, this.mission.index, this.difficulty, this.prevStep); this.setState('brief'); }
    };
    this.mission.onFail = (reason) => {
      this.coach.clear();
      this.ui.coach(null);
      this.audio.ui('fail');
      setTimeout(() => { this.scope.exit(); this.ui.fail(reason); this.setState('fail'); }, this.testMode ? 0 : 2600);
    };
    const at = this.data.alertTexts;
    this.mission.onAlarm = () => this.ui.toast(at?.raised ?? 'L’alerte est donnée', at?.raisedSub ?? 'Discrétion perdue', 4);
  }

  /** classements de l'accueil */
  private showBoards(): void {
    this.ui.setBoards(this.scores.boards, this.scores.online, this.scores.localCount());
  }

  /**
   * La partie compte-t-elle pour le classement ? Non pour une partie d'essai : mode test (`?test`, scripts
   * automatisés), aides forcées par `?d=` (le coefficient du score n'est plus celui du niveau) ou objectifs sautés
   * par `?step=`. `?scores=1` l'autorise malgré le mode test : c'est le test dédié (e2e/scores.mjs).
   */
  rankedGame(): boolean {
    if (this.difficulty !== this.data.difficulty || this.params.has('step')) return false;
    return !this.testMode || this.params.get('scores') === '1';
  }

  /** Mission accomplie : bilan, rang dans le classement du niveau, saisie du nom si le score y entre. */
  private endMission(): void {
    const m = this.mission, sc = m.score();
    const level = this.data.id;
    const title = LEVELS.find((l) => l.id === level)?.meta.title ?? level;
    this.endResult = { score: sc.total, grade: sc.grade, accuracy: sc.accuracy, shots: m.totalShots, time: Math.floor(m.elapsed) };
    const ranked = this.rankedGame();
    this.ui.end(m, { title, ranked, board: this.scores.boards[level], online: this.scores.online, lastName: this.scores.lastName(), result: this.endResult });
    this.setState('end');
    // d'autres joueurs ont pu s'inscrire pendant la partie : le classement est relu
    void this.scores.load().then(() => { this.ui.endBoard(this.scores.boards[level], this.scores.online); this.showBoards(); });
  }

  private buildRack(): void {
    // armes debout et de profil (flanc droit vers la cour, lunette vers l'est), crosse sur la tablette
    // (dessus à 0,28 m), fût appuyé contre la lisse haute ; l'abri est celui de Masonry.rackShelter
    const lean = 0.13;
    const rack = this.data.site.rack, n = this.weapons.length;
    // la tablette fait 2,9 m entre ses montants : 0,4 m par arme jusqu'à huit ; au-delà (douze au plus) les armes se
    // serrent et pivotent d'un tiers de tour sur leur crosse, lunette vers la cour, comme des livres penchés :
    // elles se recouvrent de profil sans se toucher, et chacune reste reconnaissable
    const pitch = Math.min(0.4, 2.5 / Math.max(1, n - 1));
    const turn = pitch < 0.36 ? 0.62 : 0;
    const up = new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)).premultiply(new Matrix4().makeRotationY(turn)).premultiply(new Matrix4().makeRotationX(lean));
    this.weapons.forEach((w, i) => {
      const m = buildRifleModel(this.engine, w, 1);
      const butt = m.anchors.butt;
      m.group.quaternion.setFromRotationMatrix(up);
      // la plaque de couche repose sur la tablette, l'arme est centrée sur son emplacement
      m.group.position.set(rack.x + (i - (n - 1) / 2) * pitch + (turn ? 0.07 : 0.02), this.data.site.baseY + 0.29 - butt.z * Math.cos(lean), rack.z + 1.03);
      m.bipod.visible = false;
      this.engine.scene.add(m.group);
      this.rackModels.push(m);
    });
  }

  equip(id: string): void {
    // une arme hors du râtelier de ce niveau (paramètre ?w=) est remplacée par l'arme de départ
    const def = this.weapons.find((w) => w.id === id) ?? this.weapons.find((w) => w.id === this.data.startWeapon) ?? this.weapons[0];
    this.rifle = new Rifle(def, {
      boltOpen: () => this.audio.boltOpen(),
      boltClose: () => this.audio.boltClose(),
      dryFire: () => this.audio.dryFire(),
      magOut: () => this.audio.magOut(),
      magIn: () => this.audio.magIn(),
      turret: () => this.audio.turretClick(),
    });
    if (this.rifleParts) this.rifleNode.remove(this.rifleParts.group);
    this.rifleParts = buildRifleModel(this.engine, def);
    this.rifleNode.rotation.set(0, 0, 0);
    this.rifleNode.add(this.rifleParts.group);
    this.player.char.group.add(this.rifleNode);
    this.range = null;
    // le tampon du tir est calculé ici, pas au départ du coup
    this.audio.prepareShot(def);
  }

  // ------------------------------------------------------------------ états
  setState(s: State): void {
    const prev = this.state;
    this.state = s;
    const ui = this.ui;
    if (s === 'play') {
      ui.show(null);
      if (!this.testMode) this.input.lock();
      if (prev === 'brief' || prev === 'fail') { this.mission.begin(); this.mission.checkAlreadyDone(); }
    } else {
      if (s !== 'menu') this.input.unlock();
      if (s === 'pause') ui.show('pause');
      else if (s === 'brief') ui.show('brief');
    }
  }
  startMission(): void {
    void this.audio.start().then(() => this.audio.setMasterVolume(this.volume));
    this.audio.ui('confirm');
    this.mission.difficulty = this.difficulty;
    const skip = Number(this.params.get('step') ?? 0);
    this.mission.index = Math.min(this.data.steps.length - 1, Math.max(0, skip));
    this.fade = 1;
    this.player.applyCamera(this.engine.camera, 0, true);
    // première partie : le briefing propose le tutoriel (premier objectif, sauf sans aides)
    const offer = this.tutoPref === null && !this.params.has('tuto') && !this.testMode && this.tutoAvailable() && this.mission.index === 0;
    this.ui.setBrief(this.mission.step, this.mission.index, this.difficulty, null, offer ? true : null);
    this.setState('brief');
  }
  continueBrief(): void {
    this.audio.ui('confirm');
    this.prevStep = null;
    if (!this.tutoOffered) {
      this.tutoOffered = true;
      if (this.mission.index === 0 && this.tutoAvailable() && this.tutoWanted()) {
        this.tutorial = new Tutorial();
        if (this.tutoPref === null) this.setTutoPref('on');
      }
    }
    if (this.mission.running) { this.state = 'play'; this.ui.show(null); if (!this.testMode) this.input.lock(); }
    else this.setState('play');
  }
  retryStep(): void {
    // le niveau remet sa scène en état (ex. marché repeuplé), puis on reprend l'objectif
    const swap = this.scene.retry?.(this.host, this.fx) ?? null;
    if (swap) {
      for (const t of swap.remove) this.engine.scene.remove(t.group);
      for (const t of swap.add) { this.targets.set(t.id, t); this.engine.scene.add(t.group); }
      this.shots.targets = [...this.targets.values()];
    }
    this.mission.failed = null;
    this.ui.setBrief(this.mission.step, this.mission.index, this.difficulty, null);
    this.setState('brief');
  }

  // ------------------------------------------------------------------ tir
  /** environnement balistique en vigueur (undefined : aucun effet avancé) */
  get benv(): BallisticEnv | undefined {
    return this.shots.benv;
  }
  /** azimut de tir courant, degrés (0 = nord, sens horaire) : celui de la lunette, sinon celui du regard */
  private aimBearing(): number {
    const yaw = this.scope.active ? this.scope.yaw : this.player.yaw;
    return (((yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /**
   * Carnet de tir de l'arme. Physique neutre : la table à plat d'origine (élévation, vent de 5 m/s, vol, vitesse,
   * énergie), dans le modèle de traînée de l'arme. Dès qu'un effet avancé est actif : une solution de tir décomposée
   * par distance, pour l'azimut de tir courant arrondi à 5° (Coriolis en dépend), et un vent traversier de référence
   * de 5 m/s. Le calcul coûte jusqu'à 3,6 ms par ligne à 2 500 m : il est fait à l'ouverture du carnet et gardé par
   * arme et par azimut, jamais à chaque image.
   */
  bookData(def: WeaponDef): BookData {
    const env = this.benv;
    const az = env ? Math.round(this.aimBearing() / 5) * 5 % 360 : 0;
    const key = def.id + '|' + az;
    const hit = this.bookCache.get(key);
    if (hit) return hit;
    const slow = def.v0 <= 400;
    // `?test&dope=<m>` (essais) : portée du carnet, à la place de celle du niveau
    const limit = (this.testMode && Number(this.params.get('dope'))) || this.data.dopeLimit;
    const max = Math.min(limit, def.effective + (slow ? 100 : def.tier === 'elr' ? 900 : 400));
    const ranges: number[] = [];
    // pas de 100 m ; au-delà de 16 lignes, 200 m passé le premier kilomètre (cartes à très longue distance)
    const stepR = slow ? 25 : 100;
    const wide = !slow && max / stepR > 16;
    for (let r = stepR; r <= max; r += wide && r >= 1000 ? 200 : stepR) ranges.push(r);
    const { bc, drag } = loadDrag(def);
    const data: BookData = { def, drag, bc, wind: BOOK_WIND, turretMax: def.turretMaxMil, holdMax: RETICLE_HOLD_MIL, flat: null, adv: null };
    if (!env) data.flat = ballisticTable(def, { zero: def.zero, sightHeight: SIGHT_HEIGHT, crosswind: BOOK_WIND, ranges, air: GAME_AIR });
    else {
      // vent de référence : plein travers venant de la gauche (il pousse l'impact à droite)
      const sols = solutionTable(def, ranges, { azimuthDeg: az, windSpeed: BOOK_WIND, windFromDeg: az - 90, env, air: GAME_AIR, sightHeight: SIGHT_HEIGHT });
      const flight = makeFlight(def, env, { air: GAME_AIR });
      const last = sols[sols.length - 1];
      data.adv = {
        azimuth: az, env, sg: flight.sg, v0: flight.v0, rho: flight.air.rho,
        transonic: last?.transonicRange ?? null, subsonic: last?.subsonicRange ?? null,
        rows: sols.map((s) => {
          const elev = s.parts.drop + s.parts.coriolisV;
          const split = splitElevation(elev, def.turretMaxMil, CLICK_MIL);
          return {
            range: s.range, elev, dial: split.dialMil, hold: elev > def.turretMaxMil + CLICK_MIL / 2 ? split.holdMil : 0,
            drop: s.parts.drop, coriolisV: s.parts.coriolisV, windage: s.parts.spinDrift + s.parts.coriolisH, spin: s.parts.spinDrift, coriolisH: s.parts.coriolisH,
            wind: Math.abs(s.parts.wind), jump: s.parts.aeroJump, tof: s.tof, mach: s.mach, velocity: s.velocity, energy: s.energy,
          };
        }),
      };
    }
    if (this.bookCache.size > 40) this.bookCache.clear();
    this.bookCache.set(key, data);
    return data;
  }

  fire(): void {
    const def = this.rifle.def;
    if (!this.rifle.trigger()) return;
    const eye = this.player.eye(this.v1);
    const los = this.scope.lineOfSight(this.v2);
    const elev = this.rifle.elevMil, windage = this.rifle.windMil;
    // prévision avec le vent tel qu'il évoluera : décide de la caméra de balle
    const pred = this.cinematic ? this.shots.predict(eye, los, def, elev, windage, false, this.maxFlight() + 1.5) : null;
    const bullet = this.shots.fire(eye, los, def, elev, windage);
    (bullet as any).elev = elev;
    (bullet as any).windage = windage;
    this.audio.shot(def);
    this.scope.recoil(def, shotFxParams(def).scopeJump);
    this.mission.onShot(def);
    this.player.heartRate = Math.min(150, this.player.heartRate + 2 + def.chargeGr * 0.05);
    this.fx.clearTrail();
    // flamme, fumée, poussière soulevée, recul visible, voile de lunette : src/world/shotfx.ts
    if (this.rifleParts) {
      this.shotFx.aim(this.rifleParts.group, this.rifleParts.anchors.muzzle);
      this.shotFx.fire(def, this.player.stance === 'prone', this.player.pos.y);
    }
    if (pred && pred.tof > 0.5) {
      const cur = this.mission.currentTargets();
      let near = pred.target !== null && cur.includes(pred.target);
      if (!near) for (const t of cur) if (!t.done && t.predict(pred.tof, this.v3).distanceTo(pred.point) < 0.7) near = true;
      if (near) {
        this.bc = { bullet, pred, phase: 'follow', hold: 0, camPos: new Vector3(), look: pred.point.clone() };
        this.ui.letterbox(true);
        this.audio.bulletWhoosh(0.8);
      }
    }
  }

  private onImpact(r: ImpactReport): void {
    const b = r.bullet as any;
    // cibles de l'objectif encore debout avant ce tir : c'est sur elles que le conseil compte les tirs manqués
    const pending = this.mission.running ? this.mission.currentTargets().filter((t) => !t.done || t === r.target) : [];
    const text = this.mission.onImpact(r, b.elev ?? 0, b.windage ?? 0);
    this.tutorial?.onImpact(!!r.result?.success);
    this.coachImpact(r, pending);
    const inCam = this.bc !== null && this.bc.bullet === r.bullet;
    this.audio.impact(r.kind, r.point.x, r.point.y, r.point.z, inCam ? 0.03 : r.distance / 343, r.energy);
    this.impactFx(r.kind, r.point, r.energy);
    const ok = !!r.result?.success;
    // règle propre à la carte (ex. un tir manqué sur la place disperse la foule : la cible s'enfuit)
    const lost = this.scene.onImpact?.(r, this.mission.step.id, this.audio) ?? null;
    if (lost && !this.mission.failed) {
      this.mission.failed = lost;
      this.mission.running = false;
      this.mission.onFail(lost);
    }
    const sub = `${fr(r.distance)} m · ${fr(r.tof, 2)} s de vol · ${fr(r.energy)} J`;
    this.ui.toast(text, sub, ok ? 3.4 : 2.4);
    if (inCam && this.bc) { this.bc.look.copy(r.point); }
  }

  // ------------------------------------------------------------------ conseil après tirs manqués
  /** le joueur veut-il les conseils ? `?coach=1` / `?coach=0` forcent ; en mode test ils sont coupés par défaut */
  coachWanted(): boolean {
    const f = this.params.get('coach');
    if (f === '1') return true;
    if (f === '0' || this.testMode) return false;
    return this.coachPref !== 'off';
  }
  closeCoach(): void {
    this.coach.dismiss();
    this.ui.coach(null);
  }
  /** largeur utile d'une cible, m : la plus grande de ses zones touchables */
  private targetWidth(t: Target): number {
    let w = 0;
    for (const c of t.colliders) w = Math.max(w, c.shape === 'sphere' ? 2 * c.r : 2 * Math.max(c.half.x, c.half.z));
    return w;
  }
  /**
   * Rapporte un impact au suivi des tirs manqués. `pending` : cibles de l'objectif encore à neutraliser avant ce tir.
   * Rien pendant le tutoriel (il explique déjà la distance, le carnet et la tourelle), ni si le joueur a coupé les conseils.
   */
  private coachImpact(r: ImpactReport, pending: Target[]): void {
    if (!pending.length || !this.coachWanted() || (this.tutorial && this.tutorial.active)) return;
    let sig;
    let target: Target;
    if (r.target && pending.includes(r.target)) {
      target = r.target;
      // touchée sans effet (hors plaques et cloche, qui sonnent toujours) : l'énergie ou la pénétration manquent
      const weak = !r.result?.success && r.kind !== 'steel' && r.kind !== 'bell';
      if (weak) this.coachWeakE = r.energy;
      sig = this.coach.record({ kind: weak ? 'weak' : 'hit', target: target.id });
    } else if (r.target) return; // autre cible (objectif à venir, civil) : ni touche ni tir manqué sur celle-ci
    else {
      // tir manqué : écart angulaire à la cible la plus proche de l'impact, vu du poste de tir
      const o = r.bullet.origin;
      let best: { t: Target; up: number; right: number; d: number } | null = null;
      for (const t of pending) {
        const los = t.aimPoint(new Vector3()).sub(o);
        const dist = los.length();
        if (dist < 1) continue;
        los.multiplyScalar(1 / dist);
        const right = new Vector3().crossVectors(los, new Vector3(0, 1, 0)).normalize();
        const up = new Vector3().crossVectors(right, los);
        const d = r.point.clone().sub(o);
        const z = d.dot(los);
        if (z < 1) continue;
        const x = (d.dot(right) / z) * 1000, y = (d.dot(up) / z) * 1000;
        const a = Math.hypot(x, y);
        if (!best || a < best.d) best = { t, up: y, right: x, d: a };
      }
      if (!best || best.d > AIM_WINDOW_MIL) return;
      target = best.t;
      sig = this.coach.record({ kind: 'miss', target: target.id, offset: { up: best.up, right: best.right } });
    }
    if (!sig) return;
    if ('hide' in sig) { this.ui.coach(null); return; }
    this.openCoach(target, sig.show, sig.reminder);
  }
  /** Compose et affiche le conseil : solution de tir de l'arme en main sur la cible, par le vent du moment (calcul gardé en cache). */
  private openCoach(target: Target, reason: 'miss' | 'weak', reminder: boolean): void {
    const def = this.rifle.def;
    const eye = this.player.eye(new Vector3());
    const aim = target.aimPoint(new Vector3());
    const dx = aim.x - eye.x, dz = aim.z - eye.z;
    const trueRange = eye.distanceTo(aim);
    // distance connue du joueur : affichée en continu (assisté), ou mesurée au télémètre sur cette cible (à 5 % près)
    const measured = this.coachRange && this.coachRange.step === this.mission.step.id && Math.abs(this.coachRange.v - trueRange) <= 0.05 * trueRange ? this.coachRange.v : null;
    const known = this.difficulty === 'assist' ? trueRange : this.difficulty === 'standard' ? measured : null;
    // les chiffres cités sont ceux de la distance que le joueur a lue : ce sont ceux qu'il retrouvera au carnet
    const range = known ?? trueRange;
    const azimuthDeg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    // le vent va à l'opposé de l'azimut d'où il vient (voir world/wind.ts)
    const windFromDeg = ((Math.atan2(this.ws.x, -this.ws.z) * 180) / Math.PI + 180) % 360;
    const setup = { range, heightDiff: aim.y - eye.y, azimuthDeg, windSpeed: this.ws.speed, windFromDeg, env: this.benv, air: GAME_AIR, sightHeight: SIGHT_HEIGHT };
    const key = `|${Math.round(range)}|${Math.round(setup.heightDiff)}|${Math.round(azimuthDeg)}|${this.ws.speed.toFixed(1)}|${Math.round(windFromDeg / 5)}`;
    const solve = (w: WeaponDef): FiringSolution | null => {
      const k = w.id + key;
      if (!this.coachSols.has(k)) { if (this.coachSols.size > 60) this.coachSols.clear(); this.coachSols.set(k, firingSolution(w, setup)); }
      return this.coachSols.get(k) ?? null;
    };
    const solution = solve(def);
    const width = this.targetWidth(target);
    const weak = reason === 'weak';
    const { issues, alternatives } = assessWeapon(def, this.weapons, solve, { targetWidth: width, weak, weakEnergy: weak ? this.coachWeakE : null });
    this.ui.coach(buildAdvice({
      touch: this.touch, difficulty: this.difficulty, reason, reminder, misses: this.coach.streak, weapon: def, range: known, solution,
      elevDial: this.rifle.elevMil, windDial: this.rifle.windMil, windSpeed: this.difficulty === 'real' ? null : this.ws.speed,
      diagnosis: weak ? null : diagnose(this.coach.offsets), issues, alternatives, intel: this.mission.step.intel, advancedBook: !!this.benv,
    }));
  }

  private impactFx(kind: ImpactKind, p: Vector3, energy: number): void {
    const k = Math.min(2.2, 0.6 + energy / 1500);
    const fx = this.fx;
    switch (kind) {
      case 'dirt': fx.puff(p, { count: Math.round(10 * k), speed: 2.2 * k, up: 1.5, life: 1.8, size: [0.15, 1.3 * k], color: 0x9a8566, alpha: 0.55 }); break;
      case 'rock': fx.puff(p, { count: Math.round(9 * k), speed: 2.5 * k, up: 1, life: 1.3, size: [0.1, 0.9 * k], color: 0xb8b2a8, alpha: 0.55 });
        fx.puff(p, { count: 6, speed: 5, life: 0.35, size: [0.012, 0.025], color: 0xffe2a0, alpha: 1, gravity: 9, drag: 0.5, wind: 0, glow: 1 }); break;
      case 'wood': fx.puff(p, { count: 10, speed: 2.5, up: 0.8, life: 0.9, size: [0.03, 0.12], color: 0xa08660, alpha: 0.9, gravity: 6, drag: 1.5, wind: 0.2 }); break;
      case 'water': fx.puff(p, { count: Math.round(16 * k), speed: 1.2, up: 4.5 * k, spread: 0.3, life: 1.1, size: [0.08, 0.5], color: 0xe8f2f6, alpha: 0.7, gravity: 9, drag: 0.4, wind: 0.1 }); break;
      case 'steel': case 'bell': fx.puff(p, { count: 10, speed: 4, life: 0.3, size: [0.012, 0.03], color: 0xffe8b0, alpha: 1, gravity: 6, drag: 0.5, wind: 0, glow: 1.4 });
        fx.puff(p, { count: 4, speed: 0.6, life: 0.9, size: [0.06, 0.4], color: 0xcfcfcf, alpha: 0.35 }); break;
      case 'metal': case 'tire': fx.puff(p, { count: 9, speed: 4, life: 0.3, size: [0.012, 0.03], color: 0xffe2a0, alpha: 1, gravity: 8, drag: 0.5, wind: 0, glow: 1.2 }); break;
      default: break;
    }
  }

  /** durée de vol à prévoir pour les aides (s) : 4,5 s jusqu'à 2 600 m de portée, davantage sur une carte plus profonde */
  private maxFlight(): number {
    return Math.min(11, Math.max(4.5, this.data.rangeLimit / 420));
  }

  private losDistance(eye: Vector3, dir: Vector3): number {
    const R = this.data.rangeLimit;
    const far = this.v3.copy(eye).addScaledVector(dir, R);
    let best = R;
    const hit = new Vector3();
    if (this.terrain.raycast(eye.x, eye.y, eye.z, far.x, far.y, far.z, hit, 3)) best = eye.distanceTo(hit);
    const d = this.col.segment(eye, far);
    if (d >= 0 && d < best) best = d;
    for (const t of this.shots.targets) {
      if (!t.active) continue;
      const h = t.segment(eye, far);
      if (h && h.t * R < best) best = h.t * R;
    }
    return best;
  }

  // ------------------------------------------------------------------ caméras
  private nearT = 0;
  private nearNow = SCOPE_NEAR;
  private nearAxis = new Vector3();
  private nearDir = new Vector3();
  private nearEnd = new Vector3();
  private nearHit = new Vector3();
  private nearFixed = new URLSearchParams(location.search).get('near') === 'fixed';
  /**
   * Plan proche de la caméra en lunette. À 0,55 m, le tampon de profondeur ne sépare plus que 0,7 m à 2 500 m
   * (scintillement des façades et des plaques lointaines). On le repousse donc d'autant plus loin que le grossissement
   * est fort (1,6 m par ×, 40 m au plus : 1 cm à 2 500 m), sans jamais dépasser 0,6 fois la distance du premier
   * obstacle du champ : sol (herbe comprise), murs et bâtiments (BVH des collisions, objets minces compris), cibles,
   * arbres, rochers et touffes proches. Rien de ce qui est visible dans le champ n'est donc coupé ; seule la précision
   * de profondeur change. Réévalué huit fois par seconde sur un cône élargi (la visée bouge entre deux mesures).
   * `?near=fixed` (diagnostic) : plan proche d'origine.
   */
  private scopeNear(cam: PerspectiveCamera, dtReal: number): number {
    if (this.nearFixed) return SCOPE_NEAR;
    this.nearT -= dtReal;
    if (this.nearT > 0) return this.nearNow;
    this.nearT = 0.12;
    const mag = this.rifle.zoom;
    const want = Math.min(40, Math.max(SCOPE_NEAR, 1.6 * mag));
    // demi-angle du champ circulaire (rayon 0,462 × hauteur sur l'écran de référence), élargi pour le bougé
    const tanA = ((2 * REF_SCOPE_R * Math.tan((REF_FOV * Math.PI) / 360)) / mag) * 1.5 + 0.012;
    const o = cam.position, d = cam.getWorldDirection(this.nearAxis);
    const reach = want / 0.6;
    let first = reach;
    // objets des collisions : tout triangle qui entre dans le cône
    first = this.col.coneNearest(o, d, tanA, first);
    // sol : l'axe et huit rayons du bord du champ ; l'herbe est couchée dans l'axe jusqu'à 26 m, haute au-delà
    const up = this.v3.set(0, 1, 0);
    const rx = this.nearEnd.crossVectors(d, up).normalize();
    const rxx = rx.x, rxy = rx.y, rxz = rx.z;
    const uy = this.nearHit.crossVectors(rx, d);
    const uxx = uy.x, uxy = uy.y, uxz = uy.z;
    for (let k = 0; k < 9 && first > 0.8; k++) {
      const a = (k * Math.PI) / 4, cr = k === 8 ? 0 : Math.cos(a) * tanA, cu = k === 8 ? 0 : Math.sin(a) * tanA;
      const dir = this.nearDir.set(d.x + rxx * cr + uxx * cu, d.y + rxy * cr + uxy * cu, d.z + rxz * cr + uxz * cu);
      // grandes surfaces rasantes des collisions (plancher, dalle, mur longé) : un rayon par direction
      const hd = this.col.segment(o, this.nearEnd.copy(o).addScaledVector(dir, first));
      if (hd >= 0) first = Math.max(0.3, hd / dir.length());
      for (let t = 0.6; t < first; t = t * 1.22 + 0.15) {
        const y = o.y + dir.y * t, x = o.x + dir.x * t, z = o.z + dir.z * t;
        if (y - this.terrain.heightAt(x, z) < (t < 26 ? 0.14 : 0.9)) { first = t; break; }
      }
    }
    // cibles, végétation, râtelier : sphères englobantes
    const sphere = (x: number, y: number, z: number, r: number): void => {
      const dx = x - o.x, dy = y - o.y, dz = z - o.z;
      const t = dx * d.x + dy * d.y + dz * d.z;
      if (t - r >= first || t + r < 0) return;
      const lat = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t));
      if (lat < r + Math.max(0, t) * tanA) first = Math.max(0.3, t - r);
    };
    for (const t of this.shots.targets) { const p = t.group.position; sphere(p.x, p.y + 1, p.z, 3.5); }
    for (const b of this.veg.obstacles) sphere(b.x, b.y, b.z, b.r);
    for (const b of this.col.soft) sphere(b.x, b.y, b.z, b.r);
    for (const b of this.scene.viewObstacles?.() ?? []) sphere(b.x, b.y, b.z, b.r);
    const rack = this.data.site.rack;
    sphere(rack.x, this.data.site.baseY + 1.2, rack.z + 0.6, 2.6);
    // pas de 1,25 : le plan proche (et les cascades d'ombre avec lui) ne change que par crans
    const n = Math.min(want, Math.max(SCOPE_NEAR, first * 0.6));
    this.nearNow = n >= want ? want : Math.max(SCOPE_NEAR, SCOPE_NEAR * Math.pow(1.25, Math.floor(Math.log(n / SCOPE_NEAR) / Math.log(1.25))));
    return this.nearNow;
  }
  private menuCamera(dt: number): void {
    this.menuT += dt;
    const cam = this.engine.camera;
    const SHOT = 16;
    const i = Math.floor(this.menuT / SHOT) % 4;
    const u = (this.menuT % SHOT) / SHOT;
    // fondus au noir entre les plans
    this.fade = u < 0.08 ? 1 - u / 0.08 : u > 0.94 ? (u - 0.94) / 0.06 : 0;
    // les quatre plans sont ceux du niveau
    cam.fov = this.engine.cineFov(this.scene.menuCamera(cam, i, u));
    cam.updateProjectionMatrix();
  }

  private updateBulletCam(dtReal: number): void {
    const bc = this.bc!;
    const cam = this.engine.camera;
    // la balle est à 1,9 m de la caméra : plan proche d'origine (celui de la lunette serait bien au-delà)
    this.engine.setNear(0.55);
    this.nearT = 0;
    const b = bc.bullet;
    const s = b.s;
    const vdir = this.v1.set(s.vx, s.vy, s.vz).normalize();
    const right = this.v2.crossVectors(vdir, this.v3.set(0, 1, 0)).normalize();
    this.bulletMesh.visible = b.alive;
    if (bc.phase === 'follow') {
      const remaining = bc.pred.point.distanceTo(b.pos);
      const screen = Math.min(4.2, Math.max(2.2, 1.6 + bc.pred.tof * 0.9));
      this.timeScale = Math.min(0.5, Math.max(0.03, bc.pred.tof / screen));
      cam.position.copy(b.pos).addScaledVector(vdir, -1.9).addScaledVector(right, 0.2);
      cam.position.y += 0.11;
      cam.lookAt(b.pos.x + vdir.x * 40, b.pos.y + vdir.y * 40, b.pos.z + vdir.z * 40);
      cam.fov = this.engine.cineFov(44);
      this.bulletMesh.position.copy(b.pos);
      this.bulletMesh.lookAt(b.pos.x + vdir.x, b.pos.y + vdir.y, b.pos.z + vdir.z);
      this.bulletMesh.scale.set(1.6, 1.6, 2.4);
      if (!b.alive || remaining < Math.max(9, Math.hypot(s.vx, s.vy, s.vz) * 0.035)) {
        bc.phase = 'impact';
        bc.camPos.copy(b.pos).addScaledVector(vdir, -3.5).addScaledVector(right, 1.8);
        bc.camPos.y = Math.max(bc.camPos.y + 1.1, this.terrain.heightAt(bc.camPos.x, bc.camPos.z) + 1.2);
        this.audio.bulletWhoosh(0);
      }
    } else {
      this.timeScale = b.alive ? 0.12 : damp(this.timeScale, 0.45, 3, dtReal);
      cam.position.copy(bc.camPos);
      cam.lookAt(bc.look);
      cam.fov = damp(cam.fov, this.engine.cineFov(26), 4, dtReal);
      if (b.alive) { this.bulletMesh.position.copy(b.pos); this.bulletMesh.scale.setScalar(1.6); }
      else bc.hold += dtReal;
      if (bc.hold > 1.7 || this.input.hit('Space') || this.input.click(0)) this.endBulletCam();
    }
    if (bc.phase === 'follow' && (this.input.hit('Space') || this.input.click(2))) this.endBulletCam();
  }
  private endBulletCam(): void {
    this.bc = null;
    this.timeScale = 1;
    this.bulletMesh.visible = false;
    this.ui.letterbox(false);
    this.audio.bulletWhoosh(0);
  }

  // ------------------------------------------------------------------ boucle
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const raw = now - this.last;
    this.last = now;
    const dtReal = Math.min(0.1, raw / 1000);
    this.fpsAvg += (1000 / Math.max(1, raw) - this.fpsAvg) * 0.05;
    const paused = this.state === 'pause' || this.blocked;
    const dt = paused ? 0 : dtReal * this.timeScale;
    const t0 = performance.now();
    this.step(dt, dtReal);
    const t1 = performance.now();
    this.engine.render(dt, raw);
    // mesure : ?rep=N rend chaque image N fois ; la cadence divisée par N donne le coût réel d'une image,
    // même quand l'affichage plafonne la cadence
    for (let i = 1; i < this.repeat; i++) this.engine.render(0, raw);
    const t2 = performance.now();
    this.perf.step += (t1 - t0 - this.perf.step) * 0.05;
    this.perf.submit += (t2 - t1 - this.perf.submit) * 0.05;
    this.perf.frames++;
    this.input.endFrame();
  }

  /** Avance la simulation ; séparé du rendu pour les tests automatisés. */
  step(dt: number, dtReal: number): void {
    const e = this.engine;
    const cam = e.camera;
    const inp = this.input;
    const playing = this.state === 'play';
    /** la caméra de cette image est celle de la lunette (son centre de projection se place sur le centre optique) */
    let scopeCam = false;
    inp.enabled = playing;
    this.gameTime += dt;
    this.ctx.time = this.gameTime;
    // vent de l'objectif en cours (data.wind.steps), sinon celui de la carte
    const wspec = this.data.wind;
    if (wspec?.steps) {
      const o = this.mission?.step ? wspec.steps[this.mission.step.id] : undefined;
      this.wind.baseSpeed = o?.speed ?? wspec.speed;
      this.wind.fromBearing = o?.fromBearing ?? wspec.fromBearing;
    }
    this.wind.update(dt);

    // --- touches d'interface ---
    if (this.state === 'brief' && (inp.rawHit('Enter') || inp.rawHit('NumpadEnter'))) this.continueBrief();
    else if (this.state === 'rack') {
      // rangée des chiffres : 1 à 9, 0 pour la dixième, puis les deux touches à sa droite ; flèches : arme voisine
      for (let i = 0; i < this.weapons.length && i < RACK_KEYS.length; i++) if (inp.rawHit(RACK_KEYS[i])) this.ui.selectWeapon(this.weapons[i].id, true);
      const move = (inp.rawHit('ArrowDown') || inp.rawHit('ArrowRight') ? 1 : 0) - (inp.rawHit('ArrowUp') || inp.rawHit('ArrowLeft') ? 1 : 0);
      if (move) {
        const cur = this.weapons.findIndex((w) => w.id === this.ui.rackSel);
        this.ui.selectWeapon(this.weapons[(cur + move + this.weapons.length) % this.weapons.length].id, true);
      }
      if (inp.rawHit('Enter')) { this.equip(this.ui.rackSel); this.audio.ui('confirm'); this.setState('play'); }
      else if (inp.rawHit('KeyE') || inp.rawHit('Escape')) this.setState('play');
    } else if (this.state === 'book') {
      if (inp.rawHit('Tab') || inp.rawHit('Escape')) this.setState('play');
    }

    if (this.state === 'menu') {
      this.menuCamera(dtReal);
      this.scope.amount = 0;
      this.player.update(0, inp, false);
    } else if (this.bc) {
      this.updateBulletCam(dtReal);
      this.player.update(0, inp, true);
    } else {
      this.fade = damp(this.fade, 0, 2.5, dtReal);
      const pl = this.player;
      const sc = this.scope;
      if (playing) {
        // --- lunette ---
        const wantToggle = inp.click(2) || inp.hit('KeyF');
        if (wantToggle) {
          if (sc.active) sc.exit();
          else if (pl.stance === 'stand') this.ui.toast('Mettez-vous en position', this.touch ? 'Accroupi ou couché pour épauler' : 'Accroupi (C) ou couché (X) pour épauler', 2.2);
          else { sc.enter(pl.yaw, pl.pitch); this.audio.cloth(0.5); }
        }
        if (sc.active && (inp.wantsMove || inp.hit('KeyC') || inp.hit('KeyX'))) sc.exit();
        if (sc.active) {
          if (inp.click(0)) this.fire();
          if (inp.hit('KeyT')) {
            if (this.difficulty === 'real') this.ui.toast('Pas de télémètre', 'Estimez la distance au réticule : taille (m) × 1000 ÷ mils', 3);
            else { this.range = this.losDistance(pl.eye(this.v1), sc.lineOfSight(this.v2)); this.rangeT = 8; this.audio.rangefinder(); this.tutoRanged = true; this.coachRange = { v: this.range, step: this.mission.step.id }; }
          }
        } else if (inp.click(0)) this.ui.toast('Épaulez d’abord', 'Clic droit, accroupi ou couché', 1.8);
        if (inp.hit('KeyR')) this.rifle.reload();
        if (inp.hit('KeyE') && this.rackDist() < 3.6) { sc.exit(); this.ui.openRack(this.rifle.def.id); this.audio.ui('page'); this.setState('rack'); }
        if (inp.hit('Tab')) { this.ui.openBook(this.bookData(this.rifle.def), this.mission.log, this.rifle.elevMil, this.rifle.windMil); this.audio.ui('page'); this.setState('book'); }
        if (inp.hit('KeyB')) { sc.exit(); this.ui.setBrief(this.mission.step, this.mission.index, this.difficulty, null); this.setState('brief'); }
        if (inp.hit('KeyH')) this.showFps = !this.showFps;
        if (inp.hit('KeyP')) this.skipTutorial();
        if (this.coach.visible && (inp.hit('Enter') || inp.hit('NumpadEnter'))) this.closeCoach();
      }
      pl.update(dt, inp, sc.active);
      const stab = pl.stance === 'prone' ? 1 : pl.supported ? 1.9 : 4.2;
      sc.update(dt, inp, this.rifle, pl.heartRate, stab);
      if (sc.active) { pl.yaw = sc.yaw; pl.pitch = sc.pitch; }
      this.rifle.update(dt);
      // caméra
      if (sc.amount > 0.5) {
        sc.applyCamera(cam, pl.eye(this.v1), e.scopeFov(this.rifle.zoom));
        e.setNear(this.scopeNear(cam, dtReal));
        scopeCam = true;
      } else {
        pl.applyCamera(cam, dtReal, false, e.view.portrait);
        cam.fov = e.view.baseFov;
        e.setNear(0.2);
        this.nearT = 0;
      }
      cam.updateProjectionMatrix();
      // distance visée : mise au point, cascades d'ombre, mirage
      this.aimT -= dtReal;
      if (sc.active && this.aimT <= 0) {
        this.aimT = 0.25;
        this.aimDist = this.losDistance(pl.eye(this.v1), sc.lineOfSight(this.v2));
        if (this.difficulty === 'assist') { this.range = this.aimDist < this.data.rangeLimit - 10 ? this.aimDist : null; this.rangeT = 1; }
      }
      this.rangeT -= dtReal;
      if (this.rangeT <= 0) this.range = null;
      // point d'impact prédit (assisté)
      this.predT -= dtReal;
      if (sc.active && this.difficulty === 'assist' && this.predT <= 0) {
        this.predT = 0.12;
        const eye = pl.eye(this.v1), los = sc.lineOfSight(this.v2);
        // le vol prédit est celui du tir réel : traînée de l'arme et tous les effets que le niveau active
        const p = this.shots.predict(eye, los, this.rifle.def, this.rifle.elevMil, this.rifle.windMil, true, this.maxFlight());
        if (p) {
          const d = p.point.clone().sub(eye);
          const right = new Vector3().crossVectors(los, new Vector3(0, 1, 0)).normalize();
          const up = new Vector3().crossVectors(right, los);
          const z = d.dot(los);
          this.predMil = z > 1 ? { x: (d.dot(right) / z) * 1000, y: (d.dot(up) / z) * 1000 } : null;
        } else this.predMil = null;
      }
      if (!sc.active || this.difficulty !== 'assist') this.predMil = null;
    }

    // --- monde ---
    if (this.state !== 'menu' && this.state !== 'pause') this.sky.update(dtReal / 1500);
    this.shots.update(dt);
    for (const b of this.shots.bullets) if (b.alive) this.fx.trailPoint(b.pos);
    for (const t of this.targets.values()) t.update(dt, this.ctx);
    this.mission.update(dt);
    this.sky.follow(cam.position);
    const off = e.atmosphere.u('uWindOff').value;
    off.x -= this.wind.dir.x * this.wind.speedNow * dt * 3;
    off.y -= this.wind.dir.y * this.wind.speedNow * dt * 3;
    if (this.testCam) {
      const c = this.testCam;
      cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(c.look[0], c.look[1], c.look[2]);
      cam.fov = c.fov;
      e.setNear(0.05);
      cam.updateProjectionMatrix();
      scopeCam = false;
    }
    const sc = this.scope;
    const inScopeView = sc.amount > 0.5 && !this.bc && this.state !== 'menu' && !this.forceThirdPerson;
    // portrait : le champ de la lunette est dans la moitié haute ; la projection est décentrée, pas l'image
    e.setScopeOffset(scopeCam && inScopeView);
    cam.updateMatrixWorld();
    const zoomK = e.zoomK();
    this.veg.update(cam, this.player.pos, zoomK, this.scope.amount);
    // bâtiments : niveau complet ou lointain selon la distance apparente (réévalué quatre fois par seconde)
    this.buildings?.update(cam.position, zoomK, dtReal);
    // dans la lunette, les particules à moins de 9 m (fumée et poussière du départ du coup) cèdent la place au voile
    this.fx.nearFade = inScopeView ? 9 : 0;
    this.shotFx.update(dt, !inScopeView, this.rifle.boltPhase, this.rifleParts?.group ?? null, this.rifleParts?.boltRest ?? null, this.player.pos.y);
    this.fx.update(dt, cam, this.sky.sunDir, zoomK, dtReal, (e.view.h * Math.tan((REF_FOV * Math.PI) / 360)) / Math.tan((e.view.baseFov * Math.PI) / 360));

    // --- joueur visible, fusil ---
    this.player.group.visible = !inScopeView;
    this.placeRifle();

    // --- post-traitement lié à la lunette ---
    e.setScopeChain(inScopeView);
    const fin = e.finish, lens = e.lens;
    fin.u('uScopeF').value = inScopeView ? 1 : 0;
    fin.u('uEye').value.set(sc.eyeX, sc.eyeY);
    fin.u('uBlackout').value = inScopeView ? sc.blackout : 0;
    const veil = this.shotFx.veil;
    fin.u('uVeil').value.set(veil.r, veil.g, veil.b, inScopeView ? veil.a : 0);
    fin.u('uFlashF').value = inScopeView ? veil.flash : 0;
    fin.u('uFade').value = this.fade;
    e.shadowFocus = inScopeView ? this.aimDist : 0;
    if (e.dofPass && e.dof) {
      e.dofPass.enabled = inScopeView;
      if (inScopeView) {
        const cm = e.dof.cocMaterial as any;
        cm.adoptCameraSettings(cam);
        cm.focusDistance = damp(cm.focusDistance ?? 500, this.aimDist, 5, dtReal);
        cm.focusRange = this.aimDist * 1.6 + 60;
      }
    }
    if (inScopeView) {
      // mirage : plus fort avec la distance et le grossissement ; il se couche avec le vent traversier
      const lat = this.wind.dir.x * Math.cos(sc.yaw) + this.wind.dir.y * Math.sin(sc.yaw);
      const sp = this.wind.speedNow;
      lens.u('uMirage').value = 0.0011 * Math.min(1, this.aimDist / 900) * Math.min(1.4, this.rifle.zoom / 16) * (0.5 + 0.5 * (1 - this.sky.cycle));
      lens.u('uMirageFlow').value.set(lat * sp * 0.22, Math.max(0.12, 0.6 - Math.abs(lat * sp) * 0.09));
      lens.u('uCA').value = 0.006;
    } else {
      lens.u('uMirage').value = 0;
    }
    const showRet = inScopeView ? 1 : 0;
    if (inScopeView && this.predMil) {
      const ppm = e.pxPerMil(cam.fov);
      this.ui.reticle.predict = { x: this.predMil.x * ppm, y: -this.predMil.y * ppm };
    } else this.ui.reticle.predict = null;
    this.ui.reticle.draw(cam.fov, showRet, e.view);

    // --- son ---
    const pp = this.player.pos;
    this.wind.sample(pp.x, pp.y, pp.z, this.ws);
    cam.getWorldDirection(this.v1);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.v1.x, this.v1.y, this.v1.z);
    // sons propres à la carte (véhicule, drone…) et activité de la foule
    const marketActivity = this.scene.audioFrame?.(this.audio) ?? 0;
    this.audio.update(dtReal, {
      windSpeed: this.ws.speed, gust: this.ws.gust, treeProximity: this.veg.treeProximity(pp.x, pp.z), inScope: inScopeView, heartRate: this.player.heartRate,
      breath: sc.breath, marketActivity, alarm: this.mission.alarm, timeScale: this.state === 'pause' ? 1 : this.timeScale, menu: this.state === 'menu',
    });

    // --- HUD ---
    const h = this.hudState;
    const pl = this.player;
    h.visible = (this.state === 'play' || this.state === 'book' || this.state === 'rack') && !this.bc;
    h.scope = inScopeView;
    h.objective = this.mission.step;
    h.index = this.mission.index;
    h.weapon = this.rifle.def;
    h.mag = this.rifle.mag;
    h.chambered = this.rifle.chambered;
    h.busy = this.rifle.reloadT > 0 ? '· rechargement' : this.rifle.boltT > 0 ? '· verrou' : !this.rifle.chambered ? '· vide' : '';
    h.stance = STANCE_LABEL[pl.stance] + (pl.stance === 'crouch' && pl.supported ? ' · appuyé' : pl.stance === 'prone' ? ' · bipied' : '');
    const post = pl.nearestPost();
    const POSTS = this.data.posts, rack = this.data.site.rack;
    h.post = post ? POSTS[post].label : null;
    h.heading = inScopeView ? sc.yaw : pl.yaw;
    const want = this.mission.step ? this.data.stepPost[this.mission.step.id] : undefined;
    if (want && pl.guideTo(want, this.guide)) {
      const g = this.guide;
      g.label = POSTS[want].label;
      g.arrived = post === want;
      h.guide = g;
    } else h.guide = null;
    // --- tutoriel ---
    const tuto = this.tutorial;
    if (tuto && tuto.active) {
      if (this.state !== 'pause' && this.state !== 'brief' && !this.blocked) this.updateTutorial(tuto, dtReal, inScopeView);
      // étape « changer d'arme » : la boussole mène au râtelier
      if (tuto.stepId === 'rack' && !tuto.view?.done) {
        const g = this.guide;
        const dx = rack.x - pl.pos.x, dz = rack.z - pl.pos.z;
        g.x = rack.x; g.z = rack.z; g.dist = Math.hypot(dx, dz); g.bearing = Math.atan2(dx, -dz); g.hint = ''; g.label = 'Râtelier'; g.arrived = g.dist < 3.6;
        h.guide = g;
      }
      if (tuto.finished && !tuto.skipped && this.tutoPref !== 'done') this.setTutoPref('done');
    }
    this.ui.tuto(tuto && tuto.active ? tuto.view : null, this.state);
    // portrait : la carte du tutoriel se loge au-dessus du champ de la lunette, qui descend d'autant
    if (e.view.portrait && (this.ui.tutoRev !== this.tutoRev || inScopeView !== this.scopeWas)) { this.scopeWas = inScopeView; this.tutoRev = this.ui.tutoRev; e.updateView(); }
    h.heart = pl.heartRate;
    h.air = sc.air;
    h.breath = sc.breath;
    h.zoom = this.rifle.zoom;
    h.elev = this.rifle.elevMil;
    h.wind = this.rifle.windMil;
    h.range = this.difficulty === 'real' ? null : this.range;
    // contre-visée : la correction connue (distance mesurée) dépasse la course de la tourelle, ou la tourelle est en butée
    h.hold = '';
    if (inScopeView) {
      const tmax = this.rifle.def.turretMaxMil;
      const need = h.range !== null ? this.tableElev(this.rifle.def, h.range) : 0;
      if (need > tmax + CLICK_MIL / 2) h.hold = `+ ${fr(need - tmax, 1)} mrad`;
      else if (this.rifle.elevMil >= tmax - CLICK_MIL / 2) h.hold = 'butée';
    }
    h.rangeFlat = this.range !== null ? this.range * Math.cos(sc.pitch) : null;
    h.windSpeed = this.difficulty === 'real' ? null : this.ws.speed;
    h.windRel = Math.atan2(this.wind.dir.x, -this.wind.dir.y) - sc.yaw;
    h.alert = this.mission.alert;
    h.alarm = this.mission.alarm;
    h.fps = this.fpsAvg;
    h.showFps = this.showFps;
    let prompt = '';
    if (this.state === 'play') {
      if (inScopeView) {
        if (!this.rifle.chambered && this.rifle.mag === 0 && this.rifle.reloadT <= 0 && this.rifle.boltT <= 0) prompt = this.touch ? 'Chargeur vide · <b>Recharger</b>' : '<b>R</b> Recharger';
        else if (sc.breath === 'gasping') prompt = 'À bout de souffle';
      } else if (this.touch) prompt = ''; // au doigt, les boutons eux-mêmes tiennent lieu d'invites
      else if (this.rackDist() < 3.6) prompt = '<b>E</b> Râtelier';
      else if (pl.stance !== 'stand' && !pl.moving) prompt = '<b>Clic droit</b> Épauler';
      else if (this.mission.index === 0 && this.gameTime < 60 && !(tuto && tuto.active)) prompt = '<b>C</b> accroupi · <b>X</b> couché · <b>Tab</b> carnet';
    }
    h.prompt = prompt;
    this.ui.hud(h, dtReal);
    // --- commandes tactiles ---
    if (this.touchCtl) {
      const f = this.touchFrame;
      const r = this.rifle;
      f.play = this.state === 'play' && !this.blocked;
      f.bulletCam = !!this.bc;
      f.scope = sc.active;
      f.stance = pl.stance;
      f.nearRack = this.rackDist() < 3.6;
      // chargeur plein (une cartouche chambrée, le reste dans le chargeur) : rien à recharger
      f.canReload = r.reloadT <= 0 && r.mag < r.def.magazine && !(r.chambered && r.mag >= r.def.magazine - 1);
      f.canRange = this.difficulty !== 'real';
      f.zoom = r.zoom;
      f.elev = r.elevMil;
      f.wind = r.windMil;
      f.hold = h.hold;
      f.halo = tuto && tuto.active && tuto.view ? tuto.view.halo : [];
      f.portrait = e.view.portrait;
      // chargeur vide en lunette : le bouton Recharger s'éclaire (en portrait, pas d'invite sur le champ)
      if (sc.active && !r.chambered && r.mag === 0 && r.reloadT <= 0 && r.boltT <= 0) f.halo = [...f.halo, 'reload'];
      this.touchCtl.update(f);
    }
  }

  /** distance du joueur au râtelier (m) */
  private rackDist(): number {
    const r = this.data.site.rack, p = this.player.pos;
    return Math.hypot(p.x - r.x, p.z - r.z);
  }

  /** Élévation du carnet pour l'arme en main à la distance donnée (mrad, au clic près). */
  private tableElev(def: WeaponDef, dist: number): number {
    const env = this.benv;
    // physique avancée : l'élévation dépend un peu de l'azimut (Coriolis), arrondi à 15° pour le cache
    const az = env ? Math.round(this.aimBearing() / 15) * 15 : 0;
    const key = def.id + ':' + Math.round(dist) + ':' + az;
    let v = this.tutoNeed.get(key);
    if (v === undefined) {
      const e = env
        ? firingSolution(def, { range: Math.round(dist), azimuthDeg: az, env, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })?.elevMil ?? 0
        : ballisticTable(def, { zero: def.zero, sightHeight: SIGHT_HEIGHT, crosswind: 5, ranges: [Math.round(dist)], air: GAME_AIR })[0]?.elevMil ?? 0; // hors de portée : pas de ligne
      v = Math.max(0, Math.round(e * 10) / 10);
      if (this.tutoNeed.size > 200) this.tutoNeed.clear();
      this.tutoNeed.set(key, v);
    }
    return v;
  }

  private updateTutorial(tuto: Tutorial, dtReal: number, inScope: boolean): void {
    const pl = this.player, sc = this.scope, r = this.rifle;
    const s = this.tutoSnap;
    const eye = pl.eye(this.v1);
    // direction visée, sans le tremblement : le joueur vise la plaque, il ne la tient pas au millième
    const los = this.v2.set(Math.sin(sc.yaw) * Math.cos(sc.pitch), Math.sin(sc.pitch), -Math.cos(sc.yaw) * Math.cos(sc.pitch));
    const T = this.data.tutorial!;
    const p1 = this.targets.get(T.near)!, p2 = this.targets.get(T.far)!;
    const a1 = p1.aimPoint(this.v3);
    s.dist1 = a1.distanceTo(eye);
    s.aimErr1 = inScope ? a1.sub(eye).normalize().angleTo(los) * 1000 : 1e6;
    const a2 = p2.aimPoint(this.v3);
    s.dist2 = a2.distanceTo(eye);
    s.aimErr2 = inScope ? a2.sub(eye).normalize().angleTo(los) * 1000 : 1e6;
    // les distances annoncées sont celles du poste de tir, pas celles de l'endroit où se trouve le joueur
    const post = this.data.posts[T.post], baseY = this.data.site.baseY;
    const g1 = p1.group.position, g2 = p2.group.position;
    const d1 = Math.hypot(g1.x - post.x, g1.z - post.z, g1.y - baseY);
    const d2 = Math.hypot(g2.x - post.x, g2.z - post.z, g2.y - baseY);
    if (pl.nearestPost() !== T.post) { s.dist1 = d1; s.dist2 = d2; }
    s.site = T;
    s.dt = dtReal;
    s.touch = this.touch;
    s.portrait = this.engine.view.portrait;
    s.difficulty = this.difficulty;
    s.state = this.state;
    s.yaw = sc.active ? sc.yaw : pl.yaw;
    s.pitch = sc.active ? sc.pitch : pl.pitch;
    s.x = pl.pos.x;
    s.z = pl.pos.z;
    s.post = pl.nearestPost();
    s.stance = pl.stance;
    s.scope = sc.active;
    s.zoom = r.zoom;
    s.range = this.range;
    s.ranged = this.tutoRanged;
    this.tutoRanged = false;
    s.elev = r.elevMil;
    s.breath = sc.breath;
    s.shots = this.mission.totalShots;
    s.reloading = r.reloadT > 0;
    s.weaponId = r.def.id;
    s.caliber = r.def.caliber;
    s.plate1Done = p1.done;
    s.plate2Done = p2.done;
    s.need1 = this.tableElev(r.def, s.dist1);
    s.need2 = this.tableElev(r.def, s.dist2);
    s.windSpeed = this.ws.speed;
    s.rackDist = this.rackDist();
    tuto.update(s);
  }

  private placeRifle(): void {
    const pl = this.player;
    const n = this.rifleNode;
    const parts = this.rifleParts;
    if (!parts) return;
    const aimPose = pl.stance === 'prone' || pl.aiming > 0.4;
    if (aimPose) {
      // devant le tireur, la crosse à son épaule et la lunette devant son œil dans sa pose du moment (shoulderMount) :
      // accroupi ou debout, la lunette est à hauteur d'œil ; couché, les pieds du bipied posent au sol
      if (n.parent !== pl.char.group) pl.char.group.add(n);
      const prone = pl.stance === 'prone';
      const feet = parts.anchors.bipod_feet_l;
      let [hgt, fwd] = shoulderMount(pl.char.rig, parts);
      let pitch = 0;
      if (prone) {
        // sol sous le bipied (pente, marche) : l'arme pivote autour de la crosse, qui reste à l'épaule
        const s = Math.sin(pl.bodyYaw), c = Math.cos(pl.bodyYaw);
        const d = fwd + feet.z;
        const gx = pl.pos.x + s * d + c * 0.09, gz = pl.pos.z - c * d + s * 0.09;
        const g = Math.max(this.terrain.heightAt(gx, gz), this.col.surfaceAt(gx, gz, pl.pos.y)) - pl.pos.y;
        const butt = parts.anchors.butt;
        const shoulder = 0.215;
        // hauteur de l'origine si l'arme était à plat, puis inclinaison pour que les pieds touchent
        const want = Math.min(0.3, Math.max(-0.3, g)) + 0.012 - feet.y;
        pitch = Math.atan2(shoulder - butt.y - want, feet.z - butt.z);
        // bipied au-dessus du vide (bord de dalle, corniche) ou contre un obstacle : hors de portée des pieds, l'arme
        // reste à plat plutôt que de piquer de 11°
        if (Math.abs(pitch) > 0.2) pitch = Math.atan2(shoulder - butt.y - (0.012 - feet.y), feet.z - butt.z);
        pitch = Math.min(0.2, Math.max(-0.2, pitch));
        hgt = shoulder - butt.y + Math.sin(pitch) * butt.z;
      }
      n.position.set(-0.09, damp(n.position.y, hgt, 12, 0.016), damp(n.position.z, fwd, 12, 0.016));
      n.rotation.set(damp(n.rotation.x, pitch, 12, 0.016), 0, 0);
      parts.bipod.visible = prone;
    } else {
      // en bandoulière dans le dos, canon vers le haut, lunette vers l'arrière
      const spine = pl.char.rig.spine;
      if (n.parent !== spine) spine.add(n);
      const mid = (parts.anchors.butt.z + parts.anchors.muzzle.z) / 2;
      n.position.set(0.09 + Math.sin(0.55) * (mid - 0.1), 0.24 - Math.cos(0.55) * (mid - 0.1), -0.2);
      n.rotation.set(-Math.PI / 2 + 0.1, 0, 0.55);
      parts.bipod.visible = false;
    }
    // recul du coup de feu : l'arme part en arrière et se cabre, le bipied saute, le buste encaisse. Appliqué au modèle
    // (pas à son nœud, que le jeu amortit) et avant l'ancrage des mains, qui suivent donc l'arme dans la même image.
    const kick = this.shotFx.kick;
    parts.group.position.set(0, aimPose ? kick.hop : 0, aimPose ? -kick.back : 0);
    parts.group.rotation.x = aimPose ? -kick.rise : 0;
    if (aimPose && kick.body !== 0) {
      const rig = pl.char.rig;
      rig.spine.rotation.x -= 0.05 * kick.body * (pl.stance === 'prone' ? 0.5 : 1);
      rig.head.rotation.x -= 0.04 * kick.body;
    }
    // verrou, chargeur (ou cartouche d'une arme à un coup) : animés par src/weapons/handling.ts, qui donne aussi les
    // points de l'arme où vont les mains (poignée, levier de culasse là où il est sur ce modèle, chargeur, fût)
    const hands = handleRifle(parts, this.rifle, pl.stance === 'prone');
    pl.pose.bolt = this.rifle.boltPhase;
    // mains ancrées à l'arme quand elle est devant le tireur immobile ; en bandoulière ou en rampant, pose libre
    const held = aimPose && pl.pose.aim > 0;
    const hs = parts.hands;
    hs.hold = damp(hs.hold, held ? 1 : 0, 14, 0.016);
    if (hs.hold > 0.001) {
      const rig = pl.char.rig, grp = parts.group;
      grp.updateWorldMatrix(true, false);
      rig.reach('R', grp.localToWorld(hands.right), hs.hold);
      // main gauche : sous le fût (accroupi, debout) ou sous le talon de la crosse (couché) ; elle va au chargeur le temps de le changer
      rig.reach('L', grp.localToWorld(hands.left.lerp(hands.leftMag, hands.magW)), hs.hold);
    }
  }

  // ------------------------------------------------------------------ outils de test automatisé
  /**
   * Studio (tests, e2e/rifles.mjs) : isole une arme devant un fond neutre, loin de la scène, et renvoie ses cotes
   * mesurées (boîte englobante), ses appels de dessin et ses triangles. `id` nul : retour au jeu.
   */
  studio(id: string | null, lod: 0 | 1 = 0, bipod = true, sunFrom = -Math.PI / 4): { center: number[]; size: number[]; length: number; barrel: number; nominal: number; calls: number; tris: number; anchors: Record<string, number[]> } | null {
    const scene = this.engine.scene;
    if (this.studioGroup) { scene.remove(this.studioGroup); this.studioGroup = null; }
    for (const o of this.studioHidden) o.visible = true;
    this.studioHidden = [];
    if (!id) { this.testCam = null; return null; }
    for (const o of scene.children) if (o.visible && !(o as any).isLight && o.type !== 'Object3D') { o.visible = false; this.studioHidden.push(o); }
    const g = new Group();
    g.position.set(0, this.data.site.baseY + 40, 0);
    const back = new Mesh(new SphereGeometry(7, 24, 16), new MeshBasicMaterial({ color: 0x8f9396, side: BackSide }));
    const m = buildRifleModel(this.engine, weaponById(id), lod);
    m.bipod.visible = bipod;
    g.add(back, m.group);
    scene.add(g);
    this.studioGroup = g;
    // cotes mesurées dans le repère de l'arme
    m.group.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert();
    const box = new Box3();
    let calls = 0, tris = 0;
    m.group.traverseVisible((o) => {
      const me = o as Mesh;
      if (!me.isMesh) return;
      calls++;
      tris += me.geometry.getAttribute('position').count / 3;
      box.union(new Box3().setFromObject(me).applyMatrix4(inv));
    });
    // le soleil du jeu sert d'éclairage : on tourne le studio pour qu'il arrive de trois quarts (sunFrom, dans le repère de l'arme)
    const sd = this.sky.sunDir;
    g.rotation.y = Math.atan2(sd.x, sd.z) - sunFrom;
    g.updateMatrixWorld(true);
    const c = box.getCenter(new Vector3()), sz = box.getSize(new Vector3());
    const anchors: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(m.anchors)) anchors[k] = [v.x, v.y, v.z];
    return { center: [c.x, c.y, c.z], size: [sz.x, sz.y, sz.z], length: sz.z, barrel: m.info.barrel, nominal: m.info.length, calls, tris, anchors };
  }
  /** Caméra du studio, exprimée dans le repère de l'arme isolée. */
  studioCam(pos: [number, number, number], look: [number, number, number], fov = 30): void {
    const g = this.studioGroup;
    if (!g) return;
    const p = g.localToWorld(new Vector3(...pos)), l = g.localToWorld(new Vector3(...look));
    this.testCam = { pos: [p.x, p.y, p.z], look: [l.x, l.y, l.z], fov };
  }

  /**
   * Tests (e2e/physics.mjs) : solution de tir du solveur pour l'arme en main, dans l'environnement du niveau, pour un
   * vent uniforme. C'est le calcul du carnet ; le test lui compare le tir réel.
   */
  testSolution(range: number, bearingDeg: number, heightDiff: number, windSpeed = 0, windFromDeg = 0): { elevMil: number; windMil: number; tof: number; velocity: number; mach: number } | null {
    const s = firingSolution(this.rifle.def, { range, heightDiff, azimuthDeg: bearingDeg, windSpeed, windFromDeg, env: this.benv, air: GAME_AIR, sightHeight: SIGHT_HEIGHT });
    return s && { elevMil: s.elevMil, windMil: s.windMil, tof: s.tof, velocity: s.velocity, mach: s.mach };
  }

  /** Tests : prépare une cible (crochet du niveau), et dit si elle est tirable maintenant. */
  testPrepare(id: string): void {
    this.scene.testPrepare?.(id);
  }
  testReady(id: string): boolean {
    return this.scene.testReady ? this.scene.testReady(id, this.canSee(id)) : true;
  }
  /** La cible est-elle en vue directe depuis la position de tir actuelle ? */
  canSee(id: string): boolean {
    const t = this.targets.get(id)!;
    const eye = this.player.eye(new Vector3());
    const p = t.aimPoint(new Vector3());
    const dir = p.clone().sub(eye);
    const dist = dir.length();
    dir.divideScalar(dist);
    const end = eye.clone().addScaledVector(dir, dist - 0.6);
    if (this.col.segment(eye, end) >= 0) return false;
    return !this.terrain.raycast(eye.x, eye.y, eye.z, end.x, end.y, end.z, new Vector3(), 2);
  }
  /** Vise la cible en compensant chute, vent et déplacement (comme le ferait un tireur parfait). */
  autoAim(id: string): { dist: number; tof: number; visible: boolean } {
    const t = this.targets.get(id)!;
    const eye = this.player.eye(new Vector3());
    const def = this.rifle.def;
    const aim = t.aimPoint(new Vector3());
    let want = aim.clone();
    let yaw = Math.atan2(aim.x - eye.x, -(aim.z - eye.z));
    let pitch = Math.asin((aim.y - eye.y) / aim.distanceTo(eye));
    let tof = 0;
    const got = new Vector3(), los = new Vector3();
    for (let it = 0; it < 8; it++) {
      los.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const dist = want.distanceTo(eye);
      tof = this.shots.flyTo(eye, los, def, this.rifle.elevMil, this.rifle.windMil, dist, got);
      want = t.predict(tof, new Vector3());
      const right = new Vector3().crossVectors(los, new Vector3(0, 1, 0)).normalize();
      const up = new Vector3().crossVectors(right, los);
      const err = want.clone().sub(got);
      yaw += err.dot(right) / dist;
      pitch += err.dot(up) / dist;
    }
    this.scope.yaw = yaw;
    this.scope.pitch = pitch;
    this.player.yaw = this.player.bodyYaw = yaw;
    return { dist: aim.distanceTo(eye), tof, visible: this.canSee(id) };
  }
  /**
   * Tests et captures : règle les tourelles pour la cible comme le ferait le tireur avec son carnet (élévation dans
   * la limite de la course de tourelle, le reste en contre-visée ; dérive), puis vise. La cible reste ainsi dans le
   * champ de la lunette à toutes les distances : tourelle à zéro, elle en sort au-delà de 1 500 m.
   */
  testDial(id: string): { dist: number; tof: number; visible: boolean } {
    const r = this.rifle;
    r.elevClicks = 0;
    r.windClicks = 0;
    this.autoAim(id);
    const eye = this.player.eye(new Vector3());
    const a = this.targets.get(id)!.aimPoint(new Vector3());
    const gp = Math.asin((a.y - eye.y) / a.distanceTo(eye)), gy = Math.atan2(a.x - eye.x, -(a.z - eye.z));
    const needE = (this.scope.pitch - gp) * 1000, needW = (this.scope.yaw - gy) * 1000 * Math.cos(gp);
    r.elevClicks = Math.min(Math.round(r.def.turretMaxMil / CLICK_MIL), Math.max(0, Math.round(needE / CLICK_MIL)));
    r.windClicks = Math.min(100, Math.max(-100, Math.round(needW / CLICK_MIL)));
    return this.autoAim(id);
  }
  /** Tir parfaitement stable (tests) : annule le tremblement le temps du départ du coup. */
  steadyFire(): boolean {
    this.scope.swayX = this.scope.swayY = this.scope.kickX = this.scope.kickY = 0;
    const n = this.rifle.shotsFired;
    this.fire();
    return this.rifle.shotsFired > n;
  }
}
