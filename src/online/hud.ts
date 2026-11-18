// Affichage propre au mode en ligne, par-dessus le HUD du solo (src/ui/hud.ts), porté de src/ville/tir.js, reseau.js et
// ville.js. Deux vues ne se mélangent jamais :
//  - la vue de l'observateur, en haut à gauche, lunette à l'œil seulement : le poste visé, sa distance, la correction à
//    apporter ;
//  - la vue du tireur, l'encart des tourelles contre le bord gauche de la lunette : les commandes et l'ÉTAT du réglage,
//    expliqués aux débutants. Il ne dit jamais quoi afficher : ni correction, ni écart, ni sens dans lequel tourner.
// S'y ajoutent le pseudo du tireur visé au-dessus de sa tête (lunette à l'œil seulement), la jauge de vie, le voile
// « touché / abattu » et, pour le spectateur, la liste des emplacements. Module autonome : ses éléments, sa feuille de
// style ; il ne lit rien du jeu, on lui donne ce qu'il affiche (`HudView`).
import './online.css';
import { CLICK_MIL } from '../config/weapons';

const fr = (v: number, n = 1): string => v.toFixed(n).replace('.', ',');

/** Ce qu'il faut afficher à cette image. */
export interface HudView {
  /** la manche est à l'écran (ni salon, ni pause) */
  shown: boolean;
  /** lunette à l'œil */
  scope: boolean;
  /** spectateur : la liste des emplacements est offerte (en manche, pause comprise ; jamais au salon) */
  list: boolean;
  /** points de vie du joueur (null : pas de jauge, spectateur) */
  life: number | null;
  /** vue de l'observateur : poste visé, distance (m), correction en clair ; null : personne dans la lunette */
  observer: { place: string; range: number; correction: string } | null;
  /** réglage des tourelles, mrad, et butées */
  elev: number; wind: number; elevMax: number; windMax: number;
  /** touche à éclairer dans l'encart (code clavier), ou null */
  pressed: string | null;
  /** pseudos à poser à l'écran : position en pixels CSS (pied du texte), texte en clair */
  labels: { x: number; y: number; text: string }[];
  /** bord gauche du champ de la lunette, largeur et hauteur de la vue, en pixels CSS */
  fieldLeft: number; w: number; h: number;
}

/** Correction en clair pour la vue de l'observateur : élévation (ou tourelle + contre-visée), puis dérive. */
export function correctionText(s: { elev: number; dial: number; hold: number; wind: number } | null): string {
  if (!s) return 'hors de portée';
  const d = Math.abs(s.wind) >= 0.1 ? ` · ${s.wind > 0 ? '→' : '←'} ${fr(Math.abs(s.wind))}` : '';
  return (s.hold > 0.05 ? `tourelle ${fr(s.dial)} + contre-visée ${fr(s.hold)}` : `↑ ${fr(s.elev)}`) + d + ' mrad';
}

// ---------- encart des tourelles ----------
// Ruban gradué d'une tourelle, vu comme le tambour déroulé : il défile sous un repère fixe, la valeur réglée. Un cran =
// PAS pixels ; le ruban s'arrête aux butées. Il ne porte que le réglage : jamais de repère d'une valeur demandée.
const PAS = 6;
function ruban(val: number, min: number, max: number, vert: boolean): string {
  const L = vert ? 132 : 300, E = vert ? 54 : 42, m = L / 2, n = Math.floor(m / PAS), v10 = Math.round(val * 10);
  let fin = '', fort = '', txt = '';
  for (let i = Math.max(Math.round(min * 10), v10 - n); i <= Math.min(Math.round(max * 10), v10 + n); i++) {
    const p = (i - v10) * PAS, l = i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 4, d = vert ? `M42 ${m - p}h${-l}` : `M${m + p} 10v${l}`;
    if (i % 10 === 0) fort += d; else fin += d;
    if (i % 10 === 0) { const n1 = Math.abs(i / 10); txt += vert ? `<text x="26" y="${m - p + 3.5}" text-anchor="end">${n1}</text>` : `<text x="${m + p}" y="33" text-anchor="middle">${i ? (i > 0 ? 'D ' : 'G ') + n1 : '0'}</text>`; }
  }
  const repere = vert ? `<path class="r-trait" d="M28 ${m}h26"/><path class="r-idx" d="M8 ${m}l-8 -4.5v9z"/>` : `<path class="r-trait" d="M${m} 0v24"/><path class="r-idx" d="M${m} 34l-4.5 8h9z"/>`;
  return `<svg class="ruban ${vert ? 'vert' : 'horiz'}" width="${vert ? E : L}" height="${vert ? L : E}" viewBox="0 0 ${vert ? E : L} ${vert ? L : E}" aria-hidden="true"><path class="r-fin" d="${fin}"/><path class="r-fort" d="${fort}"/>${txt}${repere}</svg>`;
}
// La lunette vue de l'arrière, comme le tireur la voit : la tourelle du dessus et celle du côté droit, à leur vraie
// place. La tourelle dont parle le bloc est pleine ; dans l'oculaire, une double flèche donne l'axe qu'elle déplace.
const picto = (axe: 'elev' | 'deriv'): string => `<svg class="tr-picto" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="27" cy="39" r="18.5"/><circle class="p-fin" cx="27" cy="39" r="14"/><rect${axe === 'elev' ? ' class="p-or"' : ''} x="19.5" y="6.5" width="15" height="14"/><rect${axe === 'deriv' ? ' class="p-or"' : ''} x="45.5" y="31.5" width="14" height="15"/><path class="p-fl" d="${axe === 'elev' ? 'M27 30v18M23 34l4 -4l4 4M23 44l4 4l4 -4' : 'M18 39h18M22 35l-4 4l4 4M32 35l4 4l-4 4'}"/></svg>`;
const fleche = (v: number, pos: string, neg: string): string => (Math.abs(v) < 0.05 ? '' : (v > 0 ? pos : neg) + ' ');
/** Les deux lignes d'explication de chaque tourelle, pour les débutants : où elle est sur la lunette, ce qu'elle déplace. */
export const TURRET_HELP = {
  elev: ['Tourelle du dessus', 'Monte ou descend l’impact'],
  wind: ['Tourelle de droite', 'Décale l’impact à gauche ou à droite'],
} as const;
const AIDE_CRAN = `Un cran = ${fr(CLICK_MIL)}&nbsp;mrad, soit ${fr(CLICK_MIL * 10, 0)}&nbsp;cm à 100&nbsp;m`;

/**
 * L'encart, en HTML : pour chaque tourelle, où elle est sur la lunette, ce qu'elle déplace, ses deux touches, la valeur
 * réglée et son ruban ; puis la valeur d'un cran et les autres touches. Rien d'autre.
 */
export function turretsHtml(v: Pick<HudView, 'elev' | 'wind' | 'elevMax' | 'windMax' | 'pressed'>): string {
  const kbd = (code: string, txt: string): string => `<kbd${v.pressed === code ? ' class="appui"' : ''}>${txt}</kbd>`;
  const bloc = (axe: 'elev' | 'deriv', titre: string, lieu: string, effet: string, valeur: string, touches: [string, string][], bande: string): string =>
    `<div class="tr-bloc tr-${axe}"><div class="tr-tete">${picto(axe)}<div><span>${titre}</span><em>${lieu}</em><em>${effet}</em></div></div>`
    + `<div class="tr-regl"><div class="regle"><b>${valeur}</b><span>mrad</span></div><i>${touches.map((c) => kbd(c[0], c[1])).join('')}</i></div>${bande}</div>`;
  return bloc('elev', 'Élévation', TURRET_HELP.elev[0], TURRET_HELP.elev[1], fr(v.elev), [['ArrowUp', '↑'], ['ArrowDown', '↓']], ruban(v.elev, 0, v.elevMax, true))
    + bloc('deriv', 'Dérive', TURRET_HELP.wind[0], TURRET_HELP.wind[1], fleche(v.wind, '→', '←') + fr(Math.abs(v.wind)), [['ArrowLeft', '←'], ['ArrowRight', '→']], ruban(v.wind, -v.windMax, v.windMax, false))
    + `<div class="tr-aide"><p>${AIDE_CRAN}</p><p><kbd>Maj</kbd> + flèche : 1&nbsp;mrad d’un coup</p><p>${kbd('KeyG', 'G')} régler sur la cible visée</p><p>${kbd('KeyV', 'V')} diversion</p></div>`;
}

export interface OnlineHudOptions {
  /**
   * appareil tactile : pas d'encart des tourelles (les boutons de tourelles du jeu, src/ui/touch.ts, portent le réglage
   * et ses lignes d'explication) ; la liste du spectateur n'est offerte qu'en jeu (pas de souris à libérer par la pause)
   */
  touch?: boolean;
  /** le spectateur a choisi un emplacement dans la liste */
  onPlace?: (nom: string) => void;
}

export class OnlineHud {
  private readonly observer: HTMLElement;
  private readonly turrets: HTMLElement;
  private readonly life: HTMLElement;
  private readonly veil: HTMLElement;
  private readonly names: HTMLElement;
  private readonly places: HTMLSelectElement;
  /** spectateur, sur PC : rappel des flèches qui changent d'emplacement, sous la liste */
  private readonly spect: HTMLElement;
  private readonly last: Record<string, string> = {};
  private flashT = 0;
  private veilKind: 'down' | 'flash' | null = null;
  private spectator = false;

  constructor(root: HTMLElement, private readonly opt: OnlineHudOptions = {}) {
    const el = (id: string, tag = 'div'): HTMLElement => { const e = document.createElement(tag); e.id = id; e.style.display = 'none'; root.appendChild(e); return e; };
    this.names = el('ol-noms');
    this.observer = el('ol-vue');
    this.turrets = el('ol-tourelles');
    this.life = el('ol-vie');
    this.veil = el('ol-voile');
    this.spect = el('ol-spect');
    this.places = el('ol-postes', 'select') as HTMLSelectElement;
    this.places.setAttribute('aria-label', 'Emplacement du spectateur');
    this.places.onchange = () => { this.opt.onPlace?.(this.places.value); this.places.blur(); };
    // les touches tapées dans la liste ne doivent pas atteindre le jeu
    this.places.addEventListener('keydown', (ev) => ev.stopPropagation());
  }

  private html(key: string, e: HTMLElement, h: string): boolean {
    if (this.last[key] === h) return false;
    this.last[key] = h; e.innerHTML = h;
    return true;
  }
  private show(key: string, e: HTMLElement, on: boolean, display = ''): void {
    const d = on ? display : 'none';
    if (this.last[key + ':d'] !== d) { this.last[key + ':d'] = d; e.style.display = d; }
  }

  /** Spectateur : la liste de ses emplacements (`n. nom`), et celui qu'il occupe. Liste vide : plus de spectateur. */
  setPlaces(list: { n: number; nom: string }[], current = ''): void {
    this.spectator = list.length > 0;
    this.places.replaceChildren(...list.map((e) => { const o = document.createElement('option'); o.value = e.nom; o.textContent = `${e.n}. ${e.nom}`; return o; }));
    if (current) this.places.value = current;
  }

  /** Voile rouge : `down` reste jusqu'à `clearVeil` (abattu) ; `flash` s'efface seul (touché, encore debout). */
  hit(kind: 'down' | 'flash', html: string): void {
    this.veilKind = kind;
    this.veil.className = kind === 'flash' ? 'eclair' : '';
    this.veil.innerHTML = `<div>${html}</div>`;
    this.veil.style.display = 'grid';
    clearTimeout(this.flashT);
    if (kind === 'flash') this.flashT = window.setTimeout(() => { if (this.veilKind === 'flash') this.clearVeil(); }, 900);
  }
  clearVeil(): void {
    this.veilKind = null;
    this.veil.style.display = 'none';
  }
  get veiled(): 'down' | 'flash' | null {
    return this.veilKind;
  }

  update(v: HudView): void {
    const scope = v.shown && v.scope;
    // --- vue de l'observateur : lunette à l'œil seulement (à l'œil nu, rien ne trahit un tireur) ---
    const o = scope ? v.observer : null;
    this.html('vue', this.observer, o ? `<div class="v-lieu">${esc(o.place)}</div><div class="v-ligne"><b>${Math.round(o.range)}</b><span>m</span></div><div class="v-ligne v-corr"><span>Correction</span>${o.correction}</div>` : '');
    this.show('vue', this.observer, !!o);
    // --- vue du tireur : l'encart des tourelles ---
    const tur = scope && !this.opt.touch;
    this.show('tur', this.turrets, tur);
    if (tur) {
      const changed = this.html('tur', this.turrets, turretsHtml(v));
      const key = `${v.fieldLeft.toFixed(0)}:${v.w}:${v.h}:${o ? 1 : 0}`;
      if (changed || this.last.cale !== key) { this.last.cale = key; this.fitTurrets(v); }
    }
    // --- pseudos ---
    const names = v.shown ? v.labels : [];
    while (this.names.childElementCount < names.length) this.names.appendChild(document.createElement('div'));
    for (let i = 0; i < this.names.childElementCount; i++) {
      const d = this.names.children[i] as HTMLElement, l = names[i];
      if (!l) { if (d.style.display !== 'none') d.style.display = 'none'; continue; }
      if (d.textContent !== l.text) d.textContent = l.text;
      d.style.display = 'block';
      d.style.left = `${l.x.toFixed(1)}px`; d.style.top = `${l.y.toFixed(1)}px`;
    }
    this.show('noms', this.names, names.length > 0);
    // --- jauge de vie : deux points (corps : un point, tête : les deux) ---
    const life = v.shown && v.life !== null;
    this.show('vie', this.life, life, 'flex');
    if (life) this.html('vie', this.life, '<span>Vie</span>' + [1, 2].map((k) => `<i class="${(v.life as number) >= k ? 'on' : ''}"></i>`).join(''));
    // --- spectateur : liste des emplacements, à l'œil nu ---
    this.show('postes', this.places, this.spectator && (this.opt.touch ? v.shown : v.list) && !scope);
    // --- spectateur au clavier : sous la liste, le rappel des flèches qui changent d'emplacement ---
    const hint = this.spectator && !this.opt.touch && v.shown && v.list && !scope;
    this.show('spect', this.spect, hint);
    if (hint) this.html('spect', this.spect, '<kbd>←</kbd><kbd>→</kbd> changer d’emplacement');
  }

  /**
   * Petit écran : l'encart rétrécit pour tenir dans la bande noire à gauche de la lunette, et descend s'il le faut pour
   * ne jamais recouvrir le bloc de l'observateur, en haut à gauche.
   */
  private fitTurrets(v: HudView): void {
    const t = this.turrets, W0 = 336, H0 = t.offsetHeight || 420;
    const k = Math.max(0.68, Math.min(1, (v.fieldLeft - 22) / W0));
    const bas = this.observer.style.display === 'none' ? 0 : this.observer.getBoundingClientRect().bottom;
    const haut = Math.max((v.h - H0 * k) / 2, Math.max(bas, 190) + 14);
    t.style.transformOrigin = 'top right'; t.style.transform = `scale(${k.toFixed(3)})`; t.style.top = `${Math.round(haut)}px`;
    // bord droit contre la lunette, sans sortir de l'écran
    t.style.right = `${Math.round(Math.min(v.w - v.fieldLeft + 12, v.w - W0 * k - 6))}px`;
  }

  /** Tout masquer (salon, pause). */
  hide(): void {
    for (const [k, e] of [['vue', this.observer], ['tur', this.turrets], ['noms', this.names], ['vie', this.life], ['postes', this.places], ['spect', this.spect]] as [string, HTMLElement][]) this.show(k, e, false);
  }

  destroy(): void {
    clearTimeout(this.flashT);
    for (const e of [this.observer, this.turrets, this.life, this.veil, this.names, this.places, this.spect]) e.remove();
  }
}

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
