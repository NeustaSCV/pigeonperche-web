// Vue lunette : visée, grossissement, tremblement (respiration, cœur), apnée, recul, réticule mil-dot au premier plan focal.
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Input } from '../core/input';
import { damp } from '../core/noise';
import { recoilVelocity, type WeaponDef } from '../config/weapons';
import type { Rifle } from './rifle';

export const BASE_FOV = 55;
const TAN_BASE = Math.tan((BASE_FOV * Math.PI) / 360);
/** champ vertical à ce grossissement sur l'écran paysage de référence (sert à la sensibilité de visée) ; le champ
 *  réellement donné à la caméra dépend de l'écran : voir `Engine.scopeFov` */
export const fovForZoom = (mag: number): number => (Math.atan(TAN_BASE / mag) * 360) / Math.PI;

export type Breath = 'normal' | 'held' | 'gasping';

export class Scope {
  active = false;
  /** 0..1 fondu d'entrée */
  amount = 0;
  yaw = 0;
  pitch = 0;
  /** écart instantané de la visée dû au tremblement (mrad) */
  swayX = 0;
  swayY = 0;
  /** recul en cours (mrad) */
  kickX = 0;
  kickY = 0;
  breath: Breath = 'normal';
  /** réserve d'air 0..1 */
  air = 1;
  /** facteur de stabilité de la posture (1 = couché sur bipied) */
  stability = 1;
  blackout = 0;
  /** décalage de l'œil derrière l'oculaire (ombre de lunette) */
  eyeX = 0;
  eyeY = 0;
  private breathPhase = 0;
  private beatPhase = 0;
  private beatX = 0;
  private beatY = 0;
  private t = 0;
  private gasp = 0;
  private kvX = 0;
  private kvY = 0;
  private q = new Quaternion();
  private e = new Vector3();

  enter(yaw: number, pitch: number): void {
    this.active = true;
    this.yaw = yaw;
    this.pitch = pitch;
  }
  exit(): void {
    this.active = false;
  }

  /** Direction de la ligne de visée (tremblement et recul compris). */
  lineOfSight(out: Vector3): Vector3 {
    const y = this.yaw + (this.swayX + this.kickX) * 0.001;
    const p = this.pitch + (this.swayY + this.kickY) * 0.001;
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  update(dt: number, input: Input, rifle: Rifle, heartRate: number, stability: number): void {
    this.amount = damp(this.amount, this.active ? 1 : 0, 10, dt);
    this.t += dt;
    this.stability = stability;
    if (this.active) {
      const fov = fovForZoom(rifle.zoom);
      const sens = 0.0022 * (fov / BASE_FOV) * 0.9;
      this.yaw += input.dx * sens;
      this.pitch = Math.min(0.6, Math.max(-0.9, this.pitch - input.dy * sens));
      if (input.wheel !== 0) {
        const [a, b] = rifle.def.scope;
        const z = Math.min(b, Math.max(a, rifle.zoom * (input.wheel < 0 ? 1.18 : 1 / 1.18)));
        rifle.zoom = z;
      }
      const fine = input.down('ShiftRight') ? 10 : 1;
      if (input.hit('ArrowUp')) rifle.clickElev(fine);
      if (input.hit('ArrowDown')) rifle.clickElev(-fine);
      if (input.hit('ArrowRight')) rifle.clickWind(1);
      if (input.hit('ArrowLeft')) rifle.clickWind(-1);
      // commandes tactiles : clics de tourelle et grossissement
      if (input.enabled) {
        if (input.elevDelta !== 0) rifle.clickElev(input.elevDelta);
        if (input.windDelta !== 0) rifle.clickWind(input.windDelta);
        if (input.zoomMul !== 1) {
          const [a, b] = rifle.def.scope;
          rifle.zoom = Math.min(b, Math.max(a, rifle.zoom * input.zoomMul));
        }
      }
    }
    // --- souffle ---
    const hrK = Math.max(0, (heartRate - 60) / 90); // 0 au repos, 1 après un sprint
    const wantHold = this.active && (input.down('Space') || input.down('ShiftLeft'));
    if (this.gasp > 0) {
      this.gasp -= dt;
      this.breath = 'gasping';
      this.air = Math.min(1, this.air + dt * 0.22);
    } else if (wantHold && this.air > 0) {
      this.breath = 'held';
      this.air -= dt / (8.5 - 5 * hrK);
      if (this.air <= 0) this.gasp = 2.6;
    } else {
      this.breath = 'normal';
      this.air = Math.min(1, this.air + dt * 0.3);
    }
    const period = 4.4 - 2.3 * hrK;
    const hold = this.breath === 'held' ? 0.1 : this.breath === 'gasping' ? 2.3 : 1;
    this.breathPhase += (dt * Math.PI * 2) / (this.breath === 'gasping' ? period * 0.5 : period);
    const base = 0.42 * stability * (1 + 1.6 * hrK);
    const amp = base * hold;
    // respiration : surtout verticale, légère dérive en huit
    let sx = amp * 0.35 * Math.sin(this.breathPhase * 0.5 + 0.7);
    let sy = amp * Math.sin(this.breathPhase);
    // tremblement musculaire
    const tr = 0.16 * stability * (1 + hrK) * (this.breath === 'gasping' ? 1.8 : 1);
    sx += tr * (Math.sin(this.t * 2.9) * 0.6 + Math.sin(this.t * 7.3 + 1) * 0.3 + Math.sin(this.t * 13.1) * 0.1);
    sy += tr * (Math.sin(this.t * 3.7 + 2) * 0.6 + Math.sin(this.t * 6.1) * 0.3 + Math.sin(this.t * 11.7 + 0.5) * 0.1);
    // pouls : petite secousse à chaque battement, plus visible en apnée
    this.beatPhase += (dt * heartRate) / 60;
    if (this.beatPhase >= 1) {
      this.beatPhase -= 1;
      const a = Math.random() * Math.PI * 2;
      const k = 0.11 * stability * (1 + 1.2 * hrK);
      this.beatX = Math.cos(a) * k * 0.6;
      this.beatY = (0.6 + Math.abs(Math.sin(a)) * 0.6) * k;
    }
    this.beatX = damp(this.beatX, 0, 9, dt);
    this.beatY = damp(this.beatY, 0, 9, dt);
    this.swayX = damp(this.swayX, sx + this.beatX, 14, dt);
    this.swayY = damp(this.swayY, sy + this.beatY, 14, dt);
    // --- recul : ressort amorti ---
    const stiff = 38, dmp = 9;
    this.kvX += (-stiff * this.kickX - dmp * this.kvX) * dt;
    this.kvY += (-stiff * this.kickY - dmp * this.kvY) * dt;
    this.kickX += this.kvX * dt;
    this.kickY += this.kvY * dt;
    this.blackout = damp(this.blackout, 0, 7, dt);
    this.eyeX = damp(this.eyeX, -this.kvX * 0.0006 + this.swayX * 0.004, 12, dt);
    this.eyeY = damp(this.eyeY, this.kvY * 0.0009 + this.swayY * 0.004, 12, dt);
  }

  /** Applique le recul d'un tir. */
  recoil(def: WeaponDef): void {
    const v = recoilVelocity(def);
    const kick = (v * 4 + def.chargeGr * 0.08) * (this.stability > 1.2 ? 1.5 : 1);
    // impulsion : vitesse initiale du ressort (mrad/s)
    this.kvY += kick * 16;
    this.kvX += (Math.random() - 0.5) * kick * 9;
    // la visée ne revient pas exactement au même endroit
    this.pitch += (Math.random() - 0.3) * kick * 0.00012;
    this.yaw += (Math.random() - 0.5) * kick * 0.00016;
    this.blackout = Math.min(0.85, kick * 0.035);
  }

  /** `fov` : champ vertical de la caméra pour le grossissement courant (`Engine.scopeFov`) */
  applyCamera(cam: PerspectiveCamera, eye: Vector3, fov: number): void {
    cam.position.copy(eye);
    const y = this.yaw + (this.swayX + this.kickX) * 0.001;
    const p = this.pitch + (this.swayY + this.kickY) * 0.001;
    this.e.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    cam.lookAt(eye.x + this.e.x * 100, eye.y + this.e.y * 100, eye.z + this.e.z * 100);
    // léger roulis proportionnel au recul latéral
    this.q.setFromAxisAngle(this.e, this.kickX * 0.0015);
    cam.quaternion.premultiply(this.q);
    cam.fov = fov;
  }
}

/** Réticule mil-dot, dessiné en canvas 2D par-dessus le rendu. Premier plan focal : il grossit avec l'image. */
export class Reticle {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lastKey = '';
  /** point d'impact prédit (pixels par rapport au centre), mode assisté */
  predict: { x: number; y: number } | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'reticle';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  /** pixels (CSS) par milliradian pour le champ courant */
  static pxPerMil(fovDeg: number, heightPx: number): number {
    return heightPx / 2 / Math.tan((fovDeg * Math.PI) / 360) / 1000;
  }

  /**
   * `fovDeg` : champ vertical réel de la caméra sur la hauteur `view.h` ; `view` : taille utile, centre optique et
   * rayon du champ (centre de l'écran et 0,462 × hauteur en paysage ; moitié haute et largeur de l'écran en portrait).
   */
  draw(fovDeg: number, visible: number, view: { w: number; h: number; cx: number; cy: number; R: number }): void {
    const w = view.w, h = view.h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pk = this.predict ? `${Math.round(this.predict.x)},${Math.round(this.predict.y)}` : '';
    const key = `${w}x${h}:${view.cx.toFixed(1)}:${view.cy.toFixed(1)}:${view.R.toFixed(1)}:${fovDeg.toFixed(3)}:${visible > 0.5 ? 1 : 0}:${pk}`;
    this.canvas.style.opacity = String(visible);
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (visible < 0.02) return;
    const cx = view.cx, cy = view.cy;
    const ppm = Reticle.pxPerMil(fovDeg, h);
    const R = view.R;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R - 2, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = 'rgba(8,8,8,0.92)';
    g.fillStyle = 'rgba(8,8,8,0.92)';
    const thin = Math.max(1, Math.min(1.6, ppm * 0.045));
    g.lineWidth = thin;
    const gap = 0.35 * ppm; // centre dégagé
    const fine = 10 * ppm; // au-delà : barres épaisses
    const line = (x0: number, y0: number, x1: number, y1: number): void => {
      g.beginPath();
      g.moveTo(cx + x0, cy + y0);
      g.lineTo(cx + x1, cy + y1);
      g.stroke();
    };
    line(-fine, 0, -gap, 0);
    line(gap, 0, fine, 0);
    line(0, -fine, 0, -gap);
    line(0, gap, 0, Math.min(R, 24 * ppm));
    // point central
    g.beginPath();
    g.arc(cx, cy, Math.max(0.9, 0.05 * ppm), 0, Math.PI * 2);
    g.fill();
    // graduations : point plein tous les mils, tiret au demi-mil, chiffres pairs
    const dot = Math.max(1.3, Math.min(4, 0.11 * ppm));
    g.font = `${Math.max(9, Math.min(13, ppm * 0.5))}px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const maxDown = Math.min(24, Math.floor(R / ppm));
    for (let m = 1; m <= 10; m++) {
      for (const [sx, sy] of [[1, 0], [-1, 0], [0, -1]] as const) {
        g.beginPath();
        g.arc(cx + sx * m * ppm, cy + sy * m * ppm, dot, 0, Math.PI * 2);
        g.fill();
        if (ppm > 9) {
          const hx = (m - 0.5) * ppm;
          if (sx !== 0) line(sx * hx, -0.12 * ppm, sx * hx, 0.12 * ppm);
          else line(-0.12 * ppm, sy * hx, 0.12 * ppm, sy * hx);
        }
      }
    }
    // branche basse : sapin de contre-visée jusqu'à 24 mils, repères de vent
    for (let m = 1; m <= maxDown; m++) {
      const y = m * ppm;
      g.beginPath();
      g.arc(cx, cy + y, dot, 0, Math.PI * 2);
      g.fill();
      if (ppm > 9) line(-0.12 * ppm, y - 0.5 * ppm, 0.12 * ppm, y - 0.5 * ppm);
      const half = Math.min(6, 1 + Math.floor(m / 2));
      if (m % 2 === 0) {
        for (let k = 1; k <= half; k++)
          for (const s of [-1, 1]) {
            g.beginPath();
            g.arc(cx + s * k * ppm, cy + y, dot * 0.6, 0, Math.PI * 2);
            g.fill();
          }
        if (ppm > 7) g.fillText(String(m), cx + (half + 0.9) * ppm, cy + y);
      }
    }
    if (ppm > 7) for (const m of [2, 4, 6, 8, 10]) for (const s of [-1, 1]) g.fillText(String(m), cx + s * m * ppm, cy + 0.75 * ppm);
    // barres épaisses extérieures
    g.lineWidth = Math.max(2.5, 0.22 * ppm);
    line(-R, 0, -fine - 0.5 * ppm, 0);
    line(fine + 0.5 * ppm, 0, R, 0);
    line(0, -R, 0, -fine - 0.5 * ppm);
    // point d'impact prédit (mode assisté)
    if (this.predict) {
      g.strokeStyle = 'rgba(255,196,84,0.95)';
      g.lineWidth = 1.5;
      const px = cx + this.predict.x, py = cy + this.predict.y;
      g.beginPath();
      g.moveTo(px, py - 6); g.lineTo(px + 6, py); g.lineTo(px, py + 6); g.lineTo(px - 6, py); g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(px, py, 1.2, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,196,84,0.95)';
      g.fill();
    }
    g.restore();
  }
}
