// Fond du menu : quelques vues des cartes, en fondu enchaîné lent. Affiché tant qu'aucune carte n'est chargée
// (le rendu 3D ne démarre qu'au clic sur « Commencer »). Images : public/assets/menu/, capturées dans le jeu.
import { assetUrl } from '../core/assets';

export const BACKDROP_IMAGES = ['assets/menu/fond-1.jpg', 'assets/menu/fond-2.jpg', 'assets/menu/fond-3.jpg'];
/** durée d'affichage d'une image, s */
const HOLD = 9;

export function showBackdrop(doc: Document = document): HTMLElement {
  const root = doc.createElement('div');
  root.id = 'backdrop';
  const layers = BACKDROP_IMAGES.map((src, i) => {
    const d = doc.createElement('div');
    d.className = 'bd' + (i === 0 ? ' on' : '');
    // la première tout de suite ; les suivantes une fois le menu affiché
    if (i === 0) d.style.backgroundImage = `url("${assetUrl(src)}")`;
    root.appendChild(d);
    return d;
  });
  const ui = doc.getElementById('ui');
  doc.body.insertBefore(root, ui);
  let cur = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    const next = (cur + 1) % layers.length;
    if (!layers[next].style.backgroundImage) layers[next].style.backgroundImage = `url("${assetUrl(BACKDROP_IMAGES[next])}")`;
    layers[cur].classList.remove('on');
    layers[next].classList.add('on');
    cur = next;
  }, HOLD * 1000);
  return root;
}
