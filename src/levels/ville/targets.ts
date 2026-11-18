// Ville nouvelle, visite : un tireur immobile sur chaque emplacement, debout face au centre de la carte. Zone de
// touche de la page d'origine : un cylindre de 2 m de haut et 1 m de large autour du tireur ; la tête compte quand la
// balle passe à moins de 24 cm de son centre (1,62 m au-dessus des pieds). Touché, il se couche, puis se relève.
import { Vector3 } from 'three';
import type { Engine } from '../../core/engine';
import { Target, type HitInfo, type HitResult, type TargetCtx } from '../../game/targets';
import { Crowd, defaultPose, type Outfit, type PoseInput, type Rig } from '../../player/character';
import { EYE, type VilleWorld } from './data';

const HALF = 1.0, RADIUS = 0.5, HEAD_Y = 1.62, HEAD_R = 0.24;
/** durée pendant laquelle un tireur touché reste couché (s) */
const DOWN = 5;

export class Silhouette extends Target {
  private pose: PoseInput = defaultPose();
  private centre = new Vector3();
  private down = 0;
  private feet = new Vector3();
  /** la pose a changé : la foule instanciée doit être recalée */
  dirty = true;
  constructor(readonly n: number, label: string, private rig: Rig, feet: Vector3, yaw: number) {
    super('emp' + n, label);
    this.decorSolid = false;
    this.feet.copy(feet);
    this.group.position.copy(feet);
    this.centre.copy(feet).setY(feet.y + HALF);
    rig.root.position.copy(feet);
    rig.root.rotation.y = Math.PI - yaw;
    rig.pose(this.pose);
  }
  /** Montre ou cache le tireur (l'emplacement qu'on occupe n'a pas de silhouette). */
  setActive(on: boolean): void {
    this.active = on;
    // le jeu garde les objets proches d'une cible hors du plan de coupe de la lunette, d'après la position de son
    // groupe : une silhouette retirée (l'emplacement qu'on occupe) est donc rangée loin sous la carte
    this.group.position.copy(this.feet);
    if (!on) this.group.position.y = -1e4;
    this.rig.root.visible = on;
    this.dirty = true;
  }
  segment(a: Vector3, b: Vector3): { t: number; part: string } | null {
    const c = this.centre;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-12 || this.down > 0) return null;
    const u = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2));
    const qx = a.x + dx * u - c.x, qy = a.y + dy * u - c.y, qz = a.z + dz * u - c.z;
    if (Math.hypot(qx, qz) >= RADIUS || Math.abs(qy) >= HALF) return null;
    const hy = c.y + HEAD_Y - HALF;
    const ut = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (hy - a.y) * dy + (c.z - a.z) * dz) / l2));
    const head = Math.hypot(a.x + dx * ut - c.x, a.y + dy * ut - hy, a.z + dz * ut - c.z) < HEAD_R;
    return { t: u, part: head ? 'head' : 'torso' };
  }
  aimPoint(out: Vector3): Vector3 {
    return out.copy(this.centre);
  }
  update(dt: number, _ctx: TargetCtx): void {
    const p = this.pose;
    const want = this.down > 0 ? 1 : 0;
    if (this.down > 0) this.down -= dt;
    if (p.fall === want) return;
    p.fall = want > p.fall ? Math.min(1, p.fall + dt * 1.3) : Math.max(0, p.fall - dt * 1.3);
    this.rig.pose(p);
    this.dirty = true;
  }
  onHit(_h: HitInfo): HitResult {
    this.down = DOWN;
    return { kind: 'body', success: true };
  }
}

const OUTFITS: Outfit[] = [
  { jacket: 0x3f4a3a, trousers: 0x2e3338, skin: 0xd9b08c, hat: 0x262a22, pack: null, boots: 0x1c1915, height: 1.0 },
  { jacket: 0x4a4436, trousers: 0x33362b, skin: 0xb98f70, hat: 0x23262b, pack: null, boots: 0x1c1814, height: 1.0 },
  { jacket: 0x38424c, trousers: 0x2a2d30, skin: 0x8f6a4e, hat: null, pack: null, boots: 0x1c1915, height: 1.0 },
];

/** Les silhouettes de tous les emplacements, dessinées en une foule instanciée (`crowd.group` est à ajouter à la scène). */
export function buildSilhouettes(engine: Engine, w: VilleWorld): { list: Silhouette[]; crowd: Crowd } {
  const crowd = new Crowd(engine, w.emp.map((e) => OUTFITS[e.n % OUTFITS.length]));
  const list = w.emp.map((e, i) => {
    const eye = w.eyeOf(e);
    return new Silhouette(e.n, e.nom, crowd.rigs[i], new Vector3(eye.x, eye.y - EYE, eye.z), w.yawToCentre(e));
  });
  crowd.sync();
  return { list, crowd };
}
