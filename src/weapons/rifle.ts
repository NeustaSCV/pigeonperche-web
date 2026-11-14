// Carabine : modèle procédural (géométrie dans rifle-model.ts) et état mécanique (chargeur, verrou, tourelles).
import { Group, Mesh, Object3D, type Vector3 } from 'three';
import type { Engine } from '../core/engine';
import { CLICK_MIL, buildOf, type WeaponDef } from '../config/weapons';
import { rifleBlueprint, rifleMaterial, type RifleInfo } from './rifle-model';

export interface RifleParts {
  group: Group;
  /** verrou : origine sur l'axe de la culasse, recule le long de −Z */
  bolt: Object3D;
  /** bipied : origine à l'articulation, pieds vers −Y */
  bipod: Object3D;
  /** chargeur : origine au centre du chargeur en place. Arme à un coup : la cartouche, montrée pendant le rechargement */
  magazine: Object3D;
  /** positions de repos du verrou et du chargeur (les nœuds sont animés par src/weapons/handling.ts) */
  boltRest: Vector3;
  magRest: Vector3;
  /** retrait du chargeur : direction et course, repère de l'arme */
  magOut: Vector3;
  /** arme à un coup (pas de chargeur) */
  single: boolean;
  /** poids lissés de l'ancrage des mains à l'arme (0 : pose libre, 1 : mains sur l'arme) et de la tenue couchée */
  hands: { hold: number; prone: number };
  /** repères dans le repère de l'arme (grip, forend, cheek, butt, mag, muzzle, eye, bolt_handle, bipod_feet_l, bipod_feet_r) */
  anchors: Record<string, Vector3>;
  info: RifleInfo;
}

/**
 * Modèle 3D propre à chaque arme, à l'échelle réelle : canon vers +Z, haut +Y, origine à la détente (axe du canon
 * à y = 0,035), côté droit = −X. `lod` 0 : arme en main (verrou, bipied et chargeur en nœuds séparés, 4 appels de
 * dessin) ; `lod` 1 : version allégée pour le râtelier (verrou et chargeur fondus dans le corps).
 */
export function buildRifleModel(engine: Engine, def: WeaponDef, lod: 0 | 1 = 0): RifleParts {
  const bp = rifleBlueprint(def, lod === 0 ? 1 : 0.5);
  const mat = rifleMaterial(engine);
  const group = new Group();
  group.name = 'rifle_' + def.id;
  const bolt = new Object3D();
  bolt.position.copy(bp.boltPos);
  const bipod = new Object3D();
  bipod.position.copy(bp.bipodPos);
  const magazine = new Object3D();
  magazine.position.copy(bp.magPos);
  const body = new Mesh(lod === 0 ? bp.main : bp.merged, mat);
  body.castShadow = true;
  group.add(body, bolt, bipod, magazine);
  if (lod === 0) {
    bolt.add(new Mesh(bp.bolt, mat));
    magazine.add(new Mesh(bp.mag, mat));
  }
  bipod.add(new Mesh(bp.bipod, mat));
  const single = buildOf(def).feed === 'single';
  if (single) magazine.visible = false;
  return { group, bolt, bipod, magazine, boltRest: bp.boltPos.clone(), magRest: bp.magPos.clone(), magOut: bp.magOut, single, anchors: bp.anchors, info: bp.info, hands: { hold: 0, prone: 0 } };
}

/** Rechargement d'une arme à un coup, en fraction de sa durée : culasse ouverte, cartouche posée, culasse refermée. */
export const SINGLE_OPEN = 0.1, SINGLE_SEAT = 0.58, SINGLE_CLOSE = 0.9;

export interface RifleEvents {
  boltOpen(): void;
  boltClose(): void;
  dryFire(): void;
  magOut(): void;
  magIn(): void;
  turret(): void;
}

export class Rifle {
  mag: number;
  chambered = true;
  /** temps restant du cycle de verrou */
  boltT = 0;
  reloadT = 0;
  elevClicks = 0;
  windClicks = 0;
  zoom: number;
  shotsFired = 0;
  private closed = true;
  /** arme à un coup : la cartouche se pose à la main, culasse ouverte (pas de chargeur) */
  readonly single: boolean;
  private pendingReload = false;

  constructor(public def: WeaponDef, private ev: RifleEvents) {
    this.single = def.magazine <= 1;
    this.mag = def.magazine - 1;
    this.zoom = Math.min(def.scope[1], Math.max(def.scope[0], 8));
  }
  get elevMil(): number {
    return this.elevClicks * CLICK_MIL;
  }
  get windMil(): number {
    return this.windClicks * CLICK_MIL;
  }
  get ready(): boolean {
    return this.chambered && this.boltT <= 0 && this.reloadT <= 0;
  }
  /** progression 0..1 du geste de verrou (pour l'animation) */
  get boltPhase(): number {
    return this.boltT > 0 ? 1 - this.boltT / this.def.boltTime : 0;
  }
  clickElev(n: number): void {
    const max = Math.round(this.def.turretMaxMil / CLICK_MIL);
    const v = Math.min(max, Math.max(0, this.elevClicks + n));
    if (v !== this.elevClicks) { this.elevClicks = v; this.ev.turret(); }
  }
  clickWind(n: number): void {
    const v = Math.min(100, Math.max(-100, this.windClicks + n));
    if (v !== this.windClicks) { this.windClicks = v; this.ev.turret(); }
  }
  /** Renvoie vrai si le coup part. */
  trigger(): boolean {
    if (this.boltT > 0 || this.reloadT > 0) return false;
    if (!this.chambered) { this.ev.dryFire(); return false; }
    this.chambered = false;
    this.shotsFired++;
    this.boltT = this.def.boltTime;
    this.closed = false;
    return true;
  }
  /**
   * Durée totale d'un rechargement, s. Arme à un coup : le geste comprend l'ouverture et la fermeture de la culasse
   * (reloadTime + boltTime, soit la même attente qu'un changement de chargeur suivi d'un réarmement).
   */
  get reloadDuration(): number {
    return this.single ? this.def.reloadTime + this.def.boltTime : this.def.reloadTime;
  }
  /** progression 0..1 du rechargement (pour l'animation) ; 1 hors rechargement */
  get reloadPhase(): number {
    return this.reloadT > 0 ? Math.max(0, 1 - this.reloadT / this.reloadDuration) : 1;
  }
  reload(): void {
    if (this.single) {
      if (this.reloadT > 0 || this.chambered) return;
      // culasse encore en mouvement après le tir : le rechargement s'enchaîne dès qu'elle est refermée
      if (this.boltT > 0) { this.pendingReload = true; return; }
      this.reloadT = this.reloadDuration;
      return;
    }
    if (this.reloadT > 0 || this.mag >= this.def.magazine) return;
    this.reloadT = this.def.reloadTime;
    this.ev.magOut();
  }
  update(dt: number): void {
    if (this.single && this.reloadT > 0) {
      // un coup : culasse ouverte (0,10), cartouche posée dans l'auget (0,58), culasse refermée (0,90) ; voir handling.ts
      const p0 = this.reloadPhase;
      this.reloadT -= dt;
      const p1 = this.reloadT > 0 ? this.reloadPhase : 1;
      const cross = (k: number): boolean => p0 < k && p1 >= k;
      if (cross(SINGLE_OPEN)) this.ev.boltOpen();
      if (cross(SINGLE_SEAT)) this.ev.magIn();
      if (cross(SINGLE_CLOSE)) this.ev.boltClose();
      if (this.reloadT <= 0) { this.reloadT = 0; this.mag = 0; this.chambered = true; }
      return;
    }
    if (this.reloadT > 0) {
      const before = this.reloadT;
      this.reloadT -= dt;
      if (before > this.def.reloadTime * 0.35 && this.reloadT <= this.def.reloadTime * 0.35) this.ev.magIn();
      if (this.reloadT <= 0) {
        this.mag = this.def.magazine;
        if (!this.chambered) { this.boltT = this.def.boltTime; this.closed = false; this.pendingOpen = true; }
      }
      return;
    }
    if (this.boltT > 0) {
      const ph0 = this.boltPhase;
      this.boltT -= dt;
      const ph1 = this.boltT > 0 ? this.boltPhase : 1;
      if ((ph0 < 0.18 && ph1 >= 0.18) || this.pendingOpen) { this.ev.boltOpen(); this.pendingOpen = false; }
      if (!this.closed && ph1 >= 0.68) {
        this.closed = true;
        if (this.mag > 0) { this.mag--; this.chambered = true; this.ev.boltClose(); }
        else this.ev.boltClose();
      }
      if (this.boltT <= 0 && this.pendingReload) { this.pendingReload = false; this.reload(); }
    }
  }
  private pendingOpen = false;
}
