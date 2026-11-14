// Cibles du niveau « facile ». Plaques, ballon et bidon sont les types communs ; trois types simples sont propres à
// la carte : la silhouette basculante (dans une fenêtre, sur une passerelle, sur un toit), la cloche du clocher et la
// cible mobile sur rail. Rien que de l'acier et du bronze : la chute est sobre.
import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { Engine } from '../../core/engine';
import { damp } from '../../core/noise';
import { Balloon, FuelDrum, SteelPlate, Target, type HitInfo, type HitResult, type TargetCtx } from '../../game/targets';
import type { LevelBuildings } from '../types';
import { HOOKS, LOTS, lotPoint } from './map';
import type { Anchors } from './scenery';

const std = (engine: Engine, color: number, rough = 0.7, metal = 0, key = 'tgt'): MeshStandardMaterial =>
  engine.setupMaterial(new MeshStandardMaterial({ color, roughness: rough, metalness: metal }), undefined, key);

/** Cap (lacet Three.js) qui tourne l'axe +z local d'un objet posé en `pos` vers le site de tir, à l'origine. */
const faceSite = (pos: Vector3): number => Math.atan2(-pos.x, -pos.z);

// ---------------------------------------------------------------- silhouette basculante
export interface PopperOpts {
  /** 1 : 45 cm de large, 75 cm de haut */
  scale: number;
  /** énergie à l'impact (J) en dessous de laquelle elle tremble sans tomber */
  minEnergy: number;
  /** teinte de l'acier : claire devant un fond sombre (fenêtre), sombre devant un mur clair ou le ciel */
  color: number;
  /** 'stand' : sur charnière au pied, elle bascule en arrière ; 'hang' : suspendue par le haut, elle se décroche et tombe */
  mount?: 'stand' | 'hang';
}

/**
 * Silhouette d'acier (buste et tête) : touchée avec assez d'énergie, elle bascule en arrière ou, suspendue, se
 * décroche. `pos` : pied de la charnière, ou point d'accroche pour une silhouette suspendue.
 */
export class Popper extends Target {
  private flap = new Object3D();
  private fall = 0;
  private wobble = 0;
  private wv = 0;
  private vy = 0;
  private aim = new Object3D();
  private hang: boolean;
  private minEnergy: number;
  constructor(engine: Engine, id: string, label: string, pos: Vector3, o: PopperOpts) {
    super(id, label);
    const s = o.scale;
    this.hang = o.mount === 'hang';
    this.minEnergy = o.minEnergy;
    this.group.position.copy(pos);
    this.group.rotation.y = faceSite(pos);
    const dark = std(engine, 0x2c2e30, 0.6, 0.6);
    // suspendue : tout est décalé vers le bas, la charnière est en haut de la tête
    const y0 = this.hang ? -0.76 * s : 0;
    if (this.hang) {
      for (const dx of [-0.1, 0.1]) {
        const hook = new Mesh(new BoxGeometry(0.03, 0.12, 0.1), dark);
        hook.position.set(dx * s, -0.02, -0.04);
        this.group.add(hook);
      }
    } else {
      const base = new Mesh(new BoxGeometry(0.6 * s, 0.06, 0.34 * s), dark);
      base.position.y = 0.03;
      base.castShadow = true;
      this.group.add(base);
      this.flap.position.set(0, 0.07, 0);
    }
    this.group.add(this.flap);
    const steel = std(engine, o.color, 0.55, 0.25, 'popper' + o.color.toString(16));
    const body = new Mesh(new BoxGeometry(0.45 * s, 0.5 * s, 0.014), steel);
    body.position.y = y0 + 0.25 * s;
    body.castShadow = true;
    this.flap.add(body);
    const head = new Mesh(new CylinderGeometry(0.125 * s, 0.125 * s, 0.014, 20), steel);
    head.rotation.x = Math.PI / 2;
    head.position.y = y0 + 0.61 * s;
    head.castShadow = true;
    this.flap.add(head);
    const dot = new Mesh(new CircleGeometry(0.11 * s, 18), new MeshBasicMaterial({ color: 0xe2571c }));
    dot.position.set(0, y0 + 0.29 * s, 0.009);
    this.flap.add(dot);
    this.aim.position.set(0, y0 + 0.29 * s, 0);
    this.flap.add(this.aim);
    const hn = new Object3D();
    hn.position.copy(head.position);
    this.flap.add(hn);
    this.addCollider(this.aim, 'box', 'plate', 0, new Vector3(0.225 * s, 0.25 * s, 0.03));
    this.addCollider(hn, 'sphere', 'plate', 0.125 * s);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.aim.getWorldPosition(out);
  }
  update(dt: number): void {
    // tremble sous un impact trop faible ; bascule (ou se décroche) sinon
    const k = this.hang ? 14 : 60;
    this.wv += (-k * this.wobble - (this.hang ? 1.2 : 5) * this.wv) * dt;
    this.wobble += this.wv * dt;
    if (this.done && this.hang) {
      if (!this.flap.visible) return;
      this.vy -= 9.81 * dt;
      this.flap.position.y += this.vy * dt;
      this.flap.rotation.x -= 2.2 * dt;
      if (this.flap.position.y < -30) this.flap.visible = false;
      return;
    }
    if (this.done) this.fall = damp(this.fall, 1, 5, dt);
    this.flap.rotation.x = -1.48 * this.fall + this.wobble * (1 - this.fall);
  }
  onHit(h: HitInfo): HitResult {
    this.hits++;
    const local = this.flap.worldToLocal(h.point.clone());
    const mark = new Mesh(new CircleGeometry(0.014, 8), new MeshBasicMaterial({ color: 0x8a8d90 }));
    mark.position.set(local.x, local.y, 0.0095);
    this.flap.add(mark);
    if (h.energy < this.minEnergy) {
      this.wv -= 1.2;
      return { kind: 'steel', note: 'La silhouette a tremblé sans tomber : il faut plus d’énergie à cette distance.' };
    }
    const first = !this.done;
    this.done = true;
    this.wv -= 3;
    return { kind: 'steel', success: first };
  }
}

// ---------------------------------------------------------------- timbre de l'horloge
/**
 * Timbre de l'horloge : cloche de bronze en applique sur le clocher, sous une petite potence. Touchée, elle se
 * balance et sonne. `pos` : axe du joug ; `wallYaw` : lacet du mur qui la porte (sa normale = +z local).
 */
export class Bell extends Target {
  private swing = new Object3D();
  private angle = 0;
  private av = 0;
  private body = new Object3D();
  constructor(engine: Engine, pos: Vector3, wallYaw: number) {
    super('bell', 'Timbre de l’horloge');
    this.group.position.copy(pos);
    this.group.rotation.y = wallYaw;
    this.group.scale.setScalar(1.15);
    const iron = std(engine, 0x2a2b2d, 0.6, 0.7);
    // potence : deux bras scellés dans le mur, le joug entre eux, une bavette de plomb au-dessus
    for (const dx of [-0.56, 0.56]) {
      const arm = new Mesh(new BoxGeometry(0.07, 0.07, 0.75), iron);
      arm.position.set(dx, 0, -0.3);
      this.group.add(arm);
      const brace = new Mesh(new BoxGeometry(0.05, 0.05, 0.8), iron);
      brace.position.set(dx, -0.3, -0.3);
      brace.rotation.x = -0.75;
      this.group.add(brace);
    }
    const yoke = new Mesh(new BoxGeometry(1.25, 0.14, 0.14), std(engine, 0x4a3a2a, 0.9));
    this.group.add(yoke);
    const cap = new Mesh(new BoxGeometry(1.5, 0.04, 0.95), std(engine, 0x5a6066, 0.5, 0.4));
    cap.position.set(0, 0.2, -0.22);
    cap.rotation.x = 0.2;
    cap.castShadow = true;
    this.group.add(cap);
    this.group.add(this.swing);
    const bronze = std(engine, 0xb9893c, 0.36, 0.85, 'bell');
    const crown = new Mesh(new CylinderGeometry(0.16, 0.24, 0.2, 18), bronze);
    crown.position.y = -0.18;
    this.swing.add(crown);
    const waist = new Mesh(new CylinderGeometry(0.24, 0.36, 0.42, 18, 1, true), bronze);
    waist.position.y = -0.49;
    waist.castShadow = true;
    this.swing.add(waist);
    const lip = new Mesh(new CylinderGeometry(0.36, 0.46, 0.14, 18, 1, true), bronze);
    lip.position.y = -0.77;
    this.swing.add(lip);
    this.body.position.set(0, -0.52, 0);
    this.swing.add(this.body);
    this.addCollider(this.body, 'box', 'bell', 0, new Vector3(0.36, 0.34, 0.36).multiplyScalar(1.15));
  }
  aimPoint(out: Vector3): Vector3 {
    return this.body.getWorldPosition(out);
  }
  update(dt: number): void {
    this.av += (-9 * this.angle - 0.5 * this.av) * dt;
    this.angle += this.av * dt;
    // elle se balance le long du mur
    this.swing.rotation.z = this.angle;
  }
  onHit(h: HitInfo, ctx: TargetCtx): HitResult {
    this.hits++;
    if (h.energy < 400) {
      this.av -= 0.25;
      return { kind: 'bell', note: 'Le timbre a tinté sans s’ébranler : il faut au moins 400 J à l’impact.' };
    }
    this.av -= Math.min(2.6, 0.9 + h.energy / 1500);
    ctx.fx.puff(h.point, { count: 10, speed: 2.5, life: 0.4, size: [0.012, 0.025], color: 0xffd27a, alpha: 1, gravity: 9, drag: 1, wind: 0, glow: 1.0 });
    const first = !this.done;
    this.done = true;
    return { kind: 'bell', success: first };
  }
}

// ---------------------------------------------------------------- cible mobile sur rail
/**
 * Chariot sur rail portant un disque d'acier de 50 cm : il fait la navette entre deux heurtoirs à l'allure d'un
 * homme au pas et marque l'arrêt à chaque bout. Touché, le disque se couche et le chariot s'immobilise.
 */
export class Runner extends Target {
  private cart = new Object3D();
  private flap = new Object3D();
  private aim = new Object3D();
  private u = 0.5;
  private dir = 1;
  private wait = 0;
  private fall = 0;
  private len: number;
  speed = 0;
  readonly cruise = 1.4;
  private readonly pause = 2.5;
  private readonly radius = 0.25;
  constructor(engine: Engine, private a: Vector3, private b: Vector3) {
    super('runner', 'Cible mobile sur rail');
    this.len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // le chariot roule le long de la voie ; le disque fait face au site de tir
    this.cart.rotation.y = faceSite(mid);
    this.group.add(this.cart);
    const dark = std(engine, 0x3a3d40, 0.6, 0.6);
    const bed = new Mesh(new BoxGeometry(1.5, 0.12, 1.05), dark);
    bed.position.y = 0.16;
    bed.castShadow = true;
    this.cart.add(bed);
    const mast = new Mesh(new BoxGeometry(0.06, 0.75, 0.06), dark);
    mast.position.y = 0.58;
    this.cart.add(mast);
    this.flap.position.set(0, 0.95, 0);
    this.cart.add(this.flap);
    const disc = new Mesh(new CylinderGeometry(this.radius, this.radius, 0.014, 24), std(engine, 0xecebe6, 0.55, 0.25));
    disc.rotation.x = Math.PI / 2;
    disc.position.y = this.radius;
    disc.castShadow = true;
    this.flap.add(disc);
    const dot = new Mesh(new CircleGeometry(this.radius * 0.42, 18), new MeshBasicMaterial({ color: 0xd9541e }));
    dot.position.set(0, this.radius, 0.009);
    this.flap.add(dot);
    this.aim.position.set(0, this.radius, 0);
    this.flap.add(this.aim);
    this.addCollider(this.aim, 'sphere', 'plate', this.radius);
    this.place();
  }
  private place(): void {
    this.cart.position.lerpVectors(this.a, this.b, this.u);
    this.cart.updateMatrixWorld(true);
  }
  aimPoint(out: Vector3): Vector3 {
    return this.aim.getWorldPosition(out);
  }
  /** Avance l'état (position le long de la voie, sens, attente) de dt secondes, sans toucher à la cible. */
  private advance(u: number, dir: number, wait: number, dt: number): { u: number; dir: number; wait: number } {
    let left = dt;
    for (let guard = 0; guard < 8 && left > 0; guard++) {
      if (wait > 0) {
        const w = Math.min(wait, left);
        wait -= w;
        left -= w;
        continue;
      }
      const toEnd = (dir > 0 ? 1 - u : u) * this.len;
      const d = Math.min(toEnd, this.cruise * left);
      u += (dir * d) / this.len;
      left -= d / this.cruise;
      if (d >= toEnd - 1e-6) { dir = -dir; wait = this.pause; }
    }
    return { u, dir, wait };
  }
  predict(dt: number, out: Vector3): Vector3 {
    if (this.done) return this.aimPoint(out);
    const s = this.advance(this.u, this.dir, this.wait, dt);
    const here = this.aimPoint(out);
    return here.addScaledVector(this.b.clone().sub(this.a), s.u - this.u);
  }
  update(dt: number): void {
    if (this.done) {
      this.fall = damp(this.fall, 1, 5, dt);
      this.flap.rotation.x = -1.5 * this.fall;
      this.speed = 0;
      return;
    }
    const s = this.advance(this.u, this.dir, this.wait, dt);
    this.speed = s.wait > 0 || this.wait > 0 ? 0 : this.cruise;
    this.u = s.u;
    this.dir = s.dir;
    this.wait = s.wait;
    this.place();
  }
  onHit(): HitResult {
    this.hits++;
    const first = !this.done;
    this.done = true;
    return { kind: 'steel', success: first };
  }
}

export interface EasyTargets {
  list: Target[];
  runner: Runner;
  bell: Bell;
  /** cibles des deux derniers objectifs : le vent forcit quand on y arrive */
  late: Target[];
  early: Target[];
}

/**
 * Point d'accroche d'une cible dans un bâtiment posé (repère local → monde). Si le bâtiment manque (banque non
 * chargée), la cible est posée au même endroit en plan, à la hauteur prévue au-dessus du relief.
 */
function hookPoint(key: keyof typeof HOOKS, B: LevelBuildings | undefined, ground: (x: number, z: number) => number): Vector3 {
  const hk = HOOKS[key];
  const b = B?.get(hk.lot);
  if (b) return b.toWorld(hk.x, hk.y, hk.z);
  const l = LOTS[hk.lot as keyof typeof LOTS], p = lotPoint(l, hk.x, hk.z);
  return new Vector3(p.x, ground(l.x, l.z) + hk.y, p.z);
}

export function buildTargets(e: Engine, A: Anchors, B: LevelBuildings | undefined, ground: (x: number, z: number) => number): EasyTargets {
  const at = (k: keyof typeof HOOKS): Vector3 => hookPoint(k, B, ground);
  const runner = new Runner(e, A.trackA, A.trackB);
  const drum = new FuelDrum(e, A.drum);
  drum.label = 'Bidon de la sablière';
  const balloon = new Balloon(e, A.balloon);
  const mill = new Popper(e, 'mill', 'Silhouette du moulin', at('mill'), { scale: 1.2, minEnergy: 150, color: 0xecebe6 });
  const bell = new Bell(e, at('bell'), B?.get(HOOKS.bell.lot)?.yaw ?? 0);
  const tower = new Popper(e, 'tower', 'Silhouette du château d’eau', at('tower'), { scale: 1.25, minEnergy: 300, color: 0x26282b, mount: 'hang' });
  const roof = new Popper(e, 'roof', 'Silhouette du toit de l’hôpital', at('roof'), { scale: 1.5, minEnergy: 300, color: 0x26282b });
  const list: Target[] = [
    new SteelPlate(e, 'plate1', 'Plaque carrée', A.plate1, 0.45, false),
    new SteelPlate(e, 'plate2', 'Plaque ronde', A.plate2, 0.6, true),
    drum, balloon, mill, runner, bell, tower, roof,
  ];
  return { list, runner, bell, early: list.slice(0, 7), late: [tower, roof] };
}
