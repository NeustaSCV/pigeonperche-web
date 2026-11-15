// Bouton « Conseil » : il apparaît quand le joueur a fermé le conseil affiché après plusieurs tirs manqués, pour le
// rouvrir à volonté (au doigt sur téléphone, à la souris ou par la touche Entrée sur ordinateur). Module autonome.
import './coach-button.css';

export class CoachButton {
  private el: HTMLButtonElement;
  private shown = false;

  constructor(root: HTMLElement, touch: boolean, onOpen: () => void) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'coach-again hidden';
    this.el.setAttribute('aria-label', 'Revoir le conseil');
    this.el.innerHTML = touch ? '<span>Conseil</span>' : '<span>Conseil</span><i><b>Entrée</b></i>';
    this.el.addEventListener('click', (e) => { e.stopPropagation(); onOpen(); });
    // au doigt : ne pas laisser le toucher viser ou tirer à travers le bouton
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(this.el);
  }

  get visible(): boolean {
    return this.shown;
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.el.classList.toggle('hidden', !on);
  }
}
