// Tableau de la manche, en jeu : temps restant, tireurs classés par points, vent, dernière annonce. Porté de
// src/ville/reseau.js. Sur ordinateur il est déplié et ne se touche pas ; au doigt il est replié (une ligne pour le
// temps et ses propres points, une pour le vent) et un toucher le déplie. Module autonome : son élément, sa feuille de
// style ; il lit l'état dans la session (src/online/session.ts).
import './online.css';
import { esc, fr, mmss, nom, ROSE, texteVent, type Joueur, type Session } from './session';

export interface ScoreboardOptions {
  /** appareil tactile : tableau repliable */
  touch?: boolean;
  /** adresse du lien « ← Menu du jeu » du tableau déplié (tactile) */
  menuHref?: string;
}

export class Scoreboard {
  readonly el: HTMLElement;
  /** tactile : tableau déplié */
  open = false;
  private last = '';
  private readonly timer: number;
  private readonly off: () => void;

  constructor(root: HTMLElement, private readonly session: Session, private readonly opt: ScoreboardOptions = {}) {
    const box = (this.el = document.createElement('div')); box.id = 'ol-manche'; box.style.display = 'none';
    if (opt.touch) {
      box.classList.add('scroll');                                 // déplié, il défile au doigt (src/core/device.ts)
      box.addEventListener('pointerdown', (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('.ol-resume')) return;
        this.open = !this.open; this.update();
      });
    }
    root.appendChild(box);
    this.off = session.on('change', () => this.update());
    this.timer = window.setInterval(() => this.update(), 500);
    this.update();
  }

  /** Redessine le tableau. Il n'est à l'écran que dans la salle, hors du salon. */
  update(): void {
    const s = this.session, box = this.el;
    const vu = !!s.role && !s.inLobby;
    box.style.display = vu ? '' : 'none';
    if (!vu) return;
    const l = s.ranking();
    const h = this.opt.touch ? this.touchHtml(l) : this.desktopHtml(l);
    if (h !== this.last) { this.last = h; box.innerHTML = h; }
  }

  private rows(l: Joueur[]): string {
    const moi = this.session.me;
    // les humains en texte plein, les robots en retrait (ils restent au tableau : ce sont des adversaires sur la carte)
    return l.map((j) => `<div class="${j.robot ? 'bot' : 'hum'}${j.id === moi ? ' moi' : ''}${j.vivant ? '' : ' hs'}"><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></div>`).join('');
  }

  /** Les trois derniers tireurs abattus, sous la liste : le plus récent en haut, les siens en or. */
  private kills(): string {
    const k = this.session.kills;
    return k.length ? `<ul class="ol-abattus">${k.map((x) => `<li class="${x.moi ? 'moi' : ''}">${esc(x.texte)}</li>`).join('')}</ul>` : '';
  }

  private desktopHtml(l: Joueur[]): string {
    const s = this.session, vent = esc(texteVent(s.settings.vent));
    return `<b>${s.phase === 'jeu' ? 'Manche' : 'Salon'}</b> · ${mmss(s.remaining())}${s.role === 'spectateur' ? ' · spectateur' : ''}`
      + this.rows(l) + this.kills() + `<small>${vent[0].toUpperCase() + vent.slice(1)}.<br>${esc(s.announce)}</small>`;
  }

  // Au doigt, le tableau est replié : une ligne pour le temps restant et ses propres points, une pour le vent. Un toucher
  // le déplie (classement complet, dernière annonce, retour au menu), un autre le replie.
  private touchHtml(l: Joueur[]): string {
    const s = this.session, v = s.settings.vent, m = s.self;
    const vent = v ? `Vent ${String(v.vitesse).replace('.', ',')} m/s · ${ROSE[Math.round(v.de / 45) % 8]}` : 'Sans vent';
    const tete = `<button class="ol-resume" aria-expanded="${this.open}"><span><b>${s.phase === 'jeu' ? 'Manche' : 'Salon'}</b> · ${mmss(s.remaining())}</span><u>${m ? fr(m.points) + ' pts' : s.role === 'spectateur' ? 'spectateur' : ''}</u><i>${this.open ? '▴' : '▾'}</i><em>${vent}</em></button>`;
    if (!this.open) return tete;
    return tete + `<div class="ol-corps">` + this.rows(l)
      + this.kills() + `<small>${esc(s.announce)}</small><a class="ol-menu" href="${esc(this.opt.menuHref ?? './index.html')}">← Menu du jeu</a></div>`;
  }

  destroy(): void {
    clearInterval(this.timer);
    this.off();
    this.el.remove();
  }
}
