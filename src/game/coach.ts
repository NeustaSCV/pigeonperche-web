// Conseil après plusieurs tirs manqués sur une même cible : quand le proposer, quoi dire. Logique pure, sans DOM ni
// moteur : le jeu lui rapporte chaque impact et lui fournit les chiffres (distance connue, solution de tir, vent) ;
// l'interface affiche le résultat. Rien n'est calculé à chaque image : un conseil est composé au moment où il s'ouvre.
import type { FiringSolution } from '../ballistics/firing-solution';
import type { WeaponDef } from '../config/weapons';
import type { Difficulty } from './mission';

/** tirs manqués de suite sur la même cible avant le premier conseil */
export const MISS_THRESHOLD = 3;
/** tirs manqués supplémentaires avant l'unique rappel */
export const REMIND_AFTER = 4;
/** touches sans effet (énergie ou pénétration insuffisante) avant de parler du calibre */
export const WEAK_THRESHOLD = 2;
/** au-delà de cet écart angulaire (mrad), un impact n'est pas un tir manqué sur cette cible : le joueur visait ailleurs */
export const AIM_WINDOW_MIL = 40;
/** vitesse du son de l'air du jeu, m/s (GAME_AIR) */
const SOS = 342;

/** écart d'un impact par rapport à la cible, vu du tireur, en mrad (haut et droite positifs) */
export interface MissOffset { up: number; right: number }
export type ShotOutcome =
  | { kind: 'hit'; target: string }
  /** cible atteinte sans effet : le projectile n'avait pas l'énergie ou la pénétration voulues */
  | { kind: 'weak'; target: string }
  /** `offset` null : écart non mesurable */
  | { kind: 'miss'; target: string; offset: MissOffset | null };

export type CoachSignal = { show: 'miss' | 'weak'; reminder: boolean } | { hide: true } | null;

/**
 * Suit les tirs sur la cible en cours. Un conseil par cible au troisième tir manqué de suite (sans touche entre-temps),
 * puis au plus un rappel quatre tirs manqués plus tard ; une touche le referme et remet le compte à zéro.
 */
export class CoachTracker {
  /** conseil affiché en ce moment */
  visible = false;
  private target = '';
  private misses: (MissOffset | null)[] = [];
  private weak = 0;
  private seen = new Map<string, { shown: number; since: number; weakShown: boolean }>();

  /** tirs manqués de suite sur la cible en cours */
  get streak(): number {
    return this.misses.length;
  }
  /** écarts des derniers tirs manqués (les plus récents en dernier) */
  get offsets(): (MissOffset | null)[] {
    return this.misses.slice(-MISS_THRESHOLD);
  }

  record(o: ShotOutcome): CoachSignal {
    if (o.target !== this.target) { this.target = o.target; this.misses = []; this.weak = 0; }
    let st = this.seen.get(o.target);
    if (!st) this.seen.set(o.target, (st = { shown: 0, since: 0, weakShown: false }));
    if (o.kind === 'hit') {
      this.misses = [];
      this.weak = 0;
      st.since = 0;
      const was = this.visible;
      this.visible = false;
      return was ? { hide: true } : null;
    }
    if (o.kind === 'weak') {
      // la visée est bonne : ce n'est pas un tir manqué, mais l'arme ne suffit pas
      this.misses = [];
      this.weak++;
      if (this.weak >= WEAK_THRESHOLD && !st.weakShown) { st.weakShown = true; this.visible = true; return { show: 'weak', reminder: false }; }
      return null;
    }
    this.misses.push(o.offset);
    if (st.shown > 0) st.since++;
    const first = st.shown === 0 && this.misses.length >= MISS_THRESHOLD;
    const again = st.shown === 1 && st.since >= REMIND_AFTER;
    if (!first && !again) return null;
    st.shown++;
    st.since = 0;
    this.visible = true;
    return { show: 'miss', reminder: again };
  }
  /** le joueur ferme le conseil : il ne reviendra qu'en rappel */
  dismiss(): void {
    this.visible = false;
  }
  /** objectif validé, mission relancée : le suivi de la cible en cours repart de zéro */
  clear(): void {
    this.visible = false;
    this.target = '';
    this.misses = [];
    this.weak = 0;
  }
}

// ---------------------------------------------------------------- diagnostic des impacts
export interface Diagnosis {
  /** nombre d'impacts mesurés */
  n: number;
  /** écart vertical commun, mrad (valeur absolue) ; null si les impacts ne sont pas du même côté */
  vertical: { mil: number; low: boolean } | null;
  horizontal: { mil: number; left: boolean } | null;
  /** impacts sans tendance mais très étalés : étendue en mrad */
  scattered: number | null;
}

/**
 * Tendance des derniers tirs manqués. Un axe est retenu si tous les impacts mesurés sont du même côté, à 0,3 mrad au
 * moins en moyenne, et groupés (étendue ≤ 0,6 mrad ou 80 % de la moyenne). Moins de deux impacts mesurés : rien.
 */
export function diagnose(offsets: (MissOffset | null)[]): Diagnosis | null {
  const m = offsets.filter((o): o is MissOffset => !!o && Number.isFinite(o.up) && Number.isFinite(o.right)).slice(-MISS_THRESHOLD);
  if (m.length < 2) return null;
  const axis = (vals: number[]): { mean: number; spread: number; ok: boolean } => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const spread = Math.max(...vals) - Math.min(...vals);
    const sameSide = vals.every((v) => v > 0) || vals.every((v) => v < 0);
    return { mean, spread, ok: sameSide && Math.abs(mean) >= 0.3 && spread <= Math.max(0.6, 0.8 * Math.abs(mean)) };
  };
  const v = axis(m.map((o) => o.up)), h = axis(m.map((o) => o.right));
  const d: Diagnosis = {
    n: m.length,
    vertical: v.ok ? { mil: Math.abs(v.mean), low: v.mean < 0 } : null,
    horizontal: h.ok ? { mil: Math.abs(h.mean), left: h.mean < 0 } : null,
    scattered: null,
  };
  if (!d.vertical && !d.horizontal) {
    const spread = Math.max(v.spread, h.spread);
    if (spread > 1.5) d.scattered = spread;
    else return null;
  }
  return d;
}

// ---------------------------------------------------------------- l'arme convient-elle à cette distance ?
export type FitIssue =
  /** le projectile n'atteint pas la distance */
  | { kind: 'range' }
  /** arme supersonique arrivée sous Mach 1 */
  | { kind: 'subsonic'; mach: number }
  /** arme supersonique arrivée sous Mach 1,2 : zone transsonique, la dispersion s'ouvre */
  | { kind: 'transonic'; mach: number }
  /** élévation au-delà de la course de la tourelle : le reste se prend en contre-visée */
  | { kind: 'turret'; elev: number; max: number }
  /** le vent du moment déporte la balle de bien plus que la largeur de la cible */
  | { kind: 'wind'; drift: number; mil: number; width: number }
  /** cible touchée sans effet */
  | { kind: 'energy'; energy: number };

/** une autre arme est « nettement meilleure » au vent si elle dérive au plus moitié moins que l'arme en main */
export const WIND_BETTER = 0.5;
/** gravité d'un défaut, pour comparer deux armes quand aucune n'est sans reproche */
const WEIGHT: Record<FitIssue['kind'], number> = { range: 100, subsonic: 10, transonic: 5, turret: 2, wind: 0, energy: 0 };
const severity = (issues: FitIssue[]): number => issues.reduce((a, i) => a + WEIGHT[i.kind], 0);

/**
 * Défauts propres à l'arme pour ce tir, d'après sa solution de tir réelle (`solution` : vent du moment compris ; null
 * si la cible est hors de portée). Liste vide : rien à lui reprocher. `weak` : la cible vient d'être touchée sans effet.
 * Le critère du vent, lui, se juge par rapport aux autres armes du râtelier : voir `assessWeapon`.
 */
export function weaponIssues(w: WeaponDef, solution: FiringSolution | null, opt: { weak?: boolean } = {}): FitIssue[] {
  if (!solution) return [{ kind: 'range' }];
  const out: FitIssue[] = [];
  // une arme subsonique dès la bouche (.22 LR, .308 subsonique) ne traverse pas le mur du son : le critère ne la concerne pas
  if (w.v0 / SOS > 1.2) {
    if (solution.mach < 1) out.push({ kind: 'subsonic', mach: solution.mach });
    else if (solution.mach < 1.2) out.push({ kind: 'transonic', mach: solution.mach });
  }
  if (solution.elevMil > w.turretMaxMil + 0.05) out.push({ kind: 'turret', elev: solution.elevMil, max: w.turretMaxMil });
  if (opt.weak) out.push({ kind: 'energy', energy: solution.energy });
  return out;
}

/**
 * L'arme en main convient-elle à ce tir, et sinon lesquelles du râtelier feraient mieux ?
 * - défauts propres (`weaponIssues`) : hors de portée, transsonique ou subsonique à l'arrivée, élévation au-delà de la
 *   tourelle, énergie insuffisante constatée ;
 * - vent : la balle dérive de plus que la largeur de la cible par le vent du moment ET une arme du râtelier, sans
 *   défaut à cette distance, dérive au plus moitié moins. Une dérive forte que tout le râtelier partage est un tir
 *   difficile, pas une arme mal choisie.
 * Suggestions : une ou deux armes sans défaut (et nettement meilleures sur le point en cause), les moins puissantes
 * d'abord : inutile de sortir le plus gros calibre. Si aucune n'est sans défaut (très longue distance), celles dont les
 * défauts sont nettement moins graves. Aucune suggestion si l'arme convient.
 */
export function assessWeapon(current: WeaponDef, rack: WeaponDef[], solve: (w: WeaponDef) => FiringSolution | null, opt: { targetWidth?: number | null; weak?: boolean; weakEnergy?: number | null } = {}): { issues: FitIssue[]; alternatives: WeaponDef[] } {
  const sol = solve(current);
  const issues = weaponIssues(current, sol, { weak: opt.weak });
  let sound: { w: WeaponDef; s: FiringSolution }[] = [];
  const flawed: { w: WeaponDef; sev: number }[] = [];
  for (const w of rack) {
    if (w.id === current.id || w.caliber === current.caliber) continue;
    const s = solve(w);
    const own = weaponIssues(w, s);
    if (s && !own.length) sound.push({ w, s });
    else flawed.push({ w, sev: severity(own) });
  }
  if (opt.weak && opt.weakEnergy != null) sound = sound.filter((c) => c.s.energy >= 1.5 * opt.weakEnergy! && c.w.penetration > current.penetration);
  const width = opt.targetWidth ?? 0;
  if (sol && width > 0) {
    const drift = Math.abs(sol.deflection.wind);
    const better = sound.filter((c) => Math.abs(c.s.deflection.wind) <= WIND_BETTER * drift);
    if (drift > width && better.length) {
      issues.push({ kind: 'wind', drift, mil: Math.abs(sol.parts.wind), width });
      sound = better;
    }
  }
  if (!issues.length) return { issues, alternatives: [] };
  if (!sound.length && !opt.weak) {
    const mine = severity(issues);
    return { issues, alternatives: flawed.filter((c) => c.sev <= mine - 3).sort((a, b) => a.sev - b.sev || a.w.chargeGr - b.w.chargeGr).slice(0, 2).map((c) => c.w) };
  }
  return { issues, alternatives: sound.map((c) => c.w).sort((a, b) => a.chargeGr - b.chargeGr).slice(0, 2) };
}

// ---------------------------------------------------------------- composition du conseil
export interface CoachContext {
  touch: boolean;
  /** aides en vigueur : `assist` (distance et impact prédit affichés), `standard` (télémètre), `real` (aucune aide) */
  difficulty: Difficulty;
  reason: 'miss' | 'weak';
  reminder: boolean;
  /** tirs manqués de suite */
  misses: number;
  weapon: WeaponDef;
  /** distance connue du joueur (mesurée au télémètre sur cette cible, ou affichée par l'aide), m ; null sinon */
  range: number | null;
  /** solution de tir de l'arme en main sur cette cible, vent du moment compris ; null si hors de portée */
  solution: FiringSolution | null;
  /** réglages actuels des tourelles, mrad */
  elevDial: number;
  windDial: number;
  /** vitesse du vent au tireur si elle est affichée au joueur, m/s ; null sinon */
  windSpeed: number | null;
  diagnosis: Diagnosis | null;
  issues: FitIssue[];
  alternatives: WeaponDef[];
  /** repères du briefing (dimensions de la cible) : servent à l'estimation au réticule */
  intel: string;
  /** le carnet du niveau est décomposé (Coriolis, dérive gyroscopique, saut aérodynamique) */
  advancedBook: boolean;
}

export interface Advice {
  title: string;
  /** ce que le jeu a mesuré des impacts ; vide si rien de mesurable */
  diag: string;
  /** pourquoi il faut corriger */
  why: string;
  /** étapes courtes, dans l'ordre (HTML : commandes en <b>) */
  steps: string[];
  /** suggestion de calibre ; vide si l'arme convient */
  calibre: string;
  /** version d'une ou deux lignes (portrait, en lunette) */
  short: string;
  /** comment fermer */
  close: string;
}

const fr = (n: number, d = 0): string => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const clicks = (mil: number): string => { const n = Math.round(Math.abs(mil) * 10); return `${n} clic${n > 1 ? 's' : ''}`; };
const NUM = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
const count = (n: number): string => NUM[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** réglage de dérive : « 0,6 mrad à gauche », « 0,0 » */
const side = (mil: number): string => (Math.abs(mil) < 0.05 ? '0,0 mrad' : `${fr(Math.abs(mil), 1)} mrad à ${mil > 0 ? 'droite' : 'gauche'}`);

/**
 * Ce que l'encart sait du réglage d'un axe quand il cite les chiffres du carnet : `gap` = valeur demandée − réglage de
 * la tourelle, mrad (positif : il faut monter, ou aller à droite). null : le carnet n'est pas chiffré dans l'encart
 * (distance inconnue, niveau sans aide) et l'écart mesuré est alors la seule consigne.
 */
interface AxisPlan { gap: number | null }
/** en deçà, la tourelle est « à la valeur du carnet » (un demi-clic) */
const AT_BOOK = 0.05;
/** écart mesuré et écart tourelle/carnet tenus pour identiques en deçà, mrad */
const SAME = 0.3;

/**
 * Diagnostic des impacts. Règle : UNE consigne chiffrée par axe dans tout l'encart.
 * - carnet non chiffré dans l'encart : la consigne est l'écart mesuré (ici) ;
 * - tourelle pas à la valeur du carnet : la consigne est celle de l'étape (3 pour l'élévation, 4 pour la dérive) ; le
 *   diagnostic donne la mesure, sans chiffrer de correction, et dit comment la lire (c'est l'écart du réglage, ou
 *   il restera de la visée ou du vent, ou le joueur compense déjà en contre-visée) ;
 * - tourelle déjà à la valeur du carnet : la consigne est l'écart mesuré, à prendre au réticule pour ne pas dérégler
 *   la tourelle (l'étape se borne alors à constater que la tourelle est juste).
 */
function diagText(d: Diagnosis | null, c: CoachContext, plan: { v: AxisPlan; h: AxisPlan }): { text: string; short: string } {
  if (!d) return { text: '', short: '' };
  const n = `${d.n === 2 ? 'Vos deux' : `Vos ${count(d.n)}`} derniers tirs`;
  if (d.scattered !== null) return { text: `${n} sont dispersés sur ${fr(d.scattered, 1)} mrad, sans tendance nette : ${c.touch ? 'tenez <b>Souffle</b>' : 'retenez votre souffle (<b>Espace</b>)'} et attendez que le réticule se pose avant de presser la détente.`, short: `Impacts dispersés (${fr(d.scattered, 1)} mrad) : retenez votre souffle.` };
  const parts: string[] = [], fix: string[] = [], notes: string[] = [], sh: string[] = [];
  const both = !!d.vertical && !!d.horizontal;
  if (d.vertical) {
    const { mil, low } = d.vertical, gap = plan.v.gap;
    const where = low ? 'bas' : 'haut';
    parts.push(`environ ${fr(mil, 1)} mrad trop ${where}`);
    sh.push(`${fr(mil, 1)} mrad trop ${where}`);
    const k = both ? 'En hauteur : ' : '';
    if (gap === null) fix.push(`${low ? 'montez' : 'descendez'} l’élévation de ${fr(mil, 1)} mrad (${clicks(mil)})`);
    else if (Math.abs(gap) < AT_BOOK) notes.push(`${k}${both ? 'v' : 'V'}otre tourelle est déjà à la valeur du carnet : l’écart vient de la visée, de la tenue de l’arme ou du vent. Pour le rattraper sans la dérégler, visez ${fr(mil, 1)} mrad plus ${low ? 'haut' : 'bas'}, sur les graduations du réticule.`);
    // tourelle sous le carnet et tirs bas (ou l'inverse) : le réglage explique tout ou partie de l'écart
    else if (gap > 0 === low) notes.push(Math.abs(mil - Math.abs(gap)) <= SAME
      ? `${k}${both ? 'c' : 'C'}’est à peu près ce qui manque à votre tourelle pour cette distance : mettez-la à la valeur du carnet (étape 3).`
      : `${k}${both ? 'l' : 'L'}a tourelle n’est pas réglée pour cette distance : commencez par la mettre à la valeur du carnet (étape 3). Si les tirs restent ${low ? 'bas' : 'hauts'} ensuite, c’est la visée ou le vent.`);
    else notes.push(`${k}${both ? 'v' : 'V'}otre tourelle est pourtant ${gap > 0 ? 'sous' : 'au-dessus de'} la valeur du carnet : vous visez sans doute ${gap > 0 ? 'au-dessus' : 'en dessous'} de la cible pour compenser. Mettez-la à la valeur du carnet (étape 3), puis visez le centre.`);
  }
  if (d.horizontal) {
    const { mil, left } = d.horizontal, gap = plan.h.gap;
    const where = left ? 'gauche' : 'droite', back = left ? 'droite' : 'gauche';
    parts.push(`${d.vertical ? '' : 'environ '}${fr(mil, 1)} mrad trop à ${where}`);
    sh.push(`${fr(mil, 1)} mrad trop à ${where}`);
    const k = both ? 'En dérive : ' : '';
    if (gap === null) fix.push(`corrigez la dérive de ${fr(mil, 1)} mrad à ${back}`);
    else if (Math.abs(gap) < AT_BOOK) notes.push(`${k}${both ? 'v' : 'V'}otre tourelle est déjà à la valeur que demande ce vent : il a pu tourner, ou la visée a glissé. Pour rattraper l’écart sans la dérégler, visez ${fr(mil, 1)} mrad plus à ${back}, sur les graduations du réticule.`);
    // il manque de la dérive à droite et les tirs passent à gauche (ou l'inverse)
    else if (gap > 0 === left) notes.push(Math.abs(mil - Math.abs(gap)) <= SAME
      ? `${k}${both ? 'c' : 'C'}’est à peu près ce qui manque à votre tourelle de dérive par ce vent : réglez-la comme indiqué à l’étape 4.`
      : `${k}${both ? 'l' : 'L'}a dérive n’est pas réglée pour ce vent : commencez par là (étape 4). Si les tirs restent à ${where} ensuite, c’est la visée ou une saute de vent.`);
    else notes.push(`${k}${both ? 'v' : 'V'}otre tourelle de dérive est pourtant décalée dans l’autre sens : vous visez sans doute à côté de la cible pour compenser. Réglez-la comme indiqué à l’étape 4, puis visez le centre.`);
  }
  const direct = fix.length ? ` Le plus direct : ${fix.join(', puis ')}.` : '';
  return { text: `${n} sont passés ${parts.join(' et ')}.${direct}${notes.length ? ' ' + notes.join(' ') : ''}`, short: `Impacts ${sh.join(', ')}.` };
}

function calibreText(c: CoachContext): { text: string; short: string } {
  if (!c.issues.length) return { text: '', short: '' };
  const w = c.weapon;
  // sans télémètre, la distance n'est pas révélée
  const at = c.range !== null ? `À ${fr(Math.round(c.range))} m` : 'À cette distance';
  const why: string[] = [];
  for (const i of c.issues) {
    if (i.kind === 'range') why.push('n’atteint pas la cible');
    else if (i.kind === 'subsonic') why.push(`arrive sous la vitesse du son (Mach ${fr(i.mach, 2)}) : il a traversé la zone transsonique, où la balle est bousculée`);
    else if (i.kind === 'transonic') why.push(`arrive en transsonique (Mach ${fr(i.mach, 2)}) : la balle y est moins stable et la dispersion s’ouvre`);
    else if (i.kind === 'turret' && c.range === null) why.push(`demande plus d’élévation que la course de sa tourelle (${fr(i.max, 1)} mrad) : le reste doit se prendre en contre-visée au réticule`);
    else if (i.kind === 'turret') why.push(`demande ${fr(i.elev, 1)} mrad d’élévation pour une tourelle qui s’arrête à ${fr(i.max, 1)} : le reste doit se prendre en contre-visée au réticule`);
    else if (i.kind === 'wind') why.push(c.windSpeed !== null ? `dérive de ${fr(i.mil, 1)} mrad par ce vent, soit ${fr(i.drift, 1)} m pour une cible de ${fr(i.width, 1)} m` : 'dérive au vent de plusieurs fois la largeur de la cible');
    else why.push(`n’a plus que ${fr(Math.round(i.energy / 10) * 10)} J à l’arrivée : la cible est touchée, mais elle résiste`);
  }
  const rack = c.touch ? 'bouton <b>Râtelier</b>, près du râtelier' : 'touche <b>E</b>, près du râtelier';
  const alt = c.alternatives.map((a) => `<b>${a.name}</b> (${a.caliber})`);
  const tail = alt.length
    ? `Une arme plus adaptée sera plus régulière : ${alt.join(' ou ')}. On en change au râtelier (${rack}).`
    : `Aucune arme du râtelier ne fait nettement mieux ici : appliquez la correction du carnet et soignez la lecture du vent.`;
  return {
    text: `${at}, le ${w.caliber} ${why.join(' ; il ')}. ${tail}`,
    short: alt.length ? `${w.caliber} à la peine ici : essayez le ${c.alternatives[0].caliber} (râtelier).` : `${w.caliber} à la peine à cette distance.`,
  };
}

/** Compose le conseil pour la situation donnée. Textes en HTML simple : les seules balises sont des <b> de commandes. */
export function buildAdvice(c: CoachContext): Advice {
  const t = c.touch, w = c.weapon, s = c.solution;
  const known = c.range !== null && s !== null;
  const title = c.reason === 'weak' ? 'Touché, mais sans effet' : c.reminder ? 'Toujours pas au but' : `${cap(count(c.misses))} tirs manqués : reprenons le réglage`;
  const cal = calibreText(c);
  const steps: string[] = [];
  let why: string;
  // élévation « du carnet » : chute (pente comprise) et Coriolis vertical, sans le vent
  // (en deçà de la distance de zérotage elle serait négative : la tourelle ne descend pas sous zéro)
  const book = known ? Math.max(0, s!.parts.drop + s!.parts.coriolisV) : 0;
  /** la cible est à la distance de zérotage, ou plus près : rien à régler en élévation */
  const atZero = known && book < 0.05;
  const fall = (): string => atZero
    ? `À ${fr(Math.round(c.range!))} m, vous êtes à la distance de zérotage du ${w.caliber} (${w.zero} m) ou en deçà : la balle n’a pas encore eu le temps de tomber, aucune élévation n’est à ajouter. Si les tirs passent à côté, c’est la tourelle qui n’est pas à zéro, le vent, ou la tenue de l’arme.`
    : `Une balle tombe dès qu’elle quitte le canon : à ${fr(Math.round(c.range!))} m, celle du ${w.caliber} est descendue de ${fr(Math.abs(s!.deflection.drop), 2)} m. La lunette doit donc viser plus haut de ${fr(book, 1)} mrad (1 mrad = 10 cm à 100 m).`;
  const gap = book - c.elevDial;
  const dialLine = known
    ? Math.abs(gap) < 0.05
      ? `Votre tourelle est à ${fr(c.elevDial, 1)} mrad : c’est la valeur du carnet.`
      : `Votre tourelle est à ${fr(c.elevDial, 1)} mrad, le carnet donne ${fr(book, 1)} : ${gap > 0 ? 'montez' : 'descendez'} de ${fr(Math.abs(gap), 1)} mrad (${clicks(gap)}).`
    : '';
  const hold = known && book > w.turretMaxMil + 0.05 ? ` La tourelle s’arrête à ${fr(w.turretMaxMil, 1)} mrad : le reste se vise plus haut, sur les graduations du réticule.` : '';
  /** dérive demandée par le vent du moment − réglage de la tourelle ; null si l'encart ne la chiffre pas */
  const windGap = known && c.windSpeed !== null && c.difficulty !== 'real' ? s!.windMil - c.windDial : null;
  const windLine = (): string => {
    if (windGap === null) return '';
    const need = s!.windMil;
    if (Math.abs(need) < 0.05 && Math.abs(c.windDial) < 0.05) return ` Ici le vent de ${fr(c.windSpeed!, 1)} m/s ne demande aucune correction.`;
    if (Math.abs(windGap) < AT_BOOK) return ` Ici, avec ${fr(c.windSpeed!, 1)} m/s de vent, il faut ${side(need)} : votre tourelle y est.`;
    return ` Ici, avec ${fr(c.windSpeed!, 1)} m/s de vent, il faut ${side(need)} et votre tourelle est à ${side(c.windDial)} : tournez-la de ${clicks(windGap)} vers la ${windGap > 0 ? 'droite' : 'gauche'}.`;
  };
  const diag = diagText(c.diagnosis, c, { v: { gap: known && c.difficulty !== 'real' ? gap : null }, h: { gap: windGap } });
  let short = diag.short;

  if (c.difficulty === 'real') {
    why = 'Une balle tombe dès qu’elle quitte le canon, et de plus en plus vite avec la distance : la lunette doit viser plus haut, d’un angle que le carnet donne en mrad. Ici, pas de télémètre : tout commence par une bonne estimation de la distance.';
    steps.push(`<b>Estimez la distance au réticule</b> : taille connue de la cible (m) ÷ taille lue dans la lunette (mrad) × 1 000. Une plaque de 1 m qui couvre 0,5 mrad est à 2 000 m. Repères du briefing : ${c.intel}`);
    steps.push(`${t ? 'Bouton <b>Carnet</b>' : '<b>Tab</b>'} : le carnet de tir${c.advancedBook ? ' décomposé' : ''}. Sur la ligne de cette distance, l’<b>Élévation</b> (chute${c.advancedBook ? ' + Coriolis' : ''}) et la <b>Dérive</b>${c.advancedBook ? ' (dérive gyroscopique + Coriolis)' : ''} se lisent sans vent.`);
    steps.push(`${t ? 'Boutons <b>− +</b> de l’élévation' : '<b>↑ ↓</b>'} : reportez l’élévation sur la tourelle, 0,1 mrad par clic. Elle est à ${fr(c.elevDial, 1)} mrad. Au-delà de sa course (${fr(w.turretMaxMil, 1)} mrad), le reste se prend en contre-visée, sur les graduations sous le centre du réticule.`);
    steps.push(`${t ? 'Boutons <b>G D</b>' : '<b>← →</b>'} : ajoutez la correction du vent, à lire sur les fanions et le mirage, du côté d’où il vient. Le carnet la donne pour 5 m/s de plein travers : la moitié pour 2,5 m/s.`);
    if (!short) short = 'Estimez la distance au réticule (taille ÷ mrad × 1 000), puis lisez le carnet.';
  } else if (c.difficulty === 'assist') {
    why = known
      ? fall()
      : 'Une balle tombe dès qu’elle quitte le canon, et de plus en plus avec la distance : la lunette doit viser plus haut, d’un angle que le carnet donne en mrad (1 mrad = 10 cm à 100 m).';
    steps.push(known ? `La <b>distance</b> est affichée en haut à droite de la lunette : ${fr(Math.round(c.range!))} m.` : 'En lunette, la <b>distance</b> de ce que vous visez est affichée en haut à droite.');
    steps.push(`${t ? 'Bouton <b>Carnet</b>' : '<b>Tab</b>'} : le carnet de tir. Lisez la ligne de cette distance, colonne <b>Élévation</b>.`);
    steps.push(`${t ? 'Boutons <b>− +</b> de l’élévation' : '<b>↑ ↓</b>'} : reportez-la sur la tourelle, 0,1 mrad par clic. ${dialLine}${hold}`.trim());
    steps.push(`Le <b>losange orange</b> montre où la balle arrivera : ${t ? 'boutons <b>G D</b>' : '<b>← →</b>'} pour la dérive, jusqu’à ce qu’il se pose sur la cible.${windLine()}`);
    if (known) short += `${short ? ' ' : ''}Carnet à ${fr(Math.round(c.range!))} m : ${fr(book, 1)} mrad ; tourelle : ${fr(c.elevDial, 1)}.`;
    else if (!short) short = 'Lisez la distance affichée, puis le carnet : reportez l’élévation sur la tourelle.';
  } else {
    why = known
      ? fall()
      : 'Une balle tombe dès qu’elle quitte le canon, et de plus en plus avec la distance : à 400 m, une balle de .308 est déjà descendue d’un mètre. La lunette doit viser plus haut, d’un angle que le carnet donne en mrad (1 mrad = 10 cm à 100 m).';
    steps.push(known ? `<b>Distance</b> : vous l’avez mesurée, ${fr(Math.round(c.range!))} m. (${t ? 'Bouton <b>Télémètre</b>' : '<b>T</b>'} en visant la cible, pour la relire.)` : `${t ? 'Bouton <b>Télémètre</b>' : '<b>T</b>'} en visant la cible : le télémètre affiche sa <b>distance</b> en haut à droite.`);
    steps.push(`${t ? 'Bouton <b>Carnet</b>' : '<b>Tab</b>'} : le carnet de tir. Lisez la ligne de cette distance, colonne <b>Élévation</b>${known ? ` : ${fr(book, 1)} mrad` : ''}.`);
    steps.push(`${t ? 'Boutons <b>− +</b> de l’élévation' : '<b>↑ ↓</b>'} : reportez-la sur la tourelle, 0,1 mrad par clic. ${dialLine}${hold}`.trim());
    steps.push(`${t ? 'Boutons <b>G D</b>' : '<b>← →</b>'} : corrigez la dérive du côté d’où vient le vent. Le carnet la donne pour 5 m/s de plein travers.${windLine()}`);
    if (known) short += `${short ? ' ' : ''}Carnet à ${fr(Math.round(c.range!))} m : ${fr(book, 1)} mrad ; tourelle : ${fr(c.elevDial, 1)}.`;
    else if (!short) short = `Mesurez la distance (${t ? 'Télémètre' : 'T'}), lisez le carnet (${t ? 'Carnet' : 'Tab'}), reportez l’élévation.`;
  }
  if (c.reason === 'weak') {
    why = 'Votre visée est bonne : la balle arrive sur la cible, mais sans assez d’énergie ou de pénétration pour elle. C’est le calibre qu’il faut revoir, pas le réglage.';
    steps.length = 0;
    short = cal.short;
  } else if (cal.short) short = (diag.short ? diag.short + ' ' : '') + cal.short; // bandeau court : l'arme d'abord, les chiffres du carnet se lisent hors lunette
  return { title, diag: diag.text, why, steps, calibre: cal.text, short, close: t ? '' : '<b>Entrée</b> pour fermer' };
}
