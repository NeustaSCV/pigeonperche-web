// Vue lunette : visée, grossissement, tremblement (respiration, cœur), apnée, recul, réticule gradué en mrad au premier plan focal.
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Input } from '../core/input';
import { damp } from '../core/noise';
import { recoilVelocity, type WeaponDef } from '../config/weapons';
import type { Rifle } from './rifle';
import {
  AXIS_MIL, BAR_BOTTOM_START_MIL, BAR_MIL, BAR_START_MIL, CENTER_DOT_MIL, CENTER_GAP_MIL, LINE_MIL, RETICLE, TREE_MIL, reticleLod, treeHalfWidth,
} from './reticle-geometry';

export const BASE_FOV = 55;
const TAN_BASE = Math.tan((BASE_FOV * Math.PI) / 360);
/** champ vertical à ce grossissement sur l'écran paysage de référence (sert à la sensibilité de visée) ; le champ
 *  réellement donné à la caméra dépend de l'écran : voir `Engine.scopeFov` */
export const fovForZoom = (mag: number): number => (Math.atan(TAN_BASE / mag) * 360) / Math.PI;

export type Breath = 'normal' | 'held' | 'gasping';

/** distance de l'œil à l'objectif de la lunette, m : dégagement oculaire (9 cm) et longueur du corps (36 cm) */
export const SCOPE_OBJECTIVE = 0.45;

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

  /**
   * Applique le recul d'un tir. `jump` : facteur du saut du champ (effets du coup de feu, src/world/shotfx-params.ts) ;
   * il ne touche que l'impulsion du ressort, pas le déplacement résiduel de la visée ni le noir du départ.
   */
  recoil(def: WeaponDef, jump = 1): void {
    const v = recoilVelocity(def);
    const kick = (v * 4 + def.chargeGr * 0.08) * (this.stability > 1.2 ? 1.5 : 1);
    // impulsion : vitesse initiale du ressort (mrad/s)
    this.kvY += kick * 16 * jump;
    this.kvX += (Math.random() - 0.5) * kick * 9 * jump;
    // la visée ne revient pas exactement au même endroit
    this.pitch += (Math.random() - 0.3) * kick * 0.00012;
    this.yaw += (Math.random() - 0.5) * kick * 0.00016;
    this.blackout = Math.min(0.85, kick * 0.035);
  }

  /** `fov` : champ vertical de la caméra pour le grossissement courant (`Engine.scopeFov`) */
  applyCamera(cam: PerspectiveCamera, eye: Vector3, fov: number): void {
    const y = this.yaw + (this.swayX + this.kickX) * 0.001;
    const p = this.pitch + (this.swayY + this.kickY) * 0.001;
    this.e.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    // l'image d'une lunette se forme à partir de son objectif, pas de l'œil : la caméra est avancée d'autant sur l'axe
    // de visée (même droite, donc même point visé). Sans cela, le sol ou le parapet situés sous la lunette
    // apparaissaient dans le champ alors que l'objectif les avait dépassés.
    cam.position.copy(eye).addScaledVector(this.e, SCOPE_OBJECTIVE);
    cam.lookAt(cam.position.x + this.e.x * 100, cam.position.y + this.e.y * 100, cam.position.z + this.e.z * 100);
    // léger roulis proportionnel au recul latéral
    this.q.setFromAxisAngle(this.e, this.kickX * 0.0015);
    cam.quaternion.premultiply(this.q);
    cam.fov = fov;
  }
}

/** noir légèrement translucide : l'aspect d'une gravure sur verre */
const INK = 'rgba(8,9,8,0.9)';
const GOLD = 'rgba(255,196,84,0.95)';
/** côté du petit canvas qui porte le losange du point d'impact prédit, px CSS */
const MARK = 18;

/**
 * Réticule gravé en mrad (croix ouverte, graduations fines, arbre de contre-visée de 24 mrad : cotes dans
 * reticle-geometry.ts), dessiné en canvas 2D par-dessus le rendu. Premier plan focal : il grossit avec l'image,
 * chaque graduation reste à sa valeur.
 * Le canvas n'est redessiné que si la vue ou le grossissement change (`draws` compte les tracés) ; le losange du
 * point d'impact prédit est un petit élément à part, déplacé sans rien redessiner.
 */
export class Reticle {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private mark: HTMLCanvasElement;
  private markKey = '';
  private lastKey = '';
  /** nombre de tracés complets du réticule depuis la création */
  draws = 0;
  /** point d'impact prédit (pixels par rapport au centre), mode assisté */
  predict: { x: number; y: number } | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'reticle';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    const m = (this.mark = document.createElement('canvas'));
    m.style.cssText = `position:absolute;left:0;top:0;width:${MARK}px;height:${MARK}px;pointer-events:none;display:none`;
    parent.appendChild(m);
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
    this.placeMark(visible, view, dpr);
    const key = `${w}x${h}:${view.cx.toFixed(1)}:${view.cy.toFixed(1)}:${view.R.toFixed(1)}:${fovDeg.toFixed(3)}:${visible >= 0.02 ? 1 : 0}:${dpr}`;
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
    this.draws++;
    const cx = view.cx, cy = view.cy, R = view.R;
    const ppm = Reticle.pxPerMil(fovDeg, h);
    const lod = reticleLod(ppm, dpr);
    g.save();
    g.beginPath();
    g.arc(cx, cy, R - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = INK;
    // rectangle donné en pixels par rapport au centre optique
    const rect = (x0: number, y0: number, x1: number, y1: number): void => g.rect(cx + x0, cy + y0, x1 - x0, y1 - y0);

    // ---- branches, barres extérieures, graduations séparables : un seul chemin ----
    g.beginPath();
    // les deux branches restent centrées sur le centre optique : c'est leur épaisseur qui s'ajuste aux pixels de
    // l'écran (nombre pair de pixels si le centre tombe entre deux pixels, impair s'il tombe au milieu d'un pixel),
    // pour un trait net sans déplacer le réticule
    const snap = (c: number): number => {
      const pos = c * dpr, want = lod.axisW * dpr;
      const onEdge = Math.abs(pos - Math.round(pos)) < 0.02, onMid = Math.abs(pos - Math.floor(pos) - 0.5) < 0.02;
      if (!onEdge && !onMid) return lod.axisW / 2;
      let n = Math.max(1, Math.round(want));
      if ((n % 2 === 0) !== onEdge) n += 1;
      return n / dpr / 2;
    };
    const ah = snap(cy), av = snap(cx), g0 = CENTER_GAP_MIL * ppm, g1 = (AXIS_MIL + LINE_MIL / 2) * ppm;
    rect(-g1, -ah, -g0, ah);
    rect(g0, -ah, g1, ah);
    rect(-av, -g1, av, -g0);
    rect(-av, g0, av, (TREE_MIL + LINE_MIL / 2) * ppm);
    const bar = Math.max(BAR_MIL * ppm, 2.5) / 2, b0 = BAR_START_MIL * ppm;
    rect(-R, -bar, -b0, bar);
    rect(b0, -bar, R, bar);
    rect(-bar, -R, bar, -b0);
    rect(-bar, BAR_BOTTOM_START_MIL * ppm, bar, R);
    const t = lod.tickW / 2;
    for (const k of RETICLE.ticks) {
      if (k.pitch < lod.minPitch) continue;
      const p = k.at * ppm;
      if (k.axis === 'h') rect(p - t, k.from * ppm, p + t, k.to * ppm);
      else rect(k.from * ppm, p - t, k.to * ppm, p + t);
    }
    // point central flottant, points de dérive séparables
    const dot = (x: number, y: number, d: number): void => { g.moveTo(cx + x + d / 2, cy + y); g.arc(cx + x, cy + y, d / 2, 0, Math.PI * 2); };
    dot(0, 0, Math.max(CENTER_DOT_MIL * ppm, lod.axisW * 1.5, 1.5));
    if (lod.dots) for (const d of RETICLE.dots) if (d.y % lod.rowStep === 0) dot(d.x * ppm, d.y * ppm, lod.dotPx);
    // léger liseré clair : la gravure noire reste lisible sur un fond sombre, sans se voir sur un fond clair
    g.shadowColor = 'rgba(236,240,232,0.55)';
    g.shadowBlur = 1.6 * dpr;
    g.fill();

    // ---- familles trop serrées pour l'écran : elles se fondent en grisé, au taux de couverture des traits ----
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    for (const b of RETICLE.bands) {
      if (b.pitch >= lod.minPitch) continue;
      g.globalAlpha = Math.min(0.5, lod.tickW / (b.pitch * ppm));
      g.beginPath();
      rect(Math.min(b.a0, b.a1) * ppm, b.from * ppm, Math.max(b.a0, b.a1) * ppm, b.to * ppm);
      g.fill();
    }
    if (!lod.dots) {
      // points de dérive non séparables : un trait gris par ligne de l'arbre, sur toute sa largeur
      const dh = lod.dotPx / 3;
      g.globalAlpha = 0.32;
      g.beginPath();
      for (let drop = 2; drop <= TREE_MIL; drop += 2) {
        const e = treeHalfWidth(drop) * ppm, y = drop * ppm;
        if (y - dh > R) break;
        rect(-e, y - dh, -ppm, y + dh);
        rect(ppm, y - dh, e, y + dh);
      }
      g.fill();
    }
    g.globalAlpha = 1;

    // ---- chiffres ----
    if (lod.labels !== 'none') {
      const f = lod.fontPx, cap = f * 0.72;
      g.font = `500 ${f.toFixed(2)}px ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
      g.textBaseline = 'alphabetic';
      g.shadowColor = 'rgba(236,240,232,0.55)';
      g.shadowBlur = 1.6 * dpr;
      for (const l of RETICLE.labels) {
        // à faible grossissement : seulement les lignes de l'arbre multiples de 4, rien autour du centre
        if (lod.labels === 'sparse' && (l.value % 4 !== 0 || l.y < 1)) continue;
        g.textAlign = l.anchor === 'bottom' ? 'center' : l.anchor;
        g.fillText(l.text, cx + l.x * ppm, cy + l.y * ppm + (l.anchor === 'bottom' ? 0 : cap / 2));
      }
    }
    g.restore();
  }

  /** Losange du point d'impact prédit (mode assisté) : dessiné une fois, puis seulement déplacé. */
  private placeMark(visible: number, view: { cx: number; cy: number; R: number }, dpr: number): void {
    const m = this.mark, p = this.predict;
    const show = !!p && visible >= 0.02 && Math.hypot(p.x, p.y) < view.R - 2 - MARK / 2;
    const key = show ? `${dpr}:${(view.cx + p!.x).toFixed(1)}:${(view.cy + p!.y).toFixed(1)}:${visible.toFixed(2)}` : '';
    if (key === this.markKey) return;
    this.markKey = key;
    if (!show) { m.style.display = 'none'; return; }
    if (m.width !== MARK * dpr) {
      m.width = m.height = MARK * dpr;
      const g = m.getContext('2d')!, c = MARK / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = g.fillStyle = GOLD;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(c, c - 6); g.lineTo(c + 6, c); g.lineTo(c, c + 6); g.lineTo(c - 6, c); g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(c, c, 1.2, 0, Math.PI * 2);
      g.fill();
    }
    m.style.display = 'block';
    m.style.opacity = String(visible);
    m.style.transform = `translate(${(view.cx + p!.x - MARK / 2).toFixed(2)}px,${(view.cy + p!.y - MARK / 2).toFixed(2)}px)`;
  }
}
