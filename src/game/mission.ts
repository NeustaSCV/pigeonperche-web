// Déroulé d'une mission : objectifs du niveau dans l'ordre, jauge d'alerte, score.
import type { WeaponDef } from '../config/weapons';
import type { Difficulty } from '../levels/types';
import type { ImpactReport } from './shots';
import type { Target } from './targets';
import { SKILL_PER_STEP } from '../shared/scores-core.mjs';

export type { Difficulty };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { assist: 'Assisté', standard: 'Standard', real: 'Réaliste' };
export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  assist: 'Télémètre, vent affiché et point d’impact prédit.',
  standard: 'Télémètre et vent au tireur. Pas de prédiction.',
  real: 'Aucune aide : distance au réticule, vent lu dans le décor.',
};

export interface Step {
  id: string;
  title: string;
  targets: string[];
  brief: string;
  /** dimensions utiles pour l'estimation au réticule */
  intel: string;
  /** zone approximative */
  zone: string;
  /** postes de tir conseillés */
  posts: string;
  weapon: string;
}

export interface StepStats {
  shots: number;
  hits: number;
  time: number;
  distance: number;
  weapon: string;
  points: number;
}
export interface ShotLog {
  n: number;
  weapon: string;
  distance: number;
  tof: number;
  elev: number;
  wind: number;
  result: string;
}

export class Mission {
  difficulty: Difficulty = 'standard';
  index = 0;
  stats: StepStats[] = [];
  log: ShotLog[] = [];
  /** 0..100 */
  alert = 0;
  alarm = false;
  failed: string | null = null;
  finished = false;
  totalShots = 0;
  totalHits = 0;
  elapsed = 0;
  private cur: StepStats = { shots: 0, hits: 0, time: 0, distance: 0, weapon: '', points: 0 };
  /** délai avant de valider l'objectif (le temps de voir l'effet) */
  private completeT = -1;
  onStepDone: (step: Step, s: StepStats) => void = () => {};
  onFail: (reason: string) => void = () => {};
  onAlarm: () => void = () => {};
  running = false;

  /**
   * `steps` : objectifs du niveau ; `alertZone` : centre de la zone d'alerte (campement), ou null si la carte n'en a pas.
   */
  constructor(private targets: Map<string, Target>, readonly steps: Step[], private alertZone: { x: number; z: number } | null) {}

  get step(): Step {
    return this.steps[Math.min(this.index, this.steps.length - 1)];
  }
  currentTargets(): Target[] {
    return this.step.targets.map((id) => this.targets.get(id)!).filter(Boolean);
  }
  begin(): void {
    this.cur = { shots: 0, hits: 0, time: 0, distance: 0, weapon: '', points: 0 };
    this.completeT = -1;
    this.running = true;
  }
  update(dt: number): void {
    if (!this.running || this.finished || this.failed) return;
    this.cur.time += dt;
    this.elapsed += dt;
    this.alert = Math.max(0, this.alert - dt * 0.12);
    if (this.completeT > 0) {
      this.completeT -= dt;
      if (this.completeT <= 0) this.complete();
    }
  }
  onShot(def: WeaponDef): void {
    this.cur.shots++;
    this.totalShots++;
    this.cur.weapon = def.caliber;
    if (this.alertZone) this.addAlert(def.alert * 0.5);
  }
  /** points des tirs d'adresse (plein centre, cible en mouvement), plafonnés à SKILL_PER_STEP par objectif de la carte */
  skill = 0;
  /** Bonus d'un tir d'adresse ; renvoie les points réellement accordés. */
  addSkill(points: number): number {
    const got = Math.max(0, Math.min(Math.round(points), this.steps.length * SKILL_PER_STEP - this.skill));
    this.skill += got;
    return got;
  }
  private addAlert(v: number): void {
    this.alert = Math.min(100, this.alert + v);
    if (this.alert >= 100 && !this.alarm) {
      this.alarm = true;
      this.onAlarm();
    }
  }
  /** Traite un impact ; renvoie le texte à afficher. */
  onImpact(r: ImpactReport, elev: number, wind: number): string {
    const ok = !!r.result?.success;
    if (this.alertZone) {
      const campD = Math.hypot(r.point.x - this.alertZone.x, r.point.z - this.alertZone.z);
      if (r.campCrack < 220) this.addAlert(8);
      if (campD < 90) this.addAlert(ok ? 6 : 16);
    }
    let text = '';
    const isCurrent = r.target && this.step.targets.includes(r.target.id);
    if (r.result?.civilian) {
      this.failed = 'Un civil a été touché.';
      this.running = false;
      this.onFail(this.failed);
      text = 'Civil touché';
    } else if (r.target && r.result) {
      if (ok && isCurrent) {
        this.cur.hits++;
        this.totalHits++;
        this.cur.distance = Math.max(this.cur.distance, r.distance);
        text = 'Touché';
        if (this.currentTargets().every((t) => t.done)) this.completeT = 2.6;
      } else if (ok) {
        // cible d'un autre objectif neutralisée en avance : elle comptera le moment venu
        this.totalHits++;
        text = 'Touché (objectif à venir)';
      } else text = r.result.note ?? (r.kind === 'steel' || r.kind === 'bell' ? 'Touché' : 'Touché, sans effet');
      if (r.result.note && ok) text = r.result.note;
    } else text = r.kind === 'water' ? 'Manqué : gerbe dans l’eau' : 'Manqué';
    this.log.unshift({ n: this.totalShots, weapon: r.bullet.def.caliber, distance: r.distance, tof: r.tof, elev, wind, result: text });
    if (this.log.length > 12) this.log.pop();
    return text;
  }
  private complete(): void {
    const s = this.cur;
    const acc = s.shots > 0 ? s.hits / s.shots : 0;
    s.points = Math.round(1000 + 600 * acc + 300 * Math.max(0, 1 - s.time / 240) + s.distance * 0.5);
    this.stats.push(s);
    const step = this.step;
    this.running = false;
    this.index++;
    if (this.index >= this.steps.length) this.finished = true;
    this.onStepDone(step, s);
  }
  /** Si les cibles de l'objectif courant sont déjà neutralisées (tir en avance), on valide tout de suite. */
  checkAlreadyDone(): void {
    if (this.running && this.completeT < 0 && this.currentTargets().every((t) => t.done)) this.completeT = 0.8;
  }
  score(): { total: number; accuracy: number; discretion: number; grade: string } {
    const base = this.stats.reduce((a, s) => a + s.points, 0) + this.skill;
    const discretion = this.alarm ? 0 : Math.round(2000 * (1 - this.alert / 100));
    const diff = this.difficulty === 'real' ? 1.5 : this.difficulty === 'standard' ? 1.2 : 1;
    const total = Math.round((base + discretion) * diff);
    const accuracy = this.totalShots ? this.totalHits / this.totalShots : 0;
    const grade = accuracy > 0.85 && !this.alarm ? 'Tireur d’élite' : accuracy > 0.6 ? 'Tireur de précision' : accuracy > 0.35 ? 'Tireur confirmé' : 'Recrue';
    return { total, accuracy, discretion, grade };
  }
}
