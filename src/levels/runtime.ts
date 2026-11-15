// Ce que le jeu prête à une carte à chaque image (`LevelScene.frame`) pour ses mécaniques propres : série
// chronométrée, bonus d'enchaînement, fenêtre de tir courte, alerte qui monte, passage d'un étage à l'autre.
// Tout est facultatif pour la carte : une carte sans `frame` se joue comme avant.
import type { AudioEngine } from '../audio/engine';
import type { Mission } from '../game/mission';
import type { Target } from '../game/targets';
import type { Player } from '../player/player';

export interface LevelRuntime {
  /** temps de jeu écoulé depuis l'image précédente, s (0 en pause) ; temps de jeu cumulé, s (celui de `TargetCtx.time`) */
  dt: number;
  time: number;
  /** état du jeu : 'menu', 'brief', 'play', 'pause', 'rack', 'book', 'fail', 'end' */
  state: string;
  /** vrai quand l'objectif en cours se joue (état 'play', mission lancée, ni finie ni en échec) */
  playing: boolean;
  /** mission : objectif courant (`mission.step`), alerte (`raiseAlert`, `alert`, `alarm`), bonus (`addBonus`) */
  mission: Mission;
  /** identifiant de l'objectif en cours */
  stepId: string;
  targets: Map<string, Target>;
  player: Player;
  /** le joueur regarde dans la lunette */
  inScope: boolean;
  audio: AudioEngine;
  /** message central (comme « Touché ») : titre, ligne secondaire, durée en secondes */
  toast(text: string, sub?: string, seconds?: number): void;
  /**
   * Ligne propre à la carte sous le titre de l'objectif, visible aussi en lunette (chronomètre, série en cours…).
   * HTML court (`<b>` pour la valeur) ; null ou '' pour l'effacer. À rappeler chaque image tant qu'elle doit rester.
   */
  banner(html: string | null): void;
  /** Échec de l'objectif en cours (écran « Mission interrompue », puis reprise de l'objectif par `LevelScene.retry`). */
  fail(reason: string): void;
  /** Fondu au noir bref (un changement d'étage, une téléportation par `player.teleport`). */
  fade(): void;
}
