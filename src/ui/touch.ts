// Commandes tactiles : manette flottante, regard par glissement, boutons. En portrait (téléphone), la manette
// naît sous le pouce gauche dans le bas de l'écran et tout le reste de la surface libre sert à regarder ; en
// paysage (tablette), moitié gauche pour la manette, moitié droite pour le regard.
// Tout passe par `Input` (touches virtuelles, deltas de visée, axes) : la logique du jeu ne sait pas qu'elle
// est pilotée au doigt. Chaque doigt est suivi par son `pointerId` ; un geste interrompu (`pointercancel`,
// perte de capture, onglet masqué) relâche ce qu'il tenait.
import type { Input } from '../core/input';

export interface TouchFrame {
  /** en jeu (état « play ») */
  play: boolean;
  /** caméra de balle : un toucher la passe, les boutons sont masqués */
  bulletCam: boolean;
  scope: boolean;
  stance: 'stand' | 'crouch' | 'prone';
  nearRack: boolean;
  canReload: boolean;
  /** télémètre disponible (pas en Réaliste) */
  canRange: boolean;
  zoom: number;
  elev: number;
  /** contre-visée à rappeler près de l'élévation (« + 4,2 mrad », « butée », ou vide) */
  hold?: string;
  wind: number;
  /** boutons à mettre en évidence (tutoriel) */
  halo: string[];
  /** mise en page portrait : manette dans le bas gauche de l'écran */
  portrait?: boolean;
  // --- mode en ligne seulement (src/online/mode.ts) : absents en solo, où rien de ce qui suit n'a d'effet ---
  /** en ligne : briefing, carnet, postures, râtelier et télémètre masqués ; « Régler sur la cible » et « Diversion » offerts */
  online?: boolean;
  /** joueur fixe : la manette de déplacement est désarmée, toute la surface libre sert à regarder */
  fixed?: boolean;
  /** en ligne, spectateur : ni tir, ni tourelles, ni diversion */
  unarmed?: boolean;
  /** en ligne : secondes à attendre avant la prochaine diversion (0 : disponible) */
  divertIn?: number;
  /** en ligne : la ligne d'explication de chaque tourelle, pour les débutants (élévation, dérive) */
  turretHelp?: { elev: string; wind: string };
}

type Kind = 'tap' | 'hold' | 'repeat';
interface Btn {
  id: string;
  kind: Kind;
  label: string;
  icon?: string;
  /** texte à la place du pictogramme */
  glyph?: string;
  show: (f: TouchFrame) => boolean;
  down: (inp: Input) => void;
  up?: (inp: Input) => void;
  /** libellé dépendant de l'état */
  dyn?: (f: TouchFrame) => string;
  buzz?: number;
}

const S = (d: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON: Record<string, string> = {
  fire: S('<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6"/><circle cx="12" cy="12" r="0.9" class="f"/>'),
  aim: S('<circle cx="9.5" cy="12" r="6"/><path d="M15.5 9.5h6v5h-6M2 12h3.5M9.5 6v2.5M9.5 15.5V18"/>'),
  breath: S('<path d="M2 9c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.2 5-1M2 16c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.2 5-1"/>'),
  crouch: S('<circle cx="12" cy="5.5" r="2.2"/><path d="M12 8v5l-4.5 2.5L9 21M12 13l4 3-1 5"/>'),
  stand: S('<circle cx="12" cy="4" r="2.2"/><path d="M12 6.5V15M12 15l-3 7M12 15l3 7M7.5 10h9"/>'),
  prone: S('<circle cx="4.5" cy="13" r="2.2"/><path d="M7 14.5h14M9 14.5l2-4h4M2 19h20"/>'),
  reload: S('<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.8 3.2v4.2h-4.2"/>'),
  range: S('<path d="M2.5 6v12M21.5 6v12M5.5 12h13M8.5 9l-3 3 3 3M15.5 9l3 3-3 3"/>'),
  rack: S('<path d="M3 20.5h18M6.5 20.5V5M12 20.5V3M17.5 20.5V5M3 9.5h18"/>'),
  book: S('<path d="M12 6.2c-2.4-1.7-5.4-1.9-9-1v13.6c3.6-.9 6.6-.7 9 1 2.4-1.7 5.4-1.9 9-1V5.2c-3.6-.9-6.6-.7-9 1zM12 6.2v13.6"/>'),
  brief: S('<path d="M6 2.5h8.5L19 7v14.5H6zM14.5 2.5V7H19M9 12h7M9 15.5h7M9 8.5h3"/>'),
  pause: S('<path d="M8.5 5v14M15.5 5v14"/>'),
  // en ligne : cadre posé sur la cible (régler les tourelles sur elle), haut-parleur (diversion)
  target: S('<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="0.9" class="f"/>'),
  divert: S('<path d="M3.5 9.5v5H7l4.5 4v-13L7 9.5zM15.2 9a4.2 4.2 0 0 1 0 6M17.8 6.4a7.8 7.8 0 0 1 0 11.2"/>'),
};

const BTNS: Btn[] = [
  { id: 'pause', kind: 'tap', label: 'Pause', icon: 'pause', show: (f) => !f.bulletCam, down: () => {} },
  { id: 'brief', kind: 'tap', label: 'Briefing', icon: 'brief', show: (f) => !f.bulletCam && !f.online, down: (i) => i.vpress('KeyB') },
  { id: 'book', kind: 'tap', label: 'Carnet', icon: 'book', show: (f) => !f.bulletCam && !f.online, down: (i) => i.vpress('Tab') },
  { id: 'fire', kind: 'tap', label: 'Tirer', icon: 'fire', show: (f) => f.scope && !f.unarmed, down: (i) => i.vclick(0), buzz: 22 },
  { id: 'aim', kind: 'tap', label: 'Épauler', icon: 'aim', show: (f) => f.scope || f.stance !== 'stand' || !!f.online, down: (i) => i.vpress('KeyF'), dyn: (f) => (f.scope ? 'Quitter' : 'Épauler') },
  { id: 'reload', kind: 'tap', label: 'Recharger', icon: 'reload', show: (f) => f.canReload, down: (i) => i.vpress('KeyR') },
  { id: 'crouch', kind: 'tap', label: 'Accroupi', icon: 'crouch', show: (f) => !f.scope && f.stance !== 'prone' && !f.online, down: (i) => i.vpress('KeyC'), dyn: (f) => (f.stance === 'crouch' ? 'Debout' : 'Accroupi') },
  { id: 'prone', kind: 'tap', label: 'Couché', icon: 'prone', show: (f) => !f.scope && !f.online, down: () => {}, dyn: (f) => (f.stance === 'prone' ? 'Se relever' : 'Couché') },
  { id: 'rack', kind: 'tap', label: 'Râtelier', icon: 'rack', show: (f) => !f.scope && f.nearRack && !f.online, down: (i) => i.vpress('KeyE') },
  { id: 'breath', kind: 'hold', label: 'Souffle', icon: 'breath', show: (f) => f.scope && !f.unarmed, down: (i) => i.vdown('Space'), up: (i) => i.vup('Space') },
  { id: 'range', kind: 'tap', label: 'Télémètre', icon: 'range', show: (f) => f.scope && f.canRange && !f.online, down: (i) => i.vpress('KeyT') },
  { id: 'zin', kind: 'repeat', label: 'Grossir', glyph: '+', show: (f) => f.scope, down: (i) => (i.zoomMul *= 1.09) },
  { id: 'zout', kind: 'repeat', label: 'Élargir', glyph: '−', show: (f) => f.scope, down: (i) => (i.zoomMul /= 1.09) },
  { id: 'e-10', kind: 'repeat', label: 'Élévation −1 mrad', glyph: '−1', show: (f) => f.scope && !f.unarmed, down: (i) => (i.elevDelta -= 10) },
  { id: 'e-1', kind: 'repeat', label: 'Élévation −0,1 mrad', glyph: '−', show: (f) => f.scope && !f.unarmed, down: (i) => (i.elevDelta -= 1) },
  { id: 'e+1', kind: 'repeat', label: 'Élévation +0,1 mrad', glyph: '+', show: (f) => f.scope && !f.unarmed, down: (i) => (i.elevDelta += 1) },
  { id: 'e+10', kind: 'repeat', label: 'Élévation +1 mrad', glyph: '+1', show: (f) => f.scope && !f.unarmed, down: (i) => (i.elevDelta += 10) },
  { id: 'w-10', kind: 'repeat', label: 'Dérive 1 mrad à gauche', glyph: 'G1', show: (f) => f.scope && !f.unarmed, down: (i) => (i.windDelta -= 10) },
  { id: 'w-1', kind: 'repeat', label: 'Dérive 0,1 mrad à gauche', glyph: 'G', show: (f) => f.scope && !f.unarmed, down: (i) => (i.windDelta -= 1) },
  { id: 'w+1', kind: 'repeat', label: 'Dérive 0,1 mrad à droite', glyph: 'D', show: (f) => f.scope && !f.unarmed, down: (i) => (i.windDelta += 1) },
  { id: 'w+10', kind: 'repeat', label: 'Dérive 1 mrad à droite', glyph: 'D1', show: (f) => f.scope && !f.unarmed, down: (i) => (i.windDelta += 10) },
  // en ligne seulement : les touches G et V du clavier
  { id: 'target', kind: 'tap', label: 'Régler sur la cible', icon: 'target', show: (f) => !!f.online && f.scope && !f.unarmed, down: (i) => i.vpress('KeyG') },
  { id: 'divert', kind: 'tap', label: 'Diversion', icon: 'divert', show: (f) => !!f.online && !f.unarmed, down: (i) => i.vpress('KeyV'), dyn: (f) => ((f.divertIn ?? 0) > 0 ? `${Math.ceil(f.divertIn as number)} s` : 'Diversion') },
];
/** boutons à petit libellé sous le pictogramme */
const CAPTION = new Set(['fire', 'aim', 'reload', 'crouch', 'prone', 'rack', 'breath', 'range', 'target', 'divert']);

const fr = (n: number, d = 0): string => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 85;
/** sensibilité du regard au doigt hors lunette, en pixels souris par pixel CSS (en lunette : scopeLookGain) */
const LOOK_GAIN = 1.55;

/**
 * Sensibilité du doigt en lunette. Le jeu réduit déjà le déplacement en proportion du grossissement ; au doigt il
 * faut en plus (1) balayer plus large quand le zoom est au plus bas, pour chercher la cible sans glisser dix fois,
 * (2) garder un pointage fin à fort grossissement, (3) aller plus loin quand le geste est rapide.
 * `zoom` : grossissement courant ; `speed` : vitesse du doigt, px CSS par milliseconde.
 */
export function scopeLookGain(zoom: number, speed: number): number {
  // 2,6 à 4× et moins, 1,15 à 16× et plus (échelle logarithmique entre les deux)
  const u = Number.isFinite(zoom) ? Math.min(1, Math.max(0, Math.log(Math.max(zoom, 1) / 4) / Math.log(16 / 4))) : 1;
  const base = 2.6 + (1.15 - 2.6) * u;
  // geste lent (moins de 0,25 px/ms) : aucun supplément ; geste vif (1,2 px/ms et plus) : +80 %
  const fast = Number.isFinite(speed) ? Math.min(1, Math.max(0, (speed - 0.25) / 0.95)) : 0;
  return base * (1 + 0.8 * fast);
}
/** portrait : la manette ne naît que sous cette fraction de la hauteur */
const STICK_TOP = 0.42;

interface Held { btn: Btn; el: HTMLElement; timer: number }

export class TouchControls {
  root: HTMLElement;
  private els = new Map<string, HTMLElement>();
  private caps = new Map<string, HTMLElement>();
  private held = new Map<number, Held>();
  private look = new Map<number, { x: number; y: number; t: number }>();
  private stickId: number | null = null;
  private stick = { ox: 0, oy: 0 };
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;
  private pinch = 0;
  private f: TouchFrame = { play: false, bulletCam: false, scope: false, stance: 'stand', nearRack: false, canReload: false, canRange: true, zoom: 8, elev: 0, wind: 0, halo: [] };
  private last: Record<string, string> = {};
  private out: Record<string, HTMLElement> = {};
  /** rayon de la manette, en pixels CSS */
  private R = 54;
  onPause: () => void = () => {};

  constructor(parent: HTMLElement, private input: Input) {
    const b = (id: string): string => {
      const d = BTNS.find((x) => x.id === id)!;
      const cap = CAPTION.has(id) ? `<span data-cap="${id}">${d.label}</span>` : '';
      return `<button class="tb tb-${id.replace('+', 'p').replace('-', 'm')}" data-tb="${id}" aria-label="${d.label}">${d.icon ? ICON[d.icon] : `<b>${d.glyph}</b>`}${cap}</button>`;
    };
    parent.insertAdjacentHTML('beforeend', `
      <div id="touch">
        <div class="stick" data-o="stick"><i data-o="knob"></i></div>
        <div class="tg tg-top">${b('book')}${b('brief')}${b('pause')}</div>
        <div class="tg tg-turret">
          <div class="tur"><p class="tur-x" data-o="elevX"></p><div class="tl-row"><small data-o="elevL">Élévation</small><output data-o="elev">0,0</output></div>
          <div class="tb-row">${b('e-10')}${b('e-1')}${b('e+1')}${b('e+10')}</div></div>
          <div class="tur"><p class="tur-x" data-o="windX"></p><div class="tl-row"><small>Dérive</small><output data-o="wind">0,0</output></div>
          <div class="tb-row">${b('w-10')}${b('w-1')}${b('w+1')}${b('w+10')}</div></div>
        </div>
        <div class="tg tg-zoom">${b('zin')}<output data-o="zoom">8×</output>${b('zout')}</div>
        ${b('breath')}${b('range')}${b('fire')}${b('aim')}${b('reload')}${b('crouch')}${b('prone')}${b('rack')}${b('target')}${b('divert')}
      </div>`);
    this.root = parent.querySelector<HTMLElement>('#touch')!;
    this.root.querySelectorAll<HTMLElement>('[data-tb]').forEach((e) => this.els.set(e.dataset.tb!, e));
    this.root.querySelectorAll<HTMLElement>('[data-cap]').forEach((e) => this.caps.set(e.dataset.cap!, e));
    this.root.querySelectorAll<HTMLElement>('[data-o]').forEach((e) => (this.out[e.dataset.o!] = e));
    this.stickEl = this.out.stick;
    this.knobEl = this.out.knob;

    const r = this.root;
    r.addEventListener('pointerdown', (e) => this.down(e));
    r.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) r.addEventListener(t, (e) => this.up(e as PointerEvent));
    // un geste du système (appel entrant, centre de contrôle, changement d'application) ne doit rien laisser enfoncé
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('pagehide', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  /** boutons actuellement enfoncés (tests) */
  get pressed(): string[] {
    return [...this.held.values()].map((h) => h.btn.id);
  }
  get stickActive(): boolean {
    return this.stickId !== null;
  }

  private buzz(ms: number): void {
    try { navigator.vibrate?.(ms); } catch { /* pas de vibreur (iOS) */ }
  }

  private down(e: PointerEvent): void {
    if (!this.f.play) return;
    e.preventDefault();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tb]');
    if (el) {
      // (`wait` : diversion en ligne, pendant le délai imposé par le serveur)
      if (el.classList.contains('off') || el.classList.contains('wait')) return;
      const btn = BTNS.find((x) => x.id === el.dataset.tb)!;
      // un même bouton n'est tenu que par un doigt
      for (const h of this.held.values()) if (h.btn === btn) return;
      const h: Held = { btn, el, timer: 0 };
      this.held.set(e.pointerId, h);
      try { el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      el.classList.add('down');
      this.buzz(btn.buzz ?? 8);
      this.fire(btn);
      if (btn.kind === 'repeat') {
        h.timer = window.setTimeout(() => {
          h.timer = window.setInterval(() => { this.fire(btn); this.buzz(4); }, REPEAT_EVERY);
        }, REPEAT_DELAY);
      }
      return;
    }
    // caméra de balle : un toucher n'importe où la passe
    if (this.f.bulletCam) { this.input.vpress('Space'); return; }
    try { this.root.setPointerCapture(e.pointerId); } catch { /* idem */ }
    // zone de la manette : moitié gauche en paysage ; en portrait, le bas gauche seulement (le pouce gauche), tout
    // le reste de la surface libre sert à regarder
    const left = e.clientX < window.innerWidth / 2 && (!this.f.portrait || e.clientY > window.innerHeight * STICK_TOP);
    if (left && !this.f.scope && !this.f.fixed && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      this.R = 54 * (Number(getComputedStyle(this.root).getPropertyValue('--ts')) || 1);
      this.drawStick(0, 0);
      this.stickEl.classList.add('on');
      return;
    }
    // en lunette, tout l'écran sert à viser ; hors lunette, la zone de la manette lui est réservée
    if (left && !this.f.scope && !this.f.fixed) return;
    this.look.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
    this.pinch = 0;
  }

  private fire(btn: Btn): void {
    if (btn.id === 'pause') { this.onPause(); return; }
    if (btn.id === 'prone') { this.input.vpress(this.f.stance === 'prone' ? 'Space' : 'KeyX'); return; }
    btn.down(this.input);
  }

  private move(e: PointerEvent): void {
    const h = this.held.get(e.pointerId);
    if (h) {
      // le doigt a glissé hors du bouton : on relâche (rien ne reste « collé »)
      const r = h.el.getBoundingClientRect();
      const m = 18;
      if (e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m) this.release(e.pointerId);
      return;
    }
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      // manette flottante : au-delà de sa course, le centre suit le pouce
      if (len > this.R) {
        this.stick.ox += (dx / len) * (len - this.R);
        this.stick.oy += (dy / len) * (len - this.R);
        dx = (dx / len) * this.R;
        dy = (dy / len) * this.R;
      }
      this.setAxis(dx / this.R, dy / this.R);
      return;
    }
    const l = this.look.get(e.pointerId);
    if (!l) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    const dt = Math.max(1, e.timeStamp - l.t);
    l.x = e.clientX;
    l.y = e.clientY;
    l.t = e.timeStamp;
    if (this.f.scope && this.look.size === 2) {
      // pincement à deux doigts : grossissement
      const [a, b] = [...this.look.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 20 && d > 20) this.input.zoomMul *= Math.min(1.25, Math.max(0.8, d / this.pinch));
      this.pinch = d;
      return;
    }
    const g = this.f.scope ? scopeLookGain(this.f.zoom, Math.hypot(dx, dy) / dt) : LOOK_GAIN;
    this.input.addLook(dx * g, dy * g);
  }

  private setAxis(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const dead = 0.16;
    if (len < dead) { this.input.axisX = this.input.axisY = 0; this.input.run = false; }
    else {
      // zone morte retirée, course ramenée sur 0..1
      const k = Math.min(1, (len - dead) / (0.9 - dead)) / len;
      this.input.axisX = x * k;
      this.input.axisY = -y * k;
      this.input.run = len > 0.93 && -y > 0.5 * len;
    }
    this.drawStick(x, y);
  }
  private drawStick(x: number, y: number): void {
    this.stickEl.style.transform = `translate(${this.stick.ox}px, ${this.stick.oy}px)`;
    this.knobEl.style.transform = `translate(${x * this.R}px, ${y * this.R}px)`;
    this.stickEl.classList.toggle('run', this.input.run);
  }

  private up(e: PointerEvent): void {
    this.release(e.pointerId);
  }
  private release(id: number): void {
    const h = this.held.get(id);
    if (h) {
      this.held.delete(id);
      clearTimeout(h.timer);
      clearInterval(h.timer);
      h.el.classList.remove('down');
      h.btn.up?.(this.input);
      try { h.el.releasePointerCapture(id); } catch { /* déjà relâché */ }
    }
    if (id === this.stickId) this.dropStick();
    if (this.look.delete(id)) this.pinch = 0;
  }
  private dropStick(): void {
    this.stickId = null;
    this.input.axisX = this.input.axisY = 0;
    this.input.run = false;
    this.stickEl.classList.remove('on', 'run');
  }
  /** relâche tout : boutons, manette, regard */
  releaseAll(): void {
    for (const id of [...this.held.keys()]) this.release(id);
    this.dropStick();
    this.look.clear();
    this.pinch = 0;
    this.input.releaseVirtual();
  }

  private txt(key: string, el: HTMLElement, v: string): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    el.textContent = v;
  }

  /** à appeler à chaque image */
  update(f: TouchFrame): void {
    const was = this.f;
    this.f = f;
    if (was.play && !f.play) this.releaseAll();
    // l'entrée en lunette désarme la manette (on ne se déplace pas l'œil à l'oculaire)
    if (f.scope && !was.scope && this.stickId !== null) this.dropStick();
    const cls = (f.play ? 'on' : '') + (f.scope ? ' scope' : '') + (f.bulletCam ? ' cam' : '') + (f.online ? ' online' : '') + (f.unarmed ? ' unarmed' : '');
    if (this.last.cls !== cls) { this.last.cls = cls; this.root.className = cls; }
    if (!f.play) return;
    for (const b of BTNS) {
      const el = this.els.get(b.id)!;
      const on = b.show(f);
      const k = 'v:' + b.id;
      const v = on ? '1' : '0';
      if (this.last[k] !== v) {
        this.last[k] = v;
        el.classList.toggle('off', !on);
        // un bouton qui disparaît sous le doigt est relâché
        if (!on) for (const [id, h] of this.held) if (h.btn === b) this.release(id);
      }
      if (b.dyn) { const c = this.caps.get(b.id); if (c) this.txt('c:' + b.id, c, b.dyn(f)); }
      const hk = 'h:' + b.id;
      const hv = f.halo.includes(b.id) ? '1' : '0';
      if (this.last[hk] !== hv) { this.last[hk] = hv; el.classList.toggle('halo', hv === '1'); }
    }
    if (f.scope) {
      this.txt('zoom', this.out.zoom, fr(f.zoom, f.zoom < 10 ? 1 : 0) + '×');
      this.txt('elev', this.out.elev, fr(f.elev, 1));
      // tourelle en butée ou correction au-delà de sa course : le libellé de la tourelle rappelle la contre-visée
      const hold = f.hold ? (f.hold === 'butée' ? 'Butée' : f.hold.replace(' mrad', '').replace('+ ', '+') + ' ↓') : '';
      this.txt('elevL', this.out.elevL, hold || 'Élévation');
      this.out.elevL.classList.toggle('hold', !!hold);
      this.txt('wind', this.out.wind, (f.wind === 0 ? '' : f.wind > 0 ? 'D ' : 'G ') + fr(Math.abs(f.wind), 1));
    }
    if (f.online) {
      // diversion : bouton éteint tant que le serveur la refuserait
      const w = (f.divertIn ?? 0) > 0 ? '1' : '0';
      if (this.last.dw !== w) { this.last.dw = w; this.els.get('divert')!.classList.toggle('wait', w === '1'); }
      if (f.turretHelp) { this.txt('elevX', this.out.elevX, f.turretHelp.elev); this.txt('windX', this.out.windX, f.turretHelp.wind); }
    }
  }
}

/**
 * Schéma des commandes tactiles pour l'écran « Commandes » : deux téléphones tenus à la verticale (mise en page
 * portrait) et, pour une tablette tenue à l'horizontale, les deux schémas paysage. La feuille de style montre
 * l'un ou l'autre.
 */
export function touchHelpHtml(): string {
  const p = (cls: string, label: string): string => `<i class="${cls}"><em>${label}</em></i>`;
  const k = (cls: string, label: string): string => `<b class="k ${cls}">${label}</b>`;
  return `<div class="pschemas">
    <figure><div class="pschema">
      <div class="pz plook">Glisser<small>regarder</small></div>
      <div class="pz pstick"><u></u>Manette<small>se déplacer<br>à fond : courir</small></div>
      <div class="prow top">${k('', 'Carnet')}${k('', 'Brief.')}${k('', 'Pause')}</div>
      ${k('c rack', 'Râtelier')}${k('c crouch', 'Accroupi')}${k('c aim', 'Épauler')}${k('c prone', 'Couché')}
    </div><figcaption>Hors lunette</figcaption></figure>
    <figure><div class="pschema sc">
      <div class="pz pfield">Glisser : viser<small>pincer : grossissement</small></div>
      ${k('cn ctl', 'Carnet')}${k('cn ctr', 'Pause')}${k('cn cbl', 'Brief.')}
      <div class="prow e"><span>Élév.</span>${k('', '−1')}${k('', '−')}${k('', '+')}${k('', '+1')}</div>
      <div class="prow w"><span>Dérive</span>${k('', 'G1')}${k('', 'G')}${k('', 'D')}${k('', 'D1')}</div>
      <div class="prow z">${k('', '− zoom +')}${k('', 'Télém.')}${k('', 'Recharg.')}</div>
      ${k('c breath', 'Souffle')}${k('c quit', 'Quitter')}${k('c fire', 'Tirer')}
    </div><figcaption>En lunette</figcaption></figure>
  </div>
  <div class="tschemas">
    <figure><div class="tschema">
      <div class="z zl">Manette<small>se déplacer · à fond : courir</small></div>
      <div class="z zr">Glisser<small>regarder</small></div>
      ${p('p top', 'Carnet · Briefing · Pause')}${p('p r1', 'Couché')}${p('p r2', 'Accroupi')}${p('p r3', 'Épauler')}${p('p r4', 'Râtelier')}
    </div><figcaption>Hors lunette</figcaption></figure>
    <figure><div class="tschema sc">
      <div class="z zf">Glisser : viser<small>pincer à deux doigts : grossissement</small></div>
      ${p('p top', 'Carnet · Briefing · Pause')}${p('p r1 big', 'Tirer')}${p('p r3', 'Quitter')}${p('p r5', 'Recharger')}${p('p zm', '+ / − zoom')}
      ${p('p l1', 'Élévation −1 − + +1')}${p('p l2', 'Dérive G1 G D D1')}${p('p l3', 'Souffle')}${p('p l4', 'Télémètre')}
    </div><figcaption>En lunette</figcaption></figure>
  </div>`;
}
