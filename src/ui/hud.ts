// Interface : menu, briefing, HUD, râtelier, carnet de tir, pause, échec, score final. DOM pur, sans bibliothèque.
import type { BallisticEnv } from '../ballistics/environment';
import type { DragModel, TableRow } from '../ballistics/solver';
import { recoilVelocity, type WeaponDef } from '../config/weapons';
import { QUALITY, type QualityName } from '../core/engine';
import { DIFFICULTY_LABEL, DIFFICULTY_NOTE, type Difficulty, type Mission, type ShotLog, type Step, type StepStats } from '../game/mission';
import { BOARD_SIZE, HOME_SIZE, NAME_MAX, cleanName, escapeHtml, rankOf, type ScoreBoards, type ScoreEntry, type ScoreResult, type SubmitOutcome } from '../game/scores';
import type { LevelEntry } from '../levels';
import type { LevelId } from '../levels/types';
import { Reticle } from '../weapons/scope';
import type { TutoView } from '../game/tutorial';
import type { Advice } from '../game/coach';
import { touchHelpHtml } from './touch';

export type ScreenName = 'loading' | 'menu' | 'brief' | 'pause' | 'fail' | 'end' | 'rack' | 'book' | 'help' | 'scores';

export interface UIHandlers {
  start(): void;
  resume(): void;
  restart(): void;
  retry(): void;
  /** choix d'un autre niveau au menu (recharge la page) */
  setLevel(id: LevelId): void;
  setQuality(q: QualityName): void;
  setVolume(v: number): void;
  pickWeapon(id: string): void;
  turret(kind: 'elev' | 'wind', n: number): void;
  continueBrief(): void;
  hover(): void;
  /** ferme le râtelier ou le carnet (bouton « Fermer », écrans tactiles) */
  close(): void;
  /** choix « Avec le tutoriel » / « Sans » */
  setTutorial(on: boolean): void;
  skipTutorial(): void;
  fullscreen(): void;
  /** réglage « Conseils : avec / sans » */
  setCoach(on: boolean): void;
  /** le joueur ferme le conseil affiché */
  closeCoach(): void;
  /** inscrit le score de la mission terminée sous ce nom */
  submitScore(name: string): Promise<SubmitOutcome>;
  /** vide le classement local de ce navigateur */
  clearLocalScores(): void;
}

/** Ce que l'écran de fin sait du classement du niveau joué. */
export interface EndRanking {
  /** titre du niveau (« Facile ») */
  title: string;
  /** faux : partie d'essai (mode test, aides forcées, objectifs sautés), le score n'est pas classé */
  ranked: boolean;
  board: ScoreEntry[];
  online: boolean;
  lastName: string;
  result: ScoreResult;
}

export interface HudState {
  visible: boolean;
  scope: boolean;
  objective: Step | null;
  index: number;
  weapon: WeaponDef | null;
  mag: number;
  chambered: boolean;
  busy: string;
  stance: string;
  post: string | null;
  /** cap du regard (rad, 0 = nord, sens horaire) */
  heading: number;
  /** poste conseillé : relèvement du prochain point de passage, distance de marche */
  guide: { label: string; hint: string; bearing: number; dist: number; arrived: boolean } | null;
  prompt: string;
  heart: number;
  air: number;
  breath: string;
  zoom: number;
  elev: number;
  wind: number;
  range: number | null;
  rangeFlat: number | null;
  /** contre-visée à afficher en lunette : « + 4,2 mrad », « butée », ou vide */
  hold: string;
  windSpeed: number | null;
  /** direction d'où vient le vent, relative à la visée (rad, 0 = de face, sens horaire) */
  windRel: number;
  alert: number;
  alarm: boolean;
  fps: number;
  showFps: boolean;
}

const fr = (n: number, d = 0): string => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** rang en toutes lettres courtes : « 1er », « 2e » */
const ord = (n: number): string => (n === 1 ? '1er' : n + 'e');
/** durée courte : « 6 min 04 » */
const dur = (s: number): string => `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')}`;
const modeLabel = (online: boolean): string => (online ? 'en ligne' : 'local à cet appareil');
/**
 * Une ligne de classement. Le nom est nettoyé à la lecture (lettres, chiffres, espace, tiret) et échappé ici :
 * il n'entre jamais tel quel dans la page. `full` : colonnes de l'écran de fin (tirs, durée).
 */
const boardRow = (e: { name: string; score: number; accuracy: number; shots: number; time: number }, rank: number, full: boolean, me = false): string =>
  `<li class="${me ? 'me' : ''}"><span class="rk">${rank}</span><span class="nm">${escapeHtml(e.name) || '—'}</span><span class="sc">${fr(e.score)}</span><span class="ac">${fr(e.accuracy * 100)} %</span>${full ? `<span class="xs">${e.shots} tir${e.shots > 1 ? 's' : ''}</span><span class="xt">${dur(e.time)}</span>` : ''}</li>`;

/** Une ligne du carnet décomposé (corrections en mrad ; positif = monter, ou corriger à droite). */
export interface BookRow {
  range: number;
  /** élévation sans vent : chute + Coriolis vertical ; part réglée à la tourelle, part restant en contre-visée (0 si la tourelle suffit) */
  elev: number;
  dial: number;
  hold: number;
  drop: number;
  coriolisV: number;
  /** dérive sans vent : dérive gyroscopique + Coriolis horizontal */
  windage: number;
  spin: number;
  coriolisH: number;
  /** correction pour le vent traversier de référence, en valeur absolue (à prendre du côté d'où vient le vent) */
  wind: number;
  /** saut aérodynamique pour ce même vent venant de la gauche (signe inverse s'il vient de la droite) */
  jump: number;
  tof: number;
  mach: number;
  velocity: number;
  energy: number;
}
/** Ce que le carnet de tir affiche pour une arme. `flat` : table d'origine (physique neutre) ; `adv` : table décomposée. */
export interface BookData {
  def: WeaponDef;
  /** modèle de traînée et coefficient balistique réellement utilisés par le vol */
  drag: DragModel;
  bc: number;
  /** vent traversier de référence, m/s */
  wind: number;
  /** course de la tourelle d'élévation, et élévation accessible en contre-visée au réticule, mrad */
  turretMax: number;
  holdMax: number;
  flat: TableRow[] | null;
  adv: {
    /** azimut de tir pour lequel la table est calculée, degrés */
    azimuth: number;
    env: BallisticEnv;
    /** stabilité gyroscopique, vitesse initiale effective (m/s), masse volumique de l'air au poste (kg/m³) */
    sg: number;
    v0: number;
    rho: number;
    /** distance du passage sous Mach 1,2 puis sous Mach 1 (m) ; null si hors de portée */
    transonic: number | null;
    subsonic: number | null;
    rows: BookRow[];
  } | null;
}

const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
/** correction signée, au dixième : « +0,3 », « −0,1 », « 0,0 » */
const sg1 = (v: number): string => (Math.abs(v) < 0.05 ? '0,0' : (v > 0 ? '+' : '−') + fr(Math.abs(v), 1));
/** dérive : « D 0,3 » (à droite), « G 0,1 » (à gauche), « 0,0 » */
const lr1 = (v: number): string => (Math.abs(v) < 0.05 ? '0,0' : (v > 0 ? 'D ' : 'G ') + fr(Math.abs(v), 1));
const KEYS: [string, string][] = [
  ['Se déplacer', 'Z Q S D  (W A S D)'], ['Regarder', 'Souris'], ['Courir', 'Maj gauche'], ['Accroupi', 'C'], ['Couché', 'X'], ['Se relever', 'Espace'],
  ['Épauler / quitter la lunette', 'Clic droit ou F'], ['Tirer', 'Clic gauche'], ['Retenir son souffle', 'Espace ou Maj'], ['Grossissement', 'Molette'],
  ['Tourelle d’élévation', '↑ ↓  (0,1 mrad)'], ['Tourelle de dérive', '← →  (0,1 mrad)'], ['Télémètre', 'T'], ['Recharger', 'R'],
  ['Râtelier (changer d’arme)', 'E'], ['Au râtelier : choisir', '1 à 9, 0…  ou ↑ ↓'], ['Carnet de tir', 'Tab'], ['Briefing', 'B'], ['Pause', 'Échap'],
];

/** px par degré de la bande de boussole ; la fenêtre montre ±45° */
const C_PX = 4;
const C_HALF = 45;
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
function compassStrip(): string {
  let h = '';
  for (let d = -90; d <= 450; d += 5) {
    const m = ((d % 360) + 360) % 360;
    const x = (d + 90) * C_PX;
    if (m % 45 === 0) h += `<b class="${m % 90 === 0 ? 'c4' : ''}" style="left:${x}px">${CARD[m / 45]}</b>`;
    else if (m % 15 === 0) h += `<b class="num" style="left:${x}px">${m}</b>`;
    h += `<i class="${m % 15 === 0 ? 'maj' : ''}" style="left:${x}px"></i>`;
  }
  return h;
}

export interface UIInit {
  /** aides au tir en vigueur (préréglage du niveau, ou `?d=`) */
  difficulty: Difficulty;
  quality: QualityName;
  volume: number;
  touch?: boolean;
  tutorial?: boolean;
  /** conseils après plusieurs tirs manqués */
  coach?: boolean;
  fullscreen?: boolean;
  homeTip?: boolean;
  /** les trois niveaux du registre, et celui qui est chargé */
  levels: LevelEntry[];
  level: LevelId;
  /** objectifs du niveau chargé */
  steps: Step[];
  /** armes de son râtelier */
  weapons: WeaponDef[];
  /** le niveau a un tutoriel */
  hasTutorial: boolean;
  /** libellé de la jauge d'alerte, ou null si la carte n'a pas de zone d'alerte */
  alertLabel: string | null;
  /** phrases de l'alerte propres à la carte (voir LevelData.alertTexts) */
  alertTexts?: { endRaised?: string; endQuiet?: string };
  failNote: string;
}

export class UI {
  reticle: Reticle;
  private steps: Step[];
  /** la carte a une zone d'alerte (jauge, ligne « Discrétion » du bilan) */
  private alertRow = true;
  private alertTexts: { endRaised?: string; endQuiet?: string };
  private weapons: WeaponDef[];
  private el: Record<string, HTMLElement> = {};
  private screens = new Map<ScreenName, HTMLElement>();
  private last: Record<string, string> = {};
  private toastT = 0;
  current: ScreenName | null = 'loading';

  /** appareil tactile : équivalents tactiles à la place des touches, schéma des commandes tactiles */
  touch: boolean;

  constructor(private root: HTMLElement, private h: UIHandlers, init: UIInit) {
    const touch = (this.touch = !!init.touch);
    this.steps = init.steps;
    this.weapons = init.weapons;
    this.rackSel = init.weapons[0].id;
    this.alertRow = init.alertLabel !== null;
    this.alertTexts = init.alertTexts ?? {};
    const cur = init.levels.find((l) => l.id === init.level)!;
    this.reticle = new Reticle(root);
    const boardCols = init.levels.map((l) => `<section class="board-col${l.id === init.level ? ' cur' : ''}"><h3>${l.meta.title}</h3><ol class="board" data-board="${l.id}"><li class="none">Aucun score</li></ol></section>`).join('');
    root.insertAdjacentHTML(
      'beforeend',
      `
      <div id="hud">
        <div class="tl obj"><div class="k" data-id="objK"></div><div class="t" data-id="objT"></div><div class="z" data-id="objZ"></div></div>
        <div class="tr stat">
          <div data-id="alertRow"><span class="lb">${init.alertLabel ?? ''}</span> <span class="gauge" data-id="alertG"><i></i></span></div>
          <div class="scope-ui" data-id="scopeTR">
            <div data-id="rangeRow"><span class="lb">Distance</span> <b data-id="range">—</b></div>
            <div data-id="windRow"><span class="lb">Vent</span> <b data-id="windV">—</b><span class="windrose"><i data-id="windA"></i></span></div>
          </div>
          <div data-id="fps" class="hidden"></div>
        </div>
        <div class="bl stat">
          <div class="big" data-id="wName"></div>
          <div class="ammo"><span data-id="wCal"></span><i class="sep"> · </i><span class="am"><b data-id="wMag"></b> <span data-id="wBusy"></span></span></div>
          <div data-id="stance"></div>
        </div>
        <div class="br stat scope-ui" data-id="scopeBR">
          <div class="r-tur">Élévation <b data-id="elev"></b> mrad</div>
          <div class="r-tur r-hold hidden" data-id="holdRow">Contre-visée <b class="hold" data-id="hold"></b></div>
          <div class="r-tur">Dérive <b data-id="windT"></b> mrad</div>
          <div class="r-tur">Grossissement <b data-id="zoom"></b></div>
          <div class="r-vit">Pouls <b data-id="heart"></b></div>
          <div class="r-vit">Souffle <span class="gauge" data-id="airG"><i></i></span></div>
        </div>
        <div class="bc"><div class="prompt" data-id="prompt"></div></div>
        <div class="tc"><div class="toast" data-id="toast"></div></div>
        <div class="compass" data-id="compass">
          <div class="tape"><div class="strip" data-id="cStrip">${compassStrip()}</div><i class="mark" data-id="cMark"></i></div>
          <div class="needle"></div>
          <div class="way" data-id="cWay"><span class="arrow" data-id="cArrow"></span><span data-id="cLabel"></span></div>
        </div>
        <div class="tuto hidden" data-id="tuto">
          <div class="tuto-k"><span data-id="tutoK"></span><button class="tuto-skip" data-act="skipTuto">${touch ? 'Passer' : '<b>P</b> Passer le tutoriel'}</button></div>
          <div class="tuto-t" data-id="tutoT"></div>
          <div class="tuto-x" data-id="tutoX"></div>
          <div class="tuto-c" data-id="tutoC"></div>
        </div>
        <div class="coach scroll hidden" data-id="coach" role="status">
          <div class="coach-k"><span>Conseil</span>${touch ? '<button class="coach-x" data-act="closeCoach" aria-label="Fermer le conseil">Fermer</button>' : '<i data-id="coachClose"></i>'}</div>
          <div class="coach-t" data-id="coachT"></div>
          <div class="coach-s" data-id="coachS"></div>
          <div class="coach-full">
            <p class="coach-d" data-id="coachD"></p>
            <p class="coach-w" data-id="coachW"></p>
            <ol data-id="coachL"></ol>
            <p class="coach-c" data-id="coachC"></p>
          </div>
        </div>
      </div>
      <div class="letterbox" data-id="letterbox"></div>

      <div class="screen on" id="loading"><h1 class="title"><span class="struck"><s>FAU</s><span class="at"><span class="pin"><em class="fix">Pigeon</em></span></span><s>CON</s></span> <span>PERCHÉ</span></h1><p data-id="loadT">Chargement</p><div class="bar"><i data-id="loadB"></i></div></div>

      <div class="screen veil scroll" id="menu">
        <h1 class="title"><span class="struck"><s>FAU</s><span class="at"><span class="pin"><em class="fix">Pigeon</em></span></span><s>CON</s></span> <span>PERCHÉ</span></h1>
        <div class="sub"><span>Tir de précision</span><i> · </i><span>${cur.meta.tagline}</span></div>
        <div class="menu-list${init.fullscreen ? '' : ' no-fs'}">
          <button class="mbtn primary m-start" data-act="start">Commencer</button>
          <div class="opt o-diff"><span>Niveau</span><div class="seg" data-id="segLevel"></div></div>
          <div class="opt-note" data-id="diffNote"></div>
          <div class="opt o-qual"><span>Qualité</span><div class="seg" data-id="segQual"></div></div>
          <div class="opt o-vol"><span>Volume</span><input type="range" min="0" max="100" data-id="vol" /></div>
          <div class="opt-pair">
            <div class="opt o-tuto" data-id="tutoRow"><span>Tutoriel</span><div class="seg" data-id="segTuto"></div></div>
            <div class="opt o-coach"><span>Conseils</span><div class="seg" data-id="segCoach"></div></div>
          </div>
          <button class="mbtn m-help" data-act="help">Commandes</button>
          <button class="mbtn m-scores" data-act="scores">Scores</button>
          ${init.fullscreen ? '<button class="mbtn m-fs" data-act="fullscreen">Plein écran</button>' : ''}
        </div>
        <div class="foot">${touch ? 'Jouez au casque.' : 'Jouez au casque. Clic pour capturer la souris, Échap pour la libérer.'}${init.homeTip ? `<span class="hometip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>Sans les barres de Safari : <i>Partager</i>, puis <i>Sur l’écran d’accueil</i>.</span>` : ''}</div>
        <div class="boards"><div class="boards-h"><span>Meilleurs scores</span><i data-mode></i></div><div class="boards-g">${boardCols}</div></div>
      </div>

      <div class="screen veil" id="brief"><div class="card scroll" data-id="briefCard"></div></div>

      <div class="screen veil-full" id="help"><div class="card wide scroll"><div class="kicker">Commandes${touch ? '<button class="xclose" data-act="closeHelp">Retour</button>' : ''}</div>${touch ? `<h2>Écran tactile</h2>
        ${touchHelpHtml()}
        <p class="help-note" style="color:var(--dim)">Les boutons n’apparaissent que lorsqu’ils servent. Tourelles : un appui donne un clic de 0,1 mrad, un appui maintenu les enchaîne ; −1, +1, G1 et D1 donnent 1 mrad. On n’épaule que couché ou accroupi.</p>` : `<h2>Clavier et souris</h2>
        <div class="keys">${KEYS.map(([a, b]) => `<div><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div>
        <p style="color:var(--dim)">Les touches sont lues par position : ZQSD sur un clavier français, WASD sur un clavier anglais. On ne peut épauler que couché (bipied) ou accroupi ; accroupi contre un mur, l’arme est appuyée et tremble moins.</p>`}
        <div class="local-scores hidden" data-id="localRow"><span data-id="localT"></span><button data-act="clearLocal" data-id="localB">Effacer</button></div>
        <div class="row-btn help-back"><button class="mbtn" data-act="closeHelp">Retour</button></div></div></div>

      <div class="screen veil-full" id="scores"><div class="card scroll"><div class="kicker">Meilleurs scores<button class="xclose" data-act="closeScores">Retour</button></div>
        <div class="boards-g">${boardCols}</div>
        <p class="boards-note">Les cinq premiers de chaque niveau. Classement <span data-mode></span>.</p>
        <div class="row-btn help-back"><button class="mbtn" data-act="closeScores">Retour</button></div></div></div>

      <div class="screen veil-full" id="pause"><div class="card scroll"><div class="kicker">Pause</div><h2 class="title small"><span class="struck"><s>Fau</s><span class="at"><span class="pin"><em class="fix">Pigeon</em></span></span><s>con</s></span> perché</h2>
        <div class="opt"><span>Qualité</span><div class="seg" data-id="segQual2"></div></div>
        <div class="opt"><span>Volume</span><input type="range" min="0" max="100" data-id="vol2" /></div>
        <div class="menu-list" style="margin-top:18px">
          <button class="mbtn primary" data-act="resume">Reprendre</button>
          <button class="mbtn" data-act="help">Commandes</button>
          <button class="mbtn hidden" data-act="skipTuto" data-id="pauseSkip">Passer le tutoriel</button>
          <button class="mbtn" data-act="restart">Recommencer la mission</button>
        </div></div></div>

      <div class="screen veil-full" id="rack"><div class="card wide panel"><div class="kicker">Râtelier${touch ? '<button class="xclose" data-act="close">Fermer</button>' : ''}</div><h2>Choisir une carabine</h2>
        <div class="tuto-inline hidden" data-id="tutoRack"></div>
        <div class="rack-grid"><div class="wlist scroll" data-id="wlist"></div><div class="wdetail scroll" data-id="wdetail"></div></div>
        <div class="row-btn">${touch ? '<button class="mbtn primary" data-act="take">Prendre cette arme</button>' : `<span class="hint"><b>Clic</b>, <b>${init.weapons.length > 9 ? '1–9, 0' + (init.weapons.length > 10 ? ' et les touches suivantes' : '') : '1–' + init.weapons.length}</b> ou <b>↑ ↓</b> pour choisir · <b>Entrée</b> pour prendre · <b>E</b> pour fermer</span>`}</div></div></div>

      <div class="screen veil-full" id="book"><div class="card wide panel"><div class="kicker">Carnet de tir${touch ? '<button class="xclose" data-act="close">Fermer</button>' : ''}</div><h2 data-id="bookT"></h2>
        <div class="tuto-inline hidden" data-id="tutoBook"></div>
        <div class="book-sub" data-id="bookS"></div>
        <div class="book-grid" data-id="bookG"><div class="scroll"><table class="dope" data-id="dope"></table><div class="dope-list" data-id="dopeL"></div><div class="book-notes" data-id="bookN"></div></div>
        <div class="scroll"><div class="turrets">
          <div class="turret"><small>Élévation</small><output data-id="bElev"></output><div class="tbtns"><button data-tur="elev:-10">−1</button><button data-tur="elev:-1">−</button><button data-tur="elev:1">+</button><button data-tur="elev:10">+1</button></div></div>
          <div class="turret"><small>Dérive</small><output data-id="bWind"></output><div class="tbtns"><button data-tur="wind:-1">G</button><button data-tur="wind:1">D</button></div></div>
        </div>
        <div class="kicker" style="margin-bottom:6px">Derniers tirs</div><div class="loglist" data-id="blog"></div></div></div>
        <div class="row-btn"><span class="hint">${touch ? '' : '<b>Tab</b> pour refermer · '}<span data-id="bookH"></span></span></div></div></div>

      <div class="screen veil-full" id="fail"><div class="card scroll"><div class="kicker" style="color:var(--red)">Mission interrompue</div><h2 data-id="failT"></h2>
        <p style="color:var(--dim)">${init.failNote}</p>
        <div class="menu-list"><button class="mbtn primary" data-act="retry">Reprendre l’objectif</button><button class="mbtn" data-act="restart">Recommencer la mission</button></div></div></div>

      <div class="screen veil-full" id="end"><div class="card wide scroll" data-id="endCard"></div></div>
      ${touch ? `<div id="rotate"><svg viewBox="0 0 120 120" aria-hidden="true"><rect x="14" y="62" width="66" height="36" rx="5"/><path d="M22 76v8"/><rect x="62" y="22" width="36" height="66" rx="5" class="g"/><path d="M76 80h8" class="g"/><path d="M22 50a30 30 0 0 1 28-28M50 22l-8-3M50 22l-5 7"/></svg><h2>Tournez votre appareil</h2><p>Pigeon perché se joue à la verticale.</p></div>` : ''}
      `,
    );
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.el[e.dataset.id!] = e));
    for (const n of ['loading', 'menu', 'brief', 'pause', 'fail', 'end', 'rack', 'book', 'help', 'scores'] as ScreenName[]) this.screens.set(n, root.querySelector('#' + n)!);
    this.el.hud = root.querySelector('#hud')!;

    const seg = (host: HTMLElement, items: [string, string][], sel: string, cb: (k: string) => void): void => {
      host.innerHTML = items.map(([k, l]) => `<button data-k="${k}" class="${k === sel ? 'sel' : ''}">${l}</button>`).join('');
      host.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        host.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        cb(b.dataset.k!);
      });
    };
    // choix du niveau : chaque niveau porte sa carte et son préréglage d'aides ; un niveau non livré reste « à venir »
    const lv = this.el.segLevel;
    lv.innerHTML = init.levels.map((l) => `<button data-k="${l.id}" class="${l.id === init.level ? 'sel' : ''}${l.playable ? '' : ' soon'}"${l.playable ? '' : ' disabled title="À venir"'}>${l.meta.title}${l.playable ? '' : '<small>à venir</small>'}</button>`).join('');
    lv.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || b.disabled || b.dataset.k === init.level) return;
      lv.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      this.el.diffNote.textContent = 'Chargement de la carte…';
      h.setLevel(b.dataset.k as LevelId);
    });
    // la note décrit la carte ; si les aides ont été forcées (?d=), on le dit
    this.el.diffNote.textContent = init.difficulty === cur.meta.difficulty ? cur.meta.note : `${cur.meta.note} Aides forcées : ${DIFFICULTY_LABEL[init.difficulty].toLowerCase()}. ${DIFFICULTY_NOTE[init.difficulty]}`;
    const quals = Object.values(QUALITY).map((q) => [q.name, q.label] as [string, string]);
    seg(this.el.segQual, quals, init.quality, (k) => h.setQuality(k as QualityName));
    seg(this.el.segQual2, quals, init.quality, (k) => h.setQuality(k as QualityName));
    seg(this.el.segTuto, [['on', 'Avec'], ['off', 'Sans']], init.tutorial ? 'on' : 'off', (k) => h.setTutorial(k === 'on'));
    seg(this.el.segCoach, [['on', 'Avec'], ['off', 'Sans']], init.coach === false ? 'off' : 'on', (k) => h.setCoach(k === 'on'));
    this.el.tutoRow.classList.toggle('hidden', init.difficulty === 'real' || !init.hasTutorial);
    // sans réglage du tutoriel, le volume rejoint « Conseils » : en portrait ils partagent une rangée (l'accueil tient sans défiler)
    if (this.el.tutoRow.classList.contains('hidden')) this.el.tutoRow.parentElement!.prepend(this.el.vol.closest('.opt')!);
    for (const id of ['vol', 'vol2']) {
      const v = this.el[id] as HTMLInputElement;
      v.value = String(Math.round(init.volume * 100));
      v.addEventListener('input', () => h.setVolume(Number(v.value) / 100));
    }
    let helpFrom: ScreenName | null = 'menu';
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      const tur = t.closest<HTMLElement>('[data-tur]')?.dataset.tur;
      const w = t.closest<HTMLElement>('[data-w]')?.dataset.w;
      const tu = t.closest<HTMLElement>('[data-tuto]');
      if (tu) {
        tu.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === tu));
        this.setTutorialChoice(tu.dataset.tuto === 'on');
        h.setTutorial(tu.dataset.tuto === 'on');
      }
      if (tur) { const [k, n] = tur.split(':'); h.turret(k as 'elev' | 'wind', Number(n)); }
      if (w) this.selectWeapon(w, true);
      if (!act) return;
      if (act === 'start') h.start();
      else if (act === 'resume') h.resume();
      else if (act === 'restart') h.restart();
      else if (act === 'retry') h.retry();
      else if (act === 'continue') h.continueBrief();
      else if (act === 'help') { helpFrom = this.current; this.show('help'); }
      else if (act === 'closeHelp') this.show(helpFrom);
      else if (act === 'take') h.pickWeapon(this.rackSel);
      else if (act === 'close') h.close();
      else if (act === 'skipTuto') h.skipTutorial();
      else if (act === 'fullscreen') h.fullscreen();
      else if (act === 'closeCoach') h.closeCoach();
      else if (act === 'scores') this.show('scores');
      else if (act === 'closeScores') this.show('menu');
      else if (act === 'submitScore') this.submitScore();
      else if (act === 'skipScore') this.skipScore();
      else if (act === 'clearLocal') this.clearLocal();
    });
    // saisie du nom (écran de fin) : nettoyage au fil de la frappe, Entrée pour valider
    root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.matches?.('.rank-name')) return;
      const v = cleanName(t.value, true);
      if (v !== t.value) t.value = v;
      const me = this.el.endCard.querySelector('.board .me .nm');
      if (me) me.textContent = cleanName(v) || '—';
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (!t.matches?.('.rank-name')) return;
      // la frappe reste dans le champ : le jeu ne lit pas ces touches
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.submitScore(); }
    });
    root.addEventListener('mouseover', (e) => { if ((e.target as HTMLElement).closest('button')) h.hover(); });
  }

  setLoading(p: number, text: string): void {
    this.el.loadB.style.width = Math.round(p * 100) + '%';
    this.el.loadT.textContent = text;
  }

  show(name: ScreenName | null): void {
    this.current = name;
    for (const [n, e] of this.screens) e.classList.toggle('on', n === name);
  }
  letterbox(on: boolean): void {
    this.el.letterbox.classList.toggle('on', on);
  }

  /** reflète le choix du tutoriel dans le menu */
  setTutorialChoice(on: boolean): void {
    this.el.segTuto.querySelectorAll<HTMLElement>('button').forEach((x) => x.classList.toggle('sel', (x.dataset.k === 'on') === on));
  }

  /** `tutoChoice` : première partie, on propose le tutoriel (valeur = choix présélectionné) ; null sinon */
  setBrief(step: Step, index: number, difficulty: Difficulty, prev?: { step: Step; s: StepStats } | null, tutoChoice: boolean | null = null): void {
    const zone = difficulty === 'real' ? step.zone.replace(/vers [\d\s ]+m(, puis [\d\s ]+m)?/g, 'distance à estimer').replace(/entre [\d\s ]+ et [\d\s ]+m/g, 'distance à estimer') : step.zone;
    const done = prev
      ? `<p style="color:var(--dim);border-left:2px solid var(--gold);padding-left:12px">« ${prev.step.title} » validé — ${prev.s.hits} touche${prev.s.hits > 1 ? 's' : ''} pour ${prev.s.shots} tir${prev.s.shots > 1 ? 's' : ''}, ${fr(prev.s.distance)} m, ${fr(prev.s.points)} points.</p>`
      : '';
    this.el.briefCard.innerHTML = `${done}<div class="kicker">Objectif ${index + 1} / ${this.steps.length}</div><h2>${step.title}</h2>
      <p>${step.brief}</p>
      <dl><dt>Repères</dt><dd>${step.intel}</dd><dt>Zone</dt><dd>${zone}</dd><dt>Poste</dt><dd>${step.posts}</dd><dt>Arme</dt><dd>${step.weapon}</dd></dl>
      <div class="row-btn"><button class="mbtn primary" data-act="continue">Continuer</button>${tutoChoice === null ? '' : `<div class="opt tuto-choice"><span>Tutoriel</span><div class="seg"><button data-tuto="on" class="${tutoChoice ? 'sel' : ''}">Avec le tutoriel</button><button data-tuto="off" class="${tutoChoice ? '' : 'sel'}">Sans</button></div></div>`}</div>
      <div class="hint" style="margin-top:10px">${this.touch ? 'Bouton <b>Briefing</b> pour le relire plus tard' : '<b>Entrée</b> ou clic · <b>B</b> pour relire le briefing plus tard'}</div>`;
    this.el.briefCard.scrollTop = 0;
  }

  private set(id: string, v: string): void {
    if (this.last[id] === v) return;
    this.last[id] = v;
    this.el[id].textContent = v;
  }
  private cls(id: string, c: string, on: boolean): void {
    const k = id + ':' + c;
    const v = on ? '1' : '0';
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.el[id].classList.toggle(c, on);
  }
  private width(id: string, f: number): void {
    const v = Math.round(Math.min(1, Math.max(0, f)) * 100) + '%';
    if (this.last[id + ':w'] === v) return;
    this.last[id + ':w'] = v;
    (this.el[id].firstElementChild as HTMLElement).style.width = v;
  }

  hud(s: HudState, dt: number): void {
    this.cls('hud', 'on', s.visible);
    this.cls('hud', 'in-scope', s.scope);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.classList.remove('on');
    }
    if (!s.visible) return;
    if (s.objective) {
      this.set('objK', `Objectif ${s.index + 1} / ${this.steps.length}`);
      this.set('objT', s.objective.title);
      this.set('objZ', s.objective.zone + ' ' + s.objective.posts);
    }
    this.cls('objK', 'hidden', s.scope);
    this.cls('objT', 'hidden', s.scope);
    this.cls('objZ', 'hidden', s.scope);
    this.width('alertG', s.alert / 100);
    this.cls('alertG', 'warn', s.alert > 60 || s.alarm);
    this.cls('alertRow', 'hidden', s.alert < 1 && !s.alarm);
    if (s.weapon) {
      this.set('wName', s.weapon.name);
      this.set('wCal', s.weapon.caliber);
      this.set('wMag', `${s.chambered ? '1' : '0'} + ${s.mag}`);
      this.set('wBusy', s.busy);
    }
    this.set('stance', s.stance + (s.post ? ' · ' + s.post : ''));
    this.cls('scopeTR', 'on', s.scope);
    this.cls('scopeBR', 'on', s.scope);
    if (s.scope) {
      this.set('elev', fr(s.elev, 1));
      // tourelle en butée, ou correction au-delà de sa course : le reste se prend au réticule
      this.cls('holdRow', 'hidden', !s.hold);
      this.set('hold', s.hold);
      this.set('windT', (s.wind === 0 ? '' : s.wind > 0 ? 'D ' : 'G ') + fr(Math.abs(s.wind), 1));
      this.set('zoom', fr(s.zoom, 1) + '×');
      this.set('heart', String(Math.round(s.heart)));
      this.width('airG', s.air);
      this.cls('airG', 'warn', s.breath === 'gasping');
      this.cls('rangeRow', 'hidden', s.range === null);
      if (s.range !== null) this.set('range', `${fr(s.range)} m` + (s.rangeFlat !== null && Math.abs(s.rangeFlat - s.range) > 4 ? `  (à plat ${fr(s.rangeFlat)})` : ''));
      this.cls('windRow', 'hidden', s.windSpeed === null);
      if (s.windSpeed !== null) {
        this.set('windV', fr(s.windSpeed, 1) + ' m/s');
        const a = Math.round((s.windRel * 180) / Math.PI);
        if (this.last.windA !== String(a)) {
          this.last.windA = String(a);
          // la flèche pointe là où va le vent
          this.el.windA.style.transform = `rotate(${a}deg)`;
        }
      }
    }
    // --- boussole et repère du poste conseillé ---
    this.cls('compass', 'off', s.scope);
    if (!s.scope) {
      const deg = (((s.heading * 180) / Math.PI) % 360 + 360) % 360;
      const tx = (-(deg + 90) * C_PX).toFixed(1);
      if (this.last.cTx !== tx) {
        this.last.cTx = tx;
        this.el.cStrip.style.transform = `translateX(${tx}px)`;
      }
      const g = s.guide;
      this.cls('cMark', 'hidden', !g || g.arrived);
      this.cls('cArrow', 'hidden', !g || g.arrived);
      if (g) {
        let rel = ((g.bearing - s.heading) * 180) / Math.PI;
        rel = ((rel + 540) % 360) - 180;
        const off = Math.abs(rel) > C_HALF;
        const mx = (Math.max(-C_HALF, Math.min(C_HALF, rel)) * C_PX).toFixed(1);
        const key = mx + (off ? 'o' : '');
        if (this.last.cMx !== key) {
          this.last.cMx = key;
          this.el.cMark.style.transform = `translateX(${mx}px)`;
          this.el.cMark.classList.toggle('edge', off);
        }
        const rot = String(Math.round(rel / 3) * 3);
        if (this.last.cRot !== rot) {
          this.last.cRot = rot;
          this.el.cArrow.style.transform = `rotate(${rot}deg)`;
        }
        this.set('cLabel', g.arrived ? `${g.label} · en position` : `${g.label}${g.hint ? ' par ' + g.hint : ''} · ${Math.max(1, Math.round(g.dist))} m`);
      } else this.set('cLabel', '');
    }
    this.set('prompt', '');
    if (this.last.promptHtml !== s.prompt) {
      this.last.promptHtml = s.prompt;
      this.el.prompt.innerHTML = s.prompt;
      this.el.prompt.style.opacity = s.prompt ? '1' : '0';
    }
    this.cls('fps', 'hidden', !s.showFps);
    if (s.showFps) this.set('fps', `${Math.round(s.fps)} i/s`);
  }

  /** compteur des changements de la carte du tutoriel (sa hauteur a pu changer) */
  tutoRev = 0;
  /** hauteur de la carte logée au-dessus du champ de la lunette (tutoriel, ou conseil), en pixels CSS ; 0 s'il n'y en a pas */
  tutoHeight(): number {
    if (!this.el.tuto.classList.contains('hidden')) return this.el.tuto.offsetHeight;
    return this.el.coach.classList.contains('hidden') ? 0 : this.el.coach.offsetHeight;
  }

  /**
   * Conseil après plusieurs tirs manqués (voir game/coach.ts) ; `null` le retire. Les textes viennent du jeu : chiffres
   * et commandes, sans rien de saisi par le joueur.
   */
  coach(a: Advice | null): void {
    const on = !!a;
    if (!on && this.el.coach.classList.contains('hidden')) return;
    this.el.coach.classList.toggle('hidden', !on);
    this.el.hud.classList.toggle('has-coach', on);
    this.tutoRev++;
    if (!a) return;
    this.el.coachT.textContent = a.title;
    this.el.coachS.innerHTML = a.short;
    this.el.coachD.innerHTML = a.diag;
    this.el.coachD.classList.toggle('hidden', !a.diag);
    this.el.coachW.innerHTML = a.why;
    this.el.coachL.innerHTML = a.steps.map((x) => `<li>${x}</li>`).join('');
    this.el.coachL.classList.toggle('hidden', !a.steps.length);
    this.el.coachC.innerHTML = a.calibre;
    this.el.coachC.classList.toggle('hidden', !a.calibre);
    if (this.el.coachClose) this.el.coachClose.innerHTML = a.close;
    this.el.coach.scrollTop = 0;
  }
  get coachShown(): boolean {
    return !this.el.coach.classList.contains('hidden');
  }

  /** Carte du tutoriel : étape en cours, commande, progression. `null` la retire. Renvoie vrai si elle a changé. */
  tuto(v: TutoView | null, screen: string): boolean {
    const key = v ? `${v.id}|${v.n}|${v.done ? 1 : 0}|${v.text}|${v.cmd}|${screen}` : '';
    if (this.last.tutoKey === key) return false;
    this.last.tutoKey = key;
    this.tutoRev++;
    const inPlay = screen === 'play';
    this.el.tuto.classList.toggle('hidden', !v || !inPlay);
    this.el.hud.classList.toggle('has-tuto', !!v);
    this.el.pauseSkip.classList.toggle('hidden', !v || v.finished);
    for (const [id, name] of [['tutoBook', 'book'], ['tutoRack', 'rack']] as const) {
      const on = !!v && screen === name;
      this.el[id].classList.toggle('hidden', !on);
      if (on) this.el[id].innerHTML = `<b>Tutoriel ${v!.n} / ${v!.total} · ${v!.title}${v!.done ? ' ✓' : ''}</b> ${v!.text}`;
    }
    if (!v) return true;
    this.el.tuto.classList.toggle('done', v.done);
    this.el.tuto.classList.toggle('fin', v.finished);
    this.el.tutoK.textContent = v.finished ? 'Tutoriel' : `Tutoriel · ${v.n} / ${v.total}`;
    this.el.tutoT.textContent = v.title + (v.done && !v.finished ? ' ✓' : '');
    this.el.tutoX.textContent = v.text;
    this.el.tutoC.innerHTML = v.cmd;
    this.el.tutoC.classList.toggle('hidden', !v.cmd);
    return true;
  }

  toast(text: string, sub = '', seconds = 2.6): void {
    this.el.toast.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.toast.classList.add('on');
    this.toastT = seconds;
  }

  // ---------------- râtelier ----------------
  rackSel: string;
  openRack(currentId: string): void {
    // au-delà de huit armes la liste se resserre (classe « many ») : une arme par ligne sur ordinateur, trois par rangée en portrait
    this.el.wlist.classList.toggle('many', this.weapons.length > 8);
    const keyOf = (i: number): string => (i < 9 ? String(i + 1) : i === 9 ? '0' : '');
    this.el.wlist.innerHTML = this.weapons.map((w, i) => `<button data-w="${w.id}"><b>${this.touch || !keyOf(i) ? '' : `<kbd>${keyOf(i)}</kbd> `}${w.name}</b><i>${w.caliber}</i></button>`).join('');
    this.selectWeapon(currentId, false);
    this.show('rack');
  }
  selectWeapon(id: string, sound: boolean): void {
    this.rackSel = id;
    if (sound) this.h.hover();
    const w = this.weapons.find((x) => x.id === id) ?? this.weapons[0];
    this.el.wlist.querySelectorAll<HTMLElement>('button').forEach((b) => {
      const on = b.dataset.w === id;
      b.classList.toggle('sel', on);
      // liste longue : l'arme choisie au clavier reste en vue
      if (on && this.el.wlist.scrollHeight > this.el.wlist.clientHeight) b.scrollIntoView({ block: 'nearest' });
    });
    const e0 = (0.5 * w.bulletGr * 6.479891e-5 * w.v0 * w.v0) / 1000;
    // échelles : celles des sept armes d'origine, élargies si le râtelier du niveau porte des calibres plus puissants
    const top = (ref: number, of: (x: WeaponDef) => number): number => Math.max(ref, ...this.weapons.map(of));
    const kj = (x: WeaponDef): number => (0.5 * x.bulletGr * 6.479891e-5 * x.v0 * x.v0) / 1000;
    const bar = (label: string, f: number, val: string): string => `<span>${label}</span><div class="b"><i style="width:${Math.round(Math.min(1, f) * 100)}%"></i></div><span>${val}</span>`;
    this.el.wdetail.innerHTML = `<h3>${w.name}</h3><div class="cal">${w.caliber} · ${w.ammo}</div>
      <div class="bars">
        ${bar('Vitesse', w.v0 / top(950, (x) => x.v0), fr(w.v0) + ' m/s')}
        ${bar('Énergie', e0 / top(6.8, kj), fr(e0, 1) + ' kJ')}
        ${bar('Portée utile', w.effective / top(1500, (x) => x.effective), fr(w.effective) + ' m')}
        ${bar('Précision', 0.35 / w.moa, fr(w.moa, 2) + ' MOA')}
        ${bar('Recul', recoilVelocity(w) / top(2.8, recoilVelocity), fr(recoilVelocity(w), 1) + ' m/s')}
        ${bar('Bruit', w.sound.loudness, w.suppressed ? 'modéré' : w.sound.supersonic ? 'supersonique' : 'subsonique')}
        ${bar('Pénétration', w.penetration / 6, String(w.penetration) + ' / 6')}
        ${bar('Chargeur', w.magazine / 10, w.magazine + ' coups')}
        ${bar('Verrou', w.boltTime / top(1.5, (x) => x.boltTime), fr(w.boltTime, 2) + ' s')}
      </div>
      <p style="color:var(--dim);font-size:13.5px">${w.note}</p>
      <p style="color:var(--faint);font-size:12px">Projectile de ${w.bulletGr} gr, coefficient balistique ${w.dragModel === 'G7' && w.bcG7 ? `G7 ${fr(w.bcG7, 3)} (G1 ${fr(w.bcG1, 3)})` : `G1 ${fr(w.bcG1, 3)}`}, zérotage à ${w.zero} m, lunette ${w.scope[0]}–${w.scope[1]}×, tourelle ${fr(w.turretMaxMil)} mrad.</p>
      <div class="row-btn take-row"><button class="mbtn primary" data-act="take">Prendre cette arme</button></div>`;
  }

  // ---------------- carnet ----------------
  /**
   * Carnet de tir. Physique neutre (`data.flat`) : la table d'origine. Physique avancée (`data.adv`) : la correction
   * décomposée par distance — tableau large sur ordinateur, fiches de deux lignes sur écran tactile (portrait 375 px).
   * Dans les deux cas le modèle de traînée de l'arme (G1 ou G7) est affiché.
   */
  openBook(data: BookData, log: ShotLog[], elev: number, wind: number): void {
    const def = data.def;
    this.el.bookT.textContent = `${def.name} · ${def.caliber}`;
    const model = `Traînée <b>${data.drag}</b> · CB ${fr(data.bc, 3)}`;
    const adv = data.adv;
    this.el.bookG.classList.toggle('adv', !!adv);
    this.el.bookG.closest('.card')!.classList.toggle('xwide', !!adv);
    this.el.dopeL.classList.toggle('hidden', !adv);
    if (!adv) {
      const rows = data.flat ?? [];
      this.el.bookS.innerHTML = `${model} · zéro ${def.zero} m · tourelle ${fr(data.turretMax)} mrad`;
      this.el.dope.className = 'dope';
      this.el.dope.innerHTML =
        `<tr><th>Distance</th><th>Élévation</th><th>Vent ${fr(data.wind)} m/s</th><th><span class="lg">Temps de vol</span><span class="sh">Vol</span></th><th>Vitesse</th><th>Énergie</th></tr>` +
        rows
          .map((r) => `<tr class="${r.velocity < 342 * 1.1 && def.v0 > 400 ? 'sub' : ''}"><td>${fr(r.range)} m</td><td>${r.elevMil < 0.05 ? '0,0' : fr(r.elevMil, 1)} mrad</td><td>${fr(r.windMil, 1)} mrad</td><td>${fr(r.time, 2)} s</td><td>${fr(r.velocity)} m/s</td><td>${fr(r.energy)} J</td></tr>`)
          .join('');
      this.el.dopeL.innerHTML = '';
      this.el.bookN.innerHTML = '';
      this.el.bookH.textContent = `table calculée pour un tir à plat, vent traversier plein de ${fr(data.wind)} m/s`;
    } else {
      const e = adv.env;
      const on: string[] = [];
      if (e.densityFromAltitude) on.push(`air à ${fr(e.altitudeM)} m, ${fr(e.temperatureC)} °C (${fr(adv.rho, 3)} kg/m³)`);
      if (e.coriolis) on.push(`Coriolis à ${fr(Math.abs(e.latitudeDeg))}° ${e.latitudeDeg >= 0 ? 'N' : 'S'}`);
      if (e.spinDrift) on.push(`dérive gyroscopique${adv.sg > 0 ? ` (stabilité ${fr(adv.sg, 2)})` : ''}`);
      if (e.aeroJump) on.push('saut aérodynamique');
      if (Math.abs(adv.v0 - def.v0) >= 0.5) on.push(`poudre à ${fr(e.temperatureC)} °C : ${fr(adv.v0)} m/s`);
      const trans = adv.transonic === null ? 'supersonique sur toute la table' : adv.transonic <= 0 ? 'subsonique dès la bouche' : `transsonique (Mach 1,2) à <b>${fr(Math.round(adv.transonic / 10) * 10)} m</b>${adv.subsonic ? `, subsonique à ${fr(Math.round(adv.subsonic / 10) * 10)} m` : ''}`;
      this.el.bookS.innerHTML = `${model} · azimut <b>${fr(adv.azimuth)}° ${ROSE[Math.round(adv.azimuth / 22.5) % 16]}</b> · ${trans}<span class="book-env">${on.join(' · ')}</span>`;
      const anyHold = adv.rows.some((r) => r.hold > 0);
      const sub = (r: BookRow): string => (adv.transonic !== null && r.range > adv.transonic ? 'sub' : '');
      // élévation : au-delà de la course de tourelle, part réglée + part en contre-visée
      const elevCell = (r: BookRow): string => (r.hold > 0 ? `<b>${fr(r.dial, 1)}</b> <span class="hold">+ ${fr(r.hold, 1)}${r.hold > data.holdMax ? ' !' : ''}</span>` : `<b>${r.elev < 0.05 ? '0,0' : fr(r.elev, 1)}</b>`);
      const jump = (r: BookRow): string => (Math.abs(r.jump) < 0.05 ? '0,0' : '±' + fr(Math.abs(r.jump), 1));
      this.el.dope.className = 'dope adv';
      this.el.dope.innerHTML =
        `<tr><th>Distance</th><th class="g1">Élévation</th><th>Chute</th><th>Coriolis ↕</th><th class="g1">Dérive</th><th>Gyro.</th><th>Coriolis ↔</th><th class="g1">Vent ${fr(data.wind)} m/s</th><th>Saut aéro.</th><th class="g1">Vol</th><th>Mach</th></tr>` +
        adv.rows
          .map((r) => `<tr class="${sub(r)}"><td>${fr(r.range)} m</td><td class="g1">${elevCell(r)}</td><td>${fr(r.drop, 1)}</td><td>${sg1(r.coriolisV)}</td><td class="g1"><b>${lr1(r.windage)}</b></td><td>${lr1(r.spin)}</td><td>${lr1(r.coriolisH)}</td><td class="g1">${fr(r.wind, 1)}</td><td>${jump(r)}</td><td class="g1">${fr(r.tof, 2)} s</td><td>${fr(r.mach, 2)}</td></tr>`)
          .join('');
      this.el.dopeL.innerHTML = adv.rows
        .map((r) => `<div class="dl ${sub(r)}"><div class="dl1"><b class="dr">${fr(r.range)} m</b><span><small>É</small> ${elevCell(r)}</span><span><small>D</small> <b>${lr1(r.windage)}</b></span><span><small>vent</small> ${fr(r.wind, 1)}</span><span class="dt">${fr(r.tof, 2)} s · M ${fr(r.mach, 2)}</span></div>
          <div class="dl2">chute ${fr(r.drop, 1)} · Cor. ${sg1(r.coriolisV)} · gyro ${lr1(r.spin)} · Cor. ${lr1(r.coriolisH)} · saut ${jump(r)}</div></div>`)
        .join('');
      this.el.bookN.innerHTML =
        `<p>Corrections en mrad. <b>Élévation</b> = chute + Coriolis vertical ; <b>Dérive</b> = dérive gyroscopique + Coriolis horizontal (D : à droite, G : à gauche), sans vent.</p>
        <p><b>Vent</b> : correction pour ${fr(data.wind)} m/s de plein travers, à prendre du côté d’où vient le vent. <b>Saut</b> : à ajouter à l’élévation si ce vent vient de la gauche, à retrancher s’il vient de la droite.</p>` +
        (anyHold ? `<p><span class="hold">+ x,x</span> : la tourelle est en butée à ${fr(data.turretMax, 1)} mrad ; le reste se prend en contre-visée, sur les graduations sous le centre du réticule (jusqu’à ${fr(data.holdMax)} mrad${adv.rows.some((r) => r.hold > data.holdMax) ? ' ; « ! » : au-delà' : ''}).</p>` : '');
      this.el.bookH.textContent = `table calculée pour un tir à plat à l’azimut ${fr(adv.azimuth)}°, vent traversier plein de ${fr(data.wind)} m/s`;
    }
    this.bookTurrets(elev, wind);
    this.el.blog.innerHTML = log.length
      ? log.map((l) => `<div><b>${l.weapon}</b> · ${fr(l.distance)} m · ${fr(l.tof, 2)} s · É ${fr(l.elev, 1)} / D ${fr(l.wind, 1)} · ${l.result}</div>`).join('')
      : '<div>Aucun tir pour l’instant.</div>';
    this.show('book');
  }
  bookTurrets(elev: number, wind: number): void {
    this.el.bElev.textContent = fr(elev, 1) + ' mrad';
    this.el.bWind.textContent = (wind === 0 ? '' : wind > 0 ? 'D ' : 'G ') + fr(Math.abs(wind), 1) + ' mrad';
  }

  // ---------------- classements ----------------
  private localArmed = 0;
  /** Classements de l'accueil (cinq premiers par niveau), mode « en ligne » ou « local », classement local à vider. */
  setBoards(boards: ScoreBoards, online: boolean, localCount: number): void {
    this.root.querySelectorAll<HTMLElement>('[data-board]').forEach((ol) => {
      const list = (boards[ol.dataset.board as LevelId] ?? []).slice(0, HOME_SIZE);
      ol.innerHTML = list.length ? list.map((e, i) => boardRow(e, i + 1, false)).join('') : '<li class="none">Aucun score</li>';
    });
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((e) => (e.textContent = modeLabel(online)));
    this.el.localRow.classList.toggle('hidden', localCount === 0);
    this.el.localT.textContent = `Classement local de cet appareil : ${localCount} score${localCount > 1 ? 's' : ''}.`;
    this.el.localB.textContent = 'Effacer';
    this.el.localB.classList.remove('armed');
  }
  /** deux appuis : le premier arme (« Confirmer »), le second efface */
  private clearLocal(): void {
    const b = this.el.localB;
    if (b.classList.contains('armed')) { clearTimeout(this.localArmed); this.h.clearLocalScores(); return; }
    b.classList.add('armed');
    b.textContent = 'Confirmer l’effacement';
    this.localArmed = window.setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Effacer'; }, 5000);
  }

  fail(reason: string): void {
    this.el.failT.textContent = reason;
    this.show('fail');
  }

  /** écran de fin : état du classement du niveau joué */
  private rank: { info: EndRanking; phase: 'entry' | 'done' | 'out' | 'unranked' | 'skipped'; rank: number; note: string; busy: boolean } | null = null;

  end(m: Mission, info: EndRanking): void {
    const sc = m.score();
    const min = Math.floor(m.elapsed / 60), sec = Math.floor(m.elapsed % 60);
    this.el.endCard.innerHTML = `<div class="kicker">Mission accomplie · ${DIFFICULTY_LABEL[m.difficulty]}</div><h2>${sc.grade}</h2>
      <div class="score-grid">
        <div><small>Score</small><b>${fr(sc.total)}</b></div>
        <div><small>Précision</small><b>${fr(sc.accuracy * 100)} %</b></div>
        <div><small>Temps</small><b>${min} min ${String(sec).padStart(2, '0')}</b></div>
        <div><small>Munitions</small><b>${m.totalShots}</b></div>
      </div>
      <div class="end-cols">
      <div class="end-rank">
        <div class="kicker rank-k"><span>Classement · ${info.title}</span><i class="rank-mode"></i></div>
        <p class="rank-msg" aria-live="polite"></p>
        <div class="rank-form hidden">
          <input class="rank-name" type="text" inputmode="text" maxlength="${NAME_MAX}" size="${NAME_MAX}" placeholder="VOTRE NOM" aria-label="Votre nom, ${NAME_MAX} caractères au plus" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" />
          <button class="mbtn primary rank-ok" data-act="submitScore">Inscrire</button>
          <button class="mbtn rank-skip" data-act="skipScore">Passer</button>
        </div>
        <ol class="board full scroll"></ol>
      </div>
      <div class="end-detail">
      <table class="dope"><tr><th>Objectif</th><th class="xp">Arme</th><th>Tirs</th><th>Touches</th><th>Distance</th><th class="xp">Temps</th><th>Points</th></tr>
      ${m.stats.map((s, i) => `<tr><td>${this.steps[i].title}</td><td class="xp">${s.weapon || '—'}</td><td>${s.shots}</td><td>${s.hits}</td><td>${fr(s.distance)} m</td><td class="xp">${fr(s.time)} s</td><td>${fr(s.points)}</td></tr>`).join('')}
      ${this.alertRow ? `<tr><td>Discrétion</td>${[['lg', 5], ['sh', 3]].map(([c, n]) => `<td class="${c}c" colspan="${n}" style="text-align:left;color:var(--dim)">${m.alarm ? this.alertTexts.endRaised ?? 'L’alerte a été donnée.' : `${this.alertTexts.endQuiet ?? 'Aucune alerte donnée'} (niveau final ${fr(m.alert)} %).`}</td>`).join('')}<td>${fr(sc.discretion)}</td></tr>` : ''}</table>
      </div>
      </div>
      <div class="row-btn" style="margin-top:20px"><button class="mbtn primary" data-act="restart">Rejouer</button></div>`;
    const phase = !info.ranked ? 'unranked' : rankOf(info.board, info.result.score) <= BOARD_SIZE ? 'entry' : 'out';
    this.rank = { info, phase, rank: 0, note: '', busy: false };
    const input = this.el.endCard.querySelector<HTMLInputElement>('.rank-name')!;
    input.value = info.lastName;
    this.renderRank();
    this.el.endCard.scrollTop = 0;
    this.show('end');
    // sur ordinateur le champ est prêt à la frappe ; au doigt, le clavier ne s'ouvre que si le joueur touche le champ
    if (phase === 'entry' && !this.touch) setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  /** Le classement du niveau a été relu (d'autres joueurs ont pu s'inscrire pendant la partie). */
  endBoard(board: ScoreEntry[], online: boolean): void {
    const r = this.rank;
    if (!r || r.phase === 'done') return;
    r.info.board = board;
    r.info.online = online;
    if (r.phase === 'entry' || r.phase === 'out') r.phase = rankOf(board, r.info.result.score) <= BOARD_SIZE ? 'entry' : 'out';
    this.renderRank();
  }

  private renderRank(): void {
    const r = this.rank;
    if (!r) return;
    const card = this.el.endCard, q = <T extends HTMLElement>(sel: string): T => card.querySelector<T>(sel)!;
    const { board, result } = r.info;
    const input = q<HTMLInputElement>('.rank-name');
    const pending = r.phase === 'entry';
    const rank = pending ? rankOf(board, result.score) : r.rank;
    let rows = board.map((e) => ({ ...e, me: false }));
    if (pending) rows.splice(rank - 1, 0, { ...result, name: cleanName(input.value), date: '', me: true });
    else if (r.phase === 'done' && rank > 0 && rows[rank - 1]) rows[rank - 1].me = true;
    rows = rows.slice(0, BOARD_SIZE);
    let msg: string;
    if (r.phase === 'entry') msg = rank === 1 ? 'Nouveau record du niveau. Inscrivez votre nom.' : `Vous entrez au classement : ${ord(rank)} sur ${rows.length}. Inscrivez votre nom.`;
    else if (r.phase === 'done') msg = rank === 1 ? 'Record du niveau : vous êtes 1er.' : rank > 0 ? `Inscrit : ${ord(rank)} du classement.` : 'D’autres tireurs sont passés devant entre-temps : le score ne tient plus dans les vingt premiers.';
    else if (r.phase === 'out') msg = `Hors des vingt premiers. Score à battre : ${fr(board[BOARD_SIZE - 1]?.score ?? 0)}.`;
    else if (r.phase === 'skipped') msg = 'Score non inscrit.';
    else msg = 'Partie d’essai : score non classé.';
    q('.rank-msg').textContent = msg + (r.note ? ' ' + r.note : '');
    q('.rank-msg').classList.toggle('hot', r.phase === 'entry' || (r.phase === 'done' && rank > 0));
    q('.rank-mode').textContent = modeLabel(r.info.online);
    q('.rank-form').classList.toggle('hidden', !pending);
    const ok = q<HTMLButtonElement>('.rank-ok');
    ok.disabled = r.busy;
    ok.textContent = r.busy ? 'Envoi…' : 'Inscrire';
    const ol = q('.board.full');
    ol.innerHTML = rows.length ? rows.map((e, i) => boardRow(e, i + 1, true, e.me)).join('') : '<li class="none">Aucun score pour l’instant.</li>';
    // liste défilante (portrait) : la ligne du joueur reste en vue
    const me = ol.querySelector<HTMLElement>('.me');
    if (me && ol.scrollHeight > ol.clientHeight) ol.scrollTop = Math.max(0, me.offsetTop - ol.offsetTop - ol.clientHeight / 2 + me.offsetHeight / 2);
  }

  private submitScore(): void {
    const r = this.rank;
    if (!r || r.phase !== 'entry' || r.busy) return;
    const input = this.el.endCard.querySelector<HTMLInputElement>('.rank-name')!;
    r.busy = true;
    r.note = '';
    this.renderRank();
    void this.h.submitScore(input.value).then((out) => {
      if (this.rank !== r) return;
      r.busy = false;
      if (out.status === 'ok') {
        input.blur();
        r.phase = 'done';
        r.rank = out.rank;
        r.info.board = out.board;
        r.info.online = out.online;
        r.note = out.fellBack ? 'Serveur injoignable : score enregistré sur cet appareil seulement.' : '';
      } else if (out.status === 'retry') r.note = out.message;
      else { r.phase = 'skipped'; r.note = out.message; }
      this.renderRank();
    });
  }
  private skipScore(): void {
    const r = this.rank;
    if (!r || r.phase !== 'entry' || r.busy) return;
    r.phase = 'skipped';
    this.renderRank();
  }
}
