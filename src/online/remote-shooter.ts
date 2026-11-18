// Mode en ligne : les autres tireurs de la salle, comme cibles du jeu. Chacun est debout sur son emplacement, face au
// centre de la carte. Zone de touche de la page d'origine : un cylindre de 1 m de large et 2 m de haut autour du
// tireur ; la tête compte quand la balle passe à moins de 24 cm de son centre, à 1,62 m au-dessus des pieds. La cible
// ne décide de rien : c'est le serveur qui applique la touche (vie, points, retour) ; ici, on ne fait que la dessiner
// et arrêter la balle.
//
// Apparence : le mannequin du solo (src/player/character.ts), debout en position de tir, la carabine du solo épaulée
// comme le solo épaule la sienne (`shoulderMount`, mains ancrées à la poignée et au fût), tourné vers ce qu'il vise
// (`aimAt`) ou, à défaut, vers le centre de la carte. L'arme ne fait pas partie de la zone de touche. Pas d'ombre
// portée : neuf tireurs au plus, vus de loin.
import { Group, Mesh, Vector3 } from 'three';
import type { WeaponDef } from '../config/weapons';
import type { Engine } from '../core/engine';
import { Target, type HitInfo, type HitResult, type TargetCtx } from '../game/targets';
import { Crowd, defaultPose, type Outfit, type PoseInput, type Rig } from '../player/character';
import { shoulderMount } from '../weapons/handling';
import type { RifleParts } from '../weapons/rifle';
import { rifleBlueprint, rifleMaterial } from '../weapons/rifle-model';
import type { Zone } from './session';

/** demi-hauteur et rayon de la zone de touche, m */
export const HIT_HALF = 1.0, HIT_RADIUS = 0.5;
/** centre de la tête au-dessus des pieds, et distance sous laquelle la balle compte pour la tête, m */
export const HEAD_Y = 1.62, HEAD_R = 0.24;
/** hauteur de l'œil du tireur debout au-dessus de ses pieds, m */
export const EYE_Y = 1.6;
/** nombre de tireurs dessinés au plus : la salle en compte dix, dont le joueur */
export const MAX_SHOOTERS = 10;

const OUTFITS: Outfit[] = [
  { jacket: 0x3f4a3a, trousers: 0x2e3338, skin: 0xd9b08c, hat: 0x262a22, pack: null, boots: 0x1c1915, height: 1.0 },
  { jacket: 0x4a4436, trousers: 0x33362b, skin: 0xb98f70, hat: 0x23262b, pack: null, boots: 0x1c1814, height: 1.0 },
  { jacket: 0x38424c, trousers: 0x2a2d30, skin: 0x8f6a4e, hat: null, pack: null, boots: 0x1c1915, height: 1.0 },
];

/**
 * La balle qui suit le segment a → b (prolongé en droite) passe-t-elle par la tête d'un tireur dont les pieds sont
 * en `feet` ? Sert à la cible, et à l'annonce du tir (zone de la touche prévue).
 */
export function zoneOnLine(feet: Vector3, a: Vector3, b: Vector3): Zone {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
  if (l2 < 1e-12) return 'corps';
  const hy = feet.y + HEAD_Y;
  const u = ((feet.x - a.x) * dx + (hy - a.y) * dy + (feet.z - a.z) * dz) / l2;
  return Math.hypot(a.x + dx * u - feet.x, a.y + dy * u - hy, a.z + dz * u - feet.z) < HEAD_R ? 'tete' : 'corps';
}

export class RemoteShooter extends Target {
  /** pieds du tireur */
  readonly feet = new Vector3();
  /** nom de son emplacement ('' : pas encore placé) */
  emp = '';
  /** abattu : couché, il n'arrête plus les balles */
  down = false;
  private pose: PoseInput = { ...defaultPose(), aim: 1 };
  private centre = new Vector3();
  /** cap de l'emplacement vers le centre de la carte, et cap du regard (rad, 0 = nord) */
  private baseYaw = 0;
  private yaw = 0;
  /** la carabine épaulée, dans le repère du tireur (avant = +Z) */
  private rifleNode = new Group();
  private hand = new Vector3();
  /** la pose ou la place a changé : la foule instanciée doit être recalée */
  dirty = true;

  /** `rifle` : le maillage de la carabine du solo et ses repères (poignée, fût, œil, plaque de couche). */
  constructor(readonly playerId: number, label: string, private rig: Rig, private rifle: { mesh: Mesh; anchors: Record<string, Vector3> }) {
    super('tireur' + playerId, label);
    this.decorSolid = false;
    rig.root.visible = true;
    this.rifleNode.add(rifle.mesh);
    this.group.add(this.rifleNode);
    this.shoulder();
  }

  /**
   * Position de tir : la pose du solo, l'arme à l'épaule à la place que le solo lui donne (`shoulderMount`), la main
   * droite à la poignée, la gauche sous le fût. À refaire après chaque `rig.pose` (elle remet les bras en pose libre).
   */
  private shoulder(): void {
    const rig = this.rig, up = this.pose.fall < 0.02;
    this.rifleNode.visible = up;
    rig.pose(this.pose);
    if (!up) return;
    // `shoulderMount` mesure dans le repère du parent du mannequin : celui-ci est ramené à l'origine le temps du calcul
    const root = rig.root, ry = root.rotation.y;
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    const [hgt, fwd] = shoulderMount(rig, this.rifle as unknown as RifleParts);
    root.position.copy(this.feet);
    root.rotation.y = ry;
    this.rifleNode.position.set(-0.09, hgt, fwd);
    this.group.updateWorldMatrix(true, true);
    const a = this.rifle.anchors;
    rig.reach('R', this.rifleNode.localToWorld(this.hand.copy(a.grip)), 1);
    rig.reach('L', this.rifleNode.localToWorld(this.hand.copy(a.forend)), 1);
  }
  private turn(yaw: number): void {
    if (yaw === this.yaw && this.group.rotation.y === Math.PI - yaw) return;
    this.yaw = yaw;
    this.group.rotation.y = this.rig.root.rotation.y = Math.PI - yaw;
    this.dirty = true;
  }
  /** Tourne le tireur vers le point `p` qu'il vise (le tir qu'il vient de faire, celui qu'il tient dans sa lunette) ; null : vers le centre de la carte. */
  aimAt(p: { x: number; z: number } | null): void {
    this.turn(p ? Math.atan2(p.x - this.feet.x, -(p.z - this.feet.z)) : this.baseYaw);
  }
  /** Le tourne dans la direction (x, z) de son tir. */
  aimAlong(x: number, z: number): void {
    if (Math.hypot(x, z) > 1e-6) this.turn(Math.atan2(x, -z));
  }

  /** Pose le tireur debout sur l'emplacement `emp` : pieds en `feet`, regard vers l'azimut `yaw`. */
  place(emp: string, feet: Vector3, yaw: number): void {
    this.emp = emp;
    this.feet.copy(feet);
    this.group.position.copy(feet);
    this.centre.copy(feet).setY(feet.y + HIT_HALF);
    this.rig.root.position.copy(feet);
    this.baseYaw = yaw;
    this.turn(yaw);
    this.shoulder();
    this.dirty = true;
  }
  /** Debout (il arrête les balles) ou abattu (il se couche et ne compte plus). */
  setDown(down: boolean): void {
    this.down = down;
    this.active = !down;
    if (!down && this.pose.fall !== 0) { this.pose.fall = 0; this.pose.aim = 1; this.shoulder(); this.dirty = true; }
  }
  /** Rend le mannequin à la foule (le tireur a quitté la salle). */
  release(): void {
    this.active = false;
    this.rig.root.visible = false;
    this.pose.fall = 0;
    this.rig.pose(this.pose);
    this.group.remove(this.rifleNode);
    this.dirty = true;
  }

  /** œil du tireur : d'où part sa balle, où brille son reflet */
  eye(out: Vector3): Vector3 {
    return out.set(this.feet.x, this.feet.y + EYE_Y, this.feet.z);
  }
  /** centre de sa tête */
  head(out: Vector3): Vector3 {
    return out.set(this.feet.x, this.feet.y + HEAD_Y, this.feet.z);
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.centre);
  }

  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    if (this.down) return null;
    const c = this.centre;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-12) return null;
    const u = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2));
    const qx = a.x + dx * u - c.x, qy = a.y + dy * u - c.y, qz = a.z + dz * u - c.z;
    if (Math.hypot(qx, qz) >= HIT_RADIUS || Math.abs(qy) >= HIT_HALF) return null;
    return { t: u, part: zoneOnLine(this.feet, a, b) === 'tete' ? 'head' : 'torso' };
  }

  update(dt: number, _ctx: TargetCtx): void {
    const p = this.pose, want = this.down ? 1 : 0;
    if (p.fall === want) return;
    p.fall = want > p.fall ? Math.min(1, p.fall + dt * 1.3) : Math.max(0, p.fall - dt * 1.3);
    // abattu, il lâche la visée ; relevé, il épaule de nouveau
    p.aim = p.fall > 0 ? 0 : 1;
    this.shoulder();
    this.dirty = true;
  }

  /** La balle s'arrête sur lui ; la touche elle-même vient du serveur, à l'arrivée de la balle. */
  onHit(_h: HitInfo): HitResult {
    return { kind: 'body' };
  }
}

/** Les mannequins des autres tireurs, dessinés en une foule instanciée (`group` est à ajouter à la scène). */
export class ShooterCrowd {
  private crowd: Crowd;
  private free: number[] = [];
  private slots = new Map<RemoteShooter, number>();
  private stale = false;

  /** `def` : l'arme que tous portent (celle de la carte). */
  constructor(private engine: Engine, private def: WeaponDef) {
    this.crowd = new Crowd(engine, Array.from({ length: MAX_SHOOTERS }, (_, i) => OUTFITS[i % OUTFITS.length]));
    for (let i = MAX_SHOOTERS - 1; i >= 0; i--) { this.free.push(i); this.crowd.rigs[i].root.visible = false; }
    // les tireurs sont dispersés sur toute la carte et changent de place : pas de tri par sphère englobante ; pas d'ombre portée
    this.crowd.group.traverse((o) => { o.frustumCulled = false; o.castShadow = false; });
    this.crowd.sync();
  }
  get group(): Crowd['group'] {
    return this.crowd.group;
  }
  /** Un mannequin pour le tireur `id` ; null s'il n'en reste pas. */
  take(id: number, label: string): RemoteShooter | null {
    const i = this.free.pop();
    if (i === undefined) return null;
    // la carabine du solo, en version allégée (celle du râtelier) : une géométrie et une matière partagées par tous
    const bp = rifleBlueprint(this.def, 0.5);
    const mesh = new Mesh(bp.merged, rifleMaterial(this.engine));
    mesh.frustumCulled = false;
    const s = new RemoteShooter(id, label, this.crowd.rigs[i], { mesh, anchors: bp.anchors });
    this.slots.set(s, i);
    return s;
  }
  give(s: RemoteShooter): void {
    const i = this.slots.get(s);
    if (i === undefined) return;
    s.release();
    this.slots.delete(s);
    this.free.push(i);
    this.stale = true;
  }
  /** À chaque image : recale la foule si un mannequin a bougé. */
  sync(force = false): void {
    let dirty = force || this.stale;
    this.stale = false;
    for (const s of this.slots.keys()) if (s.dirty) { dirty = true; s.dirty = false; }
    if (dirty) this.crowd.sync();
  }
}
