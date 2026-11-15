// Compliment au tireur après un tir d'adresse (plein centre, cible en mouvement) : un bandeau doré, bref, au centre
// de l'écran. Module autonome (son propre élément, sa propre feuille de style) ; les règles sont dans src/game/skill.ts.
import './praise.css';

export class Praise {
  private el: HTMLElement;
  private timer = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'praise';
    this.el.setAttribute('aria-live', 'polite');
    root.appendChild(this.el);
  }

  show(title: string, detail: string, seconds = 2.8): void {
    this.el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('small');
    s.textContent = detail;
    this.el.append(b, s);
    // relance l'animation même si un compliment est déjà affiché
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('on'), seconds * 1000);
  }
}
