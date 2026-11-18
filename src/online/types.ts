// Contrat entre le jeu (src/game/game.ts) et le mode en ligne. Types seulement : rien n'est exécuté ici.
// Une carte jouée en ligne déclare `data.online` (src/levels/types.ts) ; le jeu reçoit alors une fabrique de
// contrôleur (`OnlineFactory`) et appelle ce contrôleur aux points listés dans `OnlineMode`. En solo, rien de tout
// cela n'existe : `game.online` vaut null.
import type { Vector3 } from 'three';
import type { AudioEngine } from '../audio/engine';
import type { Engine } from '../core/engine';
import type { Input } from '../core/input';
import type { GameState } from '../game/game';
import type { Bullet, ImpactReport, Shots } from '../game/shots';
import type { Target } from '../game/targets';
import type { LevelData } from '../levels/types';
import type { Player } from '../player/player';
import type { HudState, UI } from '../ui/hud';
import type { TouchFrame } from '../ui/touch';
import type { Rifle } from '../weapons/rifle';
import type { Scope } from '../weapons/scope';
import type { Colliders } from '../world/colliders';
import type { Fx } from '../world/fx';
import type { Terrain } from '../world/terrain';
import type { Wind } from '../world/wind';

/**
 * Ce que le jeu prête au mode en ligne. `Game` l'implémente. `player`, `rifle`, `shots` et `fx` n'existent qu'une
 * fois la carte chargée (`loadMap()` résolue).
 */
export interface OnlineHost {
  readonly data: LevelData;
  readonly engine: Engine;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly ui: UI;
  readonly wind: Wind;
  readonly terrain: Terrain;
  readonly col: Colliders;
  readonly scope: Scope;
  readonly touch: boolean;
  readonly testMode: boolean;
  readonly state: GameState;
  /** carte chargée et boucle de jeu lancée */
  readonly ready: boolean;
  readonly player: Player;
  readonly rifle: Rifle;
  readonly shots: Shots;
  readonly fx: Fx;
  readonly targets: ReadonlyMap<string, Target>;
  /** Télécharge et construit la carte, puis lance la boucle de jeu (une seule fois). */
  loadMap(): Promise<void>;
  setState(s: GameState): void;
  /** Ajoute une cible en cours de partie (tireur du réseau) : scène, liste des cibles, vol des balles. */
  addTarget(t: Target): void;
  /** La retire de même. */
  removeTarget(t: Target): void;
  /** Écran noir qui se lève en une seconde : après avoir déplacé le joueur (`player.teleport`). */
  fadeIn(): void;
}

/** Contrôleur du mode en ligne, appelé par le jeu. Tous les appels sont absents en solo. */
export interface OnlineMode {
  /**
   * `Game.init()` : à la place du menu du solo et de son chargement différé. Au contrôleur d'afficher le salon et
   * de lancer `host.loadMap()`.
   */
  init(): Promise<void>;
  /**
   * Un coup du joueur vient de partir (à la place de `mission.onShot`). `boreDir` : ligne de visée au départ du
   * coup, tremblement et recul compris ; vecteur prêté, valable pendant l'appel seulement.
   */
  localShot(bullet: Bullet, boreDir: Vector3): void;
  /** Impact d'une balle du joueur (à la place de la mission, du conseil et du compliment) ; son et gerbe sont déjà joués. */
  impact(r: ImpactReport): void;
  /** À chaque image une fois la carte chargée, après les cibles et la mission. `dt` : temps du jeu, `dtReal` : temps réel. */
  frame(dt: number, dtReal: number): void;
  /** Juste avant l'affichage du HUD : le contrôleur masque ou complète l'état (`h` est celui du jeu, modifiable). */
  hud(h: HudState): void;
  /** Juste avant la mise à jour des commandes tactiles (appareil tactile seulement). */
  touchFrame?(f: TouchFrame): void;
  /**
   * Portrait : hauteur (px CSS) à réserver au-dessus du champ de la lunette, comme la carte du tutoriel en solo.
   * Quand elle change, le contrôleur appelle `host.engine.updateView()`.
   */
  scopeInset?(): number;
  /**
   * Portrait : hauteur à réserver en plus sous le champ de la lunette, entre lui et les boutons du bas, en pixels CSS
   * à l'échelle 1 (le jeu la multiplie par l'échelle des commandes tactiles, `--ts`).
   */
  scopeBelow?(): number;
  /** Pause, « Quitter la manche » (à la place de « Recommencer la mission ») : retour au salon. */
  leave?(): void;
  /** Un cran de tourelle vient de tourner : le contrôleur joue le sien, celui du solo se tait. */
  turretClick?(): void;
  /** Vrai : la détente ne fait rien (spectateur, tireur abattu). */
  holdFire?(): boolean;
}

export type OnlineFactory = (host: OnlineHost) => OnlineMode;
