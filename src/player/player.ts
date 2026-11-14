// Joueur : déplacements, postures, rythme cardiaque, caméra à l'épaule avec inertie et collisions.
import { Group, Vector3, type PerspectiveCamera, type Texture } from 'three';
import type { Engine } from '../core/engine';
import type { Input } from '../core/input';
import { damp, smoothstep } from '../core/noise';
import type { PostDef, SiteNav } from '../levels/types';
import type { Colliders } from '../world/colliders';
import type { Terrain } from '../world/terrain';
import { CharacterMesh, defaultPose, type Stance } from './character';
import type { Surface } from '../audio/types';

/** caméra à l'épaule en portrait : recul (facteur), décalage latéral et hauteur du pivot au-dessus de la tête (m) */
const PORTRAIT_CAM = { dist: 1.12, side: 0.56, lift: 0.38 };

/** Site de tir vu par le joueur : altitude du sol, point de départ, postes nommés. */
export interface SiteSpec {
  baseY: number;
  start: { x: number; z: number; yaw: number };
  posts: Record<string, PostDef>;
}

export interface PlayerEvents {
  footstep(surface: Surface, intensity: number): void;
  cloth(intensity: number): void;
}

export class Player {
  pos = new Vector3();
  /** azimut du regard (rad, 0 = nord) et site */
  yaw = 0;
  pitch = -0.05;
  bodyYaw = 0;
  stance: Stance = 'stand';
  stanceBlend = 0;
  heartRate = 62;
  speed = 0;
  moving = false;
  /** appui disponible (mur à portée) pour le tir accroupi */
  supported = false;
  surface: Surface = 'grass';
  group = new Group();
  char: CharacterMesh;
  pose = defaultPose();
  aiming = 0;
  /** point d'attache du fusil (nœud du dos ou racine) */
  private vy = 0;
  private camPos = new Vector3();
  private camInit = false;
  private stepAcc = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private hit = new Vector3();

  /**
   * `site` : le site de tir du niveau (départ, altitude du sol, postes) ; `nav` : sa zone praticable, la nature
   * de son sol et ses points de passage.
   */
  constructor(engine: Engine, private terrain: Terrain, private col: Colliders, private ev: PlayerEvents, cloth: Texture | undefined, private site: SiteSpec, private nav: SiteNav) {
    this.pos.set(site.start.x, site.baseY, site.start.z);
    this.yaw = this.bodyYaw = site.start.yaw;
    this.char = new CharacterMesh(engine, { jacket: 0x3c4434, trousers: 0x2e2d28, skin: 0xb58d70, hat: 0x23262b, pack: 0x4a3f2e, boots: 0x1c1814, height: 1.0 }, cloth);
    this.group.add(this.char.group);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
  }

  groundAt(x: number, z: number, y: number): number {
    const t = this.terrain.heightAt(x, z);
    const k = { kind: 'stone' as 'stone' | 'wood' };
    const s = this.col.surfaceAt(x, z, y, k);
    if (s > t) { this.surface = k.kind; return s; }
    this.surface = this.nav.surfaceAt(x, z);
    return t;
  }

  setStance(s: Stance): void {
    if (s === this.stance) return;
    this.stance = s;
    this.ev.cloth(s === 'prone' ? 1 : 0.6);
    this.heartRate = Math.min(150, this.heartRate + 4);
  }

  update(dt: number, input: Input, inScope: boolean): void {
    // --- postures ---
    if (!inScope) {
      if (input.hit('KeyC')) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (input.hit('KeyX') || input.hit('ControlLeft')) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');
      if (input.hit('Space')) this.setStance(this.stance === 'prone' ? 'crouch' : 'stand');
      const sens = 0.0022;
      this.yaw += input.dx * sens;
      this.pitch = Math.min(1.2, Math.max(-1.25, this.pitch - input.dy * sens));
    }
    const target = this.stance === 'stand' ? 0 : this.stance === 'crouch' ? 1 : 2;
    this.stanceBlend = damp(this.stanceBlend, target, this.stance === 'prone' || this.stanceBlend > 1.05 ? 4.5 : 7, dt);
    const transitioning = Math.abs(this.stanceBlend - target) > 0.25;

    // --- déplacement ---
    let fx = 0, fz = 0;
    if (!inScope) {
      if (input.down('KeyW') || input.down('ArrowUp')) fz += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) fz -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) fx += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) fx -= 1;
      // manette analogique (tactile)
      if (input.enabled) { fx += input.axisX; fz += input.axisY; }
    }
    const run = (input.down('ShiftLeft') || (input.enabled && input.run)) && this.stance === 'stand' && fz > 0;
    const max = this.stance === 'stand' ? (run ? 4.3 : 1.9) : this.stance === 'crouch' ? 1.15 : 0.6;
    const len = Math.hypot(fx, fz);
    let want = 0;
    if (len > 0 && !transitioning) {
      fx /= len;
      fz /= len;
      // au clavier len ≥ 1 ; à la manette, la vitesse suit l'inclinaison
      want = max * (fz < 0 ? 0.7 : 1) * Math.min(1, len);
    }
    this.speed = damp(this.speed, want, 9, dt);
    this.moving = this.speed > 0.08;
    if (this.moving && len > 0) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const dx = (sy * fz + cy * fx) * this.speed * dt;
      const dz = (-cy * fz + sy * fx) * this.speed * dt;
      const p = { x: this.pos.x + dx, z: this.pos.z + dz };
      const h = this.stance === 'prone' ? 0.5 : this.stance === 'crouch' ? 1.1 : 1.75;
      const rad = this.stance === 'prone' ? 0.42 : 0.3;
      this.col.resolve(p, rad, this.pos.y, h);
      // limites du sommet, appliquées au déplacement réellement effectué (après collisions) : on glisse le long du bord
      const allowed = (x: number, z: number): boolean => this.nav.allowed(x, z);
      if (!allowed(p.x, p.z)) {
        if (!allowed(this.pos.x, this.pos.z)) {
          // déjà hors zone (téléportation, reprise) : on ne reste pas coincé, tout pas qui ramène vers la cour est accepté
          if (Math.hypot(p.x, p.z) >= Math.hypot(this.pos.x, this.pos.z)) { p.x = this.pos.x; p.z = this.pos.z; }
        } else {
          const q = { x: p.x, z: this.pos.z };
          this.col.resolve(q, rad, this.pos.y, h);
          if (!allowed(q.x, q.z)) {
            q.x = this.pos.x; q.z = p.z;
            this.col.resolve(q, rad, this.pos.y, h);
            if (!allowed(q.x, q.z)) { q.x = this.pos.x; q.z = this.pos.z; }
          }
          p.x = q.x; p.z = q.z;
        }
      }
      // pas de marche trop haute
      const g = this.groundAt(p.x, p.z, this.pos.y);
      if (g - this.pos.y < 0.6) {
        this.pos.x = p.x;
        this.pos.z = p.z;
      }
      // le corps s'oriente vers le déplacement (ou le regard en marche arrière / couché)
      const moveYaw = this.stance === 'prone' || fz < 0 ? this.yaw : Math.atan2(sy * fz + cy * fx, cy * fz - sy * fx);
      let d = moveYaw - this.bodyYaw;
      d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.bodyYaw += d * Math.min(1, dt * 9);
      // longueur d'un pas (m) : la cadence des appuis, visibles et sonores, suit la vitesse au sol sans glisser
      const stepLen = this.stance === 'stand' ? (run ? 1.3 : 0.8) : this.stance === 'crouch' ? 0.55 : 0.7;
      const dPhase = (this.speed * dt * Math.PI) / stepLen;
      this.pose.phase += dPhase;
      this.stepAcc += dPhase;
      if (this.stepAcc > Math.PI) {
        this.stepAcc -= Math.PI;
        if (this.stance === 'prone') this.ev.cloth(0.5);
        else this.ev.footstep(this.surface, run ? 1 : this.stance === 'crouch' ? 0.35 : 0.6);
      }
    } else if (this.stance === 'prone' || inScope) {
      let d = this.yaw - this.bodyYaw;
      d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(d) > 0.02) {
        this.bodyYaw += d * Math.min(1, dt * 5);
        if (Math.abs(d) > 0.3) this.heartRate = Math.min(150, this.heartRate + dt * 6);
      }
    }
    // --- vertical ---
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y > g + 0.02) {
      this.vy -= 12 * dt;
      this.pos.y = Math.max(g, this.pos.y + this.vy * dt);
    } else {
      // montée lissée (marches), mais jamais plus de 5 cm sous le sol dans les pentes raides
      this.pos.y = Math.max(damp(this.pos.y, g, 18, dt), g - 0.05);
      this.vy = 0;
    }

    // --- cœur ---
    const effort = this.moving ? (run ? 150 : this.stance === 'prone' ? 104 : this.stance === 'crouch' ? 92 : 84) : 58;
    this.heartRate = damp(this.heartRate, effort, effort > this.heartRate ? 0.22 : 0.055, dt);

    // --- appui : un mur à moins de 0,95 m ---
    this.supported = false;
    if (this.stance === 'crouch') {
      for (const s of this.col.segs) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        let t = ((this.pos.x - s.ax) * dx + (this.pos.z - s.az) * dz) / (dx * dx + dz * dz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(this.pos.x - s.ax - dx * t, this.pos.z - s.az - dz * t) < s.r + 0.95 && s.y1 > this.pos.y + 0.7) { this.supported = true; break; }
      }
    }

    // --- pose ---
    this.aiming = damp(this.aiming, inScope ? 1 : 0, 8, dt);
    const p = this.pose;
    p.stanceBlend = this.stanceBlend;
    p.stance = this.stance;
    p.move = this.speed / 1.9 > 1 ? 1 + (this.speed - 1.9) / 2.4 : this.speed / Math.max(0.3, Math.min(1.9, max));
    p.aim = Math.max(this.aiming, this.stance === 'prone' && !this.moving ? 0.8 : 0);
    p.time += dt;
    p.headYaw = 0;
    this.char.rig.pose(p);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.PI - this.bodyYaw;
  }

  /** Position de l'œil derrière la lunette. */
  eye(out: Vector3): Vector3 {
    const h = this.stance === 'prone' ? 0.27 : this.supported ? 1.16 : 1.12;
    const f = this.stance === 'prone' ? 0.3 : this.supported ? 0.55 : 0.34;
    return out.set(this.pos.x + Math.sin(this.yaw) * f, this.pos.y + h, this.pos.z - Math.cos(this.yaw) * f);
  }

  /**
   * Caméra à la troisième personne, par-dessus l'épaule droite. `portrait` : écran vertical, champ horizontal plus
   * étroit et champ vertical plus grand ; la caméra recule un peu, se rapproche de l'axe du tireur et vise plus haut,
   * pour qu'il reste entier dans le bas gauche du cadre sans masquer le centre.
   */
  applyCamera(cam: PerspectiveCamera, dt: number, snap = false, portrait = false): void {
    const sb = this.stanceBlend;
    const headH = sb < 1 ? 1.62 - 0.5 * sb : 1.12 - 0.62 * (sb - 1);
    const dist = (sb < 1 ? 3.1 - 0.5 * sb : 2.6 - 0.3 * (sb - 1)) * (portrait ? PORTRAIT_CAM.dist : 1);
    const side = portrait ? PORTRAIT_CAM.side : 0.68, lift = portrait ? PORTRAIT_CAM.lift : 0.14;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this.tmp.set(sy * cp, sp, -cy * cp);
    const pivot = this.tmp2.set(this.pos.x + cy * side, this.pos.y + headH + lift, this.pos.z + sy * side);
    const want = this.hit.copy(pivot).addScaledVector(dir, -dist);
    // collisions : murs puis terrain
    let d = dist;
    const hd = this.col.segment(pivot, want);
    if (hd >= 0) d = Math.min(d, hd - 0.2);
    const tp = new Vector3();
    if (this.terrain.raycast(pivot.x, pivot.y, pivot.z, want.x, want.y, want.z, tp, 0.25)) d = Math.min(d, pivot.distanceTo(tp) - 0.2);
    d = Math.max(0.35, d);
    want.copy(pivot).addScaledVector(dir, -d);
    const minY = this.terrain.heightAt(want.x, want.z) + 0.2;
    if (want.y < minY) want.y = minY;
    if (!this.camInit || snap) { this.camPos.copy(want); this.camInit = true; }
    else {
      this.camPos.x = damp(this.camPos.x, want.x, 16, dt);
      this.camPos.y = damp(this.camPos.y, want.y, 12, dt);
      this.camPos.z = damp(this.camPos.z, want.z, 16, dt);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(pivot.x + dir.x * 30, pivot.y + dir.y * 30, pivot.z + dir.z * 30);
  }

  /**
   * Prochain point de passage vers un poste : celui que le site indique (escalier, brèche…), le poste lui-même sinon.
   */
  guideTo(key: string, out: { x: number; z: number; dist: number; bearing: number; hint: string }): boolean {
    const post = this.site.posts[key];
    if (!post) return false;
    const wp = this.nav.waypoint?.(key, this.pos) ?? null;
    const x = wp ? wp.x : post.x, z = wp ? wp.z : post.z, hint = wp ? wp.hint : '';
    out.x = x;
    out.z = z;
    out.dist = Math.hypot(x - this.pos.x, z - this.pos.z) + (hint ? Math.hypot(post.x - x, post.z - z) : 0);
    out.bearing = Math.atan2(x - this.pos.x, -(z - this.pos.z));
    out.hint = hint;
    return true;
  }

  /** Poste de tir nommé le plus proche (pour l'interface), ou null. */
  nearestPost(): string | null {
    let best: string | null = null, bd = 3.2;
    for (const [k, p] of Object.entries(this.site.posts)) {
      // la hauteur ne compte que pour un poste en étage : les autres sont au sol, quel que soit le relief
      const d = Math.hypot(this.pos.x - p.x, this.pos.z - p.z) + ((p.y ?? 0) > 1 ? Math.abs(this.pos.y - this.site.baseY - (p.y ?? 0)) * 0.6 : 0);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  /** zone jouable (tests automatisés) */
  isAllowed(x: number, z: number): boolean {
    return this.nav.allowed(x, z);
  }
  /** pour les tests et la mise en scène */
  teleport(x: number, z: number, yaw: number, stance: Stance, yOff = 0): void {
    this.pos.set(x, 0, z);
    this.pos.y = this.groundAt(x, z, this.site.baseY + yOff + 0.3);
    this.yaw = this.bodyYaw = yaw;
    this.stance = stance;
    this.stanceBlend = stance === 'stand' ? 0 : stance === 'crouch' ? 1 : 2;
    this.speed = 0;
    this.camInit = false;
  }
}
void smoothstep;
