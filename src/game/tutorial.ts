// Tutoriel guidé du premier objectif (« Réglage ») : une suite d'étapes validées par ce que fait réellement le
// joueur. Logique pure, sans DOM : le jeu fournit un instantané par image, l'interface affiche `view`.
// Rien ici ne bloque le joueur : une étape attend, et une action faite en avance est retenue.
import type { TutorialSpec } from '../levels/types';
import type { Difficulty } from './mission';

export interface TutoSnap {
  /** réglages du tutoriel donnés par le niveau : poste, cibles, repères du décor */
  site: TutorialSpec;
  /** secondes réelles depuis l'image précédente */
  dt: number;
  touch: boolean;
  /** mise en page portrait (téléphone) : manette en bas à gauche, informations sous la lunette */
  portrait?: boolean;
  difficulty: Difficulty;
  /** écran courant : 'play', 'book', 'rack'… */
  state: string;
  yaw: number;
  pitch: number;
  x: number;
  z: number;
  /** poste de tir où se trouve le joueur (clé des postes du niveau) ou null */
  post: string | null;
  stance: 'stand' | 'crouch' | 'prone';
  scope: boolean;
  zoom: number;
  /** distance affichée (télémètre), ou null */
  range: number | null;
  /** le télémètre vient d'être déclenché */
  ranged: boolean;
  elev: number;
  breath: string;
  shots: number;
  reloading: boolean;
  weaponId: string;
  caliber: string;
  plate1Done: boolean;
  plate2Done: boolean;
  /** écart angulaire entre la visée et chaque plaque (mrad) */
  aimErr1: number;
  aimErr2: number;
  dist1: number;
  dist2: number;
  /** élévation du carnet pour l'arme en main, à la distance de chaque plaque (mrad) */
  need1: number;
  need2: number;
  /** vent au tireur, m/s */
  windSpeed: number;
  /** distance au râtelier, m */
  rackDist: number;
}

export interface TutoView {
  id: string;
  /** numéro de l'étape, à partir de 1 */
  n: number;
  total: number;
  title: string;
  text: string;
  /** commande à utiliser (HTML court : touches en <b>) ; vide s'il n'y a rien à presser */
  cmd: string;
  /** boutons tactiles à mettre en évidence */
  halo: string[];
  /** l'étape vient d'être validée (coche affichée un court instant) */
  done: boolean;
  finished: boolean;
}

interface Flags {
  looked: number;
  moved: number;
  atPost: boolean;
  zoomed: boolean;
  aimed: number;
  ranged: boolean;
  book: boolean;
  held: number;
  fired: boolean;
  missed: boolean;
  reloaded: boolean;
}

interface StepDef {
  id: string;
  title: string;
  text: (s: TutoSnap, f: Flags) => string;
  cmd: (s: TutoSnap) => string;
  halo: (s: TutoSnap) => string[];
  check: (s: TutoSnap, f: Flags) => boolean;
}

const fr1 = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fr0 = (n: number): string => Math.round(n).toLocaleString('fr-FR');
const k = (s: TutoSnap, key: string, touch: string, portrait?: string): string => (s.touch ? (s.portrait && portrait ? portrait : touch) : key);
/** où se lisent la distance et le vent en lunette */
const info = (s: TutoSnap, cap = false): string => (s.portrait ? (cap ? 'Sous la lunette' : 'sous la lunette') : cap ? 'En haut à droite' : 'en haut à droite');
/** tolérance sur la tourelle : deux clics et demi autour de la valeur du carnet */
const TURRET_TOL = 0.25;
const smallBore = (s: TutoSnap): boolean => s.weaponId === '22lr' || s.weaponId === '308sub';

const STEPS: StepDef[] = [
  {
    id: 'look', title: 'Regarder',
    text: () => 'Faites le tour de la cour du regard.',
    cmd: (s) => k(s, '<b>Souris</b>', 'Glissez le pouce sur la <b>moitié droite</b> de l’écran', 'Glissez le <b>pouce droit</b> sur l’écran'),
    halo: () => [],
    check: (_s, f) => f.looked > 0.9,
  },
  {
    id: 'move', title: 'Se déplacer',
    text: () => 'Faites quelques pas. Courir fait monter le pouls : la visée tremblera plus longtemps.',
    cmd: (s) => k(s, '<b>Z Q S D</b> · <b>Maj</b> pour courir', '<b>Manette</b> : pouce sur la moitié gauche, à fond pour courir', '<b>Manette</b> : pouce gauche en bas de l’écran, à fond pour courir'),
    halo: () => [],
    check: (_s, f) => f.moved > 3,
  },
  {
    id: 'go', title: 'Suivre la boussole',
    text: (s) => `Le repère doré de la boussole et la flèche mènent au poste de tir. Rejoignez ${s.site.postPhrase}, jusqu’à lire « en position ».`,
    cmd: (s) => k(s, 'Tournez-vous jusqu’à centrer le repère, puis <b>Z</b>', 'Centrez le repère, puis poussez la <b>manette</b>'),
    halo: () => [],
    check: (_s, f) => f.atPost,
  },
  {
    id: 'prone', title: 'Se coucher',
    text: () => 'Couché, l’arme repose sur son bipied : la position la plus stable.',
    cmd: (s) => k(s, '<b>X</b> couché · <b>C</b> accroupi · <b>Espace</b> se relever', 'Bouton <b>Couché</b>'),
    halo: () => ['prone'],
    check: (s) => s.stance === 'prone',
  },
  {
    id: 'scope', title: 'Épauler',
    text: () => 'Passez l’œil à la lunette. On n’épaule que couché ou accroupi.',
    cmd: (s) => k(s, '<b>Clic droit</b> ou <b>F</b>', 'Bouton <b>Épauler</b>'),
    halo: () => ['aim'],
    check: (s) => s.scope && s.stance !== 'stand',
  },
  {
    id: 'zoom', title: 'Grossissement',
    text: () => 'Cherchez large, grossissez pour viser. Le réticule grossit avec l’image : un point vaut toujours 1 mrad.',
    cmd: (s) => k(s, '<b>Molette</b>', 'Boutons <b>+</b> et <b>−</b>, ou pincez à deux doigts'),
    halo: () => ['zin', 'zout'],
    check: (_s, f) => f.zoomed,
  },
  {
    id: 'wind', title: 'Lire le vent',
    text: (s) => `Réticule sur la plaque carrée, ${s.site.nearHint}. ${info(s, true)} : vent de ${fr1(s.windSpeed)} m/s, la flèche montre où il pousse la balle.`,
    cmd: () => '',
    halo: () => [],
    check: (s, f) => f.aimed > 0.7 || s.plate1Done,
  },
  {
    id: 'range', title: 'Mesurer la distance',
    text: (s) => (s.difficulty === 'assist'
      ? 'En Assisté, le télémètre mesure en continu : réticule sur la plaque, lisez « Distance » ' + info(s) + '.'
      : 'Réticule sur la plaque, déclenchez le télémètre : la distance s’affiche quelques secondes ' + info(s) + '.'),
    cmd: (s) => (s.difficulty === 'assist' ? '' : k(s, '<b>T</b>', 'Bouton <b>Télémètre</b>')),
    halo: (s) => (s.difficulty === 'assist' ? [] : ['range']),
    check: (s, f) => f.ranged || s.plate1Done,
  },
  {
    id: 'book', title: 'Carnet de tir',
    text: (s) => `Le carnet donne l’élévation pour chaque distance. Ouvrez-le : à ${fr0(s.dist1)} m, comptez ${fr1(s.need1)} mrad.`,
    cmd: (s) => k(s, '<b>Tab</b> pour ouvrir et refermer', 'Bouton <b>Carnet</b>, en haut à droite', 'Bouton <b>Carnet</b>, en haut à gauche de la lunette'),
    halo: () => ['book'],
    check: (s, f) => f.book || s.plate1Done,
  },
  {
    id: 'elev', title: 'Tourelle d’élévation',
    text: (s) => (s.difficulty === 'assist'
      ? `Montez l’élévation à ${fr1(s.need1)} mrad. Le losange doré montre l’impact prévu : il doit revenir au centre.`
      : `Affichez ${fr1(s.need1)} mrad à la tourelle d’élévation : la balle tombera sur la croix à ${fr0(s.dist1)} m.`),
    cmd: (s) => k(s, '<b>↑ ↓</b> en lunette (<b>Maj droite</b> : 1 mrad) ou boutons du carnet', 'Boutons <b>Élévation</b> : <b>− +</b> (0,1 mrad) · <b>−1 +1</b>'),
    halo: () => ['e+1', 'e-1'],
    check: (s) => Math.abs(s.elev - s.need1) <= TURRET_TOL || s.plate1Done,
  },
  {
    id: 'breath', title: 'Retenir son souffle',
    text: () => 'Le réticule suit votre respiration. Bloquez-la : il se fige. La réserve d’air est comptée.',
    cmd: (s) => k(s, '<b>Espace</b> ou <b>Maj gauche</b>, maintenu', 'Maintenez le bouton <b>Souffle</b>'),
    halo: () => ['breath'],
    check: (_s, f) => f.held > 0.6,
  },
  {
    id: 'fire', title: 'Tirer',
    text: (s) => (s.difficulty === 'assist'
      ? 'Losange sur la plaque, souffle retenu, pressez la détente.'
      : 'Croix sur la plaque, souffle retenu, pressez la détente.'),
    cmd: (s) => k(s, '<b>Clic gauche</b>', 'Bouton <b>Tirer</b>'),
    halo: () => ['fire'],
    check: (s, f) => f.fired || s.plate1Done,
  },
  {
    id: 'impact', title: 'Observer et corriger',
    text: (s, f) => {
      if (!f.missed) return 'Regardez où arrive la balle : l’acier sonne, la terre saute. Faites sonner la plaque carrée.';
      return s.difficulty === 'assist'
        ? 'Manqué. Ramenez le losange sur la plaque : c’est lui, pas la croix, qui montre l’impact.'
        : 'Manqué. Trop bas : montez l’élévation. Dévié par le vent : visez du côté d’où il vient, ou donnez de la dérive.';
    },
    cmd: (s) => (s.difficulty === 'assist' ? '' : k(s, 'Dérive : <b>← →</b>', 'Dérive : boutons <b>G</b> et <b>D</b>')),
    halo: (s) => (s.difficulty === 'assist' ? ['fire'] : ['w-1', 'w+1']),
    check: (s) => s.plate1Done,
  },
  {
    id: 'reload', title: 'Recharger',
    text: () => 'Le verrou se manœuvre seul après chaque tir. Le chargeur se change à la demande : faites-le.',
    cmd: (s) => k(s, '<b>R</b>', 'Bouton <b>Recharger</b>'),
    halo: () => ['reload'],
    check: (_s, f) => f.reloaded,
  },
  {
    id: 'rack', title: 'Changer d’arme',
    text: (s) => (s.rackDist < 3.6
      ? 'Ouvrez le râtelier et prenez plus tendu : le .223 Rem suffit pour 300 m.'
      : `Plaque ronde à ${fr0(s.dist2)} m : le .22 LR y tombe de plus de six mètres. La boussole mène au râtelier, ${s.site.rackHint}.`),
    cmd: (s) => k(s, '<b>E</b> devant le râtelier', s.rackDist < 3.6 ? 'Bouton <b>Râtelier</b>' : 'Le bouton <b>Râtelier</b> apparaît sous l’abri'),
    halo: () => ['rack'],
    check: (s) => !smallBore(s) || s.plate2Done,
  },
  {
    id: 'plate2', title: 'La plaque ronde',
    text: (s) => (s.difficulty === 'assist'
      ? `À vous : ${s.site.postShort}, couché, lunette. Plaque ronde à ${fr0(s.dist2)} m : ${fr1(s.need2)} mrad au ${s.caliber}, puis le losange sur l’acier.`
      : `À vous : ${s.site.postShort}, couché, lunette. Plaque ronde à ${fr0(s.dist2)} m : télémètre, carnet (${fr1(s.need2)} mrad au ${s.caliber}), tourelle, vent, souffle.`),
    cmd: () => '',
    halo: () => [],
    check: (s) => s.plate2Done,
  },
];

export const TUTO_STEPS = STEPS.map((s) => s.id);

export class Tutorial {
  index = 0;
  finished = false;
  skipped = false;
  /** étapes validées, dans l'ordre (pour les tests) */
  validated: string[] = [];
  view: TutoView | null = null;
  private flags: Flags = { looked: 0, moved: 0, atPost: false, zoomed: false, aimed: 0, ranged: false, book: false, held: 0, fired: false, missed: false, reloaded: false };
  private prev: { yaw: number; pitch: number; x: number; z: number; zoom: number; shots: number } | null = null;
  /** temps restant d'affichage de la coche avant de passer à l'étape suivante */
  private flash = 0;
  private endT = 0;

  get stepId(): string | null {
    return this.finished ? null : STEPS[this.index].id;
  }
  /** le tutoriel est-il encore à l'écran (étapes en cours ou message de fin) ? */
  get active(): boolean {
    return !this.skipped && (!this.finished || this.endT > 0);
  }

  skip(): void {
    this.skipped = true;
    this.finished = true;
    this.view = null;
  }

  /** l'impact d'un tir : sert au texte de l'étape « Observer et corriger » */
  onImpact(hit: boolean): void {
    if (!hit) this.flags.missed = true;
  }

  update(s: TutoSnap): void {
    if (this.skipped) return;
    if (this.finished) {
      this.endT -= s.dt;
      if (this.endT <= 0) this.view = null;
      return;
    }
    const f = this.flags;
    const p = this.prev;
    if (p && s.state === 'play') {
      // les sauts (téléportation, entrée en lunette) ne comptent pas comme un geste du joueur
      const dyaw = Math.abs(Math.atan2(Math.sin(s.yaw - p.yaw), Math.cos(s.yaw - p.yaw)));
      if (dyaw < 0.5 && !s.scope) f.looked += dyaw + Math.abs(s.pitch - p.pitch);
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 0.5) f.moved += d;
      if (s.scope && Math.abs(s.zoom / p.zoom - 1) > 0.01) f.zoomed = true;
      if (s.shots > p.shots) f.fired = true;
    }
    this.prev = { yaw: s.yaw, pitch: s.pitch, x: s.x, z: s.z, zoom: s.zoom, shots: s.shots };
    if (s.post === s.site.post) f.atPost = true;
    // viser la plaque : le réticule reste dessus (à 12 mrad près) un court instant
    if (s.scope && s.aimErr1 < 12) f.aimed += s.dt;
    else f.aimed = Math.max(0, f.aimed - s.dt * 2);
    // mesure : déclenchée (standard), ou lue en continu sur la plaque (assisté)
    if (s.ranged) f.ranged = true;
    if (s.difficulty === 'assist' && s.scope && s.range !== null && Math.abs(s.range - s.dist1) < 12 && s.aimErr1 < 12) f.ranged = true;
    if (s.state === 'book') f.book = true;
    if (s.scope && s.breath === 'held') f.held += s.dt;
    if (s.reloading) f.reloaded = true;

    if (this.flash > 0) {
      this.flash -= s.dt;
      if (this.flash <= 0) {
        this.index++;
        if (this.index >= STEPS.length) {
          this.finished = true;
          this.endT = 6;
          this.view = { id: 'end', n: STEPS.length, total: STEPS.length, title: 'Tutoriel terminé', text: 'Les deux plaques ont sonné. La suite se joue sans guide : briefing, boussole, carnet.', cmd: '', halo: [], done: true, finished: true };
          return;
        }
      }
    }
    const st = STEPS[this.index];
    if (this.flash <= 0 && st.check(s, f)) {
      this.validated.push(st.id);
      this.flash = 0.9;
    }
    this.view = { id: st.id, n: this.index + 1, total: STEPS.length, title: st.title, text: st.text(s, f), cmd: st.cmd(s), halo: this.flash > 0 ? [] : st.halo(s), done: this.flash > 0, finished: false };
  }
}
