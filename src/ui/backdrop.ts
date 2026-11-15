// Fond du menu : des vues rapprochées des cibles, en fondu enchaîné, qui dérivent lentement ; au premier plan,
// l'anneau d'une lunette et son réticule flottent à contretemps (parallaxe). Affiché tant qu'aucune carte n'est
// chargée : le rendu 3D ne démarre qu'au clic sur « Commencer ».
// Pour ajouter une image, il suffit de déposer un fichier .jpg dans public/assets/menu/ : la liste est relevée à la
// construction (vite.config.ts), dans l'ordre des noms de fichier.
import './backdrop.css';
import { assetUrl } from '../core/assets';

declare const __MENU_IMAGES__: string[] | undefined;
export const BACKDROP_IMAGES: string[] = typeof __MENU_IMAGES__ !== 'undefined' && Array.isArray(__MENU_IMAGES__) ? __MENU_IMAGES__ : [];

/** durée d'affichage d'une image, s (le fondu de 2,4 s est dans backdrop.css) */
export const HOLD = 9;

/**
 * Dérive lente et continue, sans reprise visible : somme de deux sinus de périodes sans rapport simple.
 * `t` en millisecondes ; renvoie [x, y] dans l'unité des amplitudes `ax`, `ay` (bornés à 1,35 fois l'amplitude).
 */
export function drift(t: number, ax: number, ay: number, speed = 1): [number, number] {
  return [
    Math.sin(t * 0.00023 * speed) * ax + Math.sin(t * 0.00061 * speed + 1.3) * ax * 0.35,
    Math.cos(t * 0.00019 * speed + 0.7) * ay + Math.sin(t * 0.00053 * speed) * ay * 0.3,
  ];
}

/** Réticule simplifié : croix et graduations tous les 5 % du diamètre. */
function reticle(doc: Document): HTMLElement {
  const r = doc.createElement('div');
  r.className = 'ret';
  let html = '<i class="h"></i><i class="v"></i>';
  for (const k of [-4, -3, -2, -1, 1, 2, 3, 4]) html += `<i class="t" style="left:${50 + k * 5}%"></i><i class="u" style="top:${50 + k * 5}%"></i>`;
  r.innerHTML = html;
  return r;
}

export function showBackdrop(doc: Document = document): HTMLElement {
  const root = doc.createElement('div');
  root.id = 'backdrop';
  doc.body.insertBefore(root, doc.getElementById('ui'));
  const n = BACKDROP_IMAGES.length;
  if (!n) return root;
  // deux calques suffisent : celui qui s'affiche et celui qui s'efface
  const layers = [0, 1].map(() => { const d = doc.createElement('div'); d.className = 'bd'; root.appendChild(d); return d; });
  const scope = doc.createElement('div');
  scope.className = 'scope';
  scope.innerHTML = '<div class="ring"></div>';
  scope.appendChild(reticle(doc));
  root.appendChild(scope);

  let cur = Math.floor(Math.random() * n), top = 0;
  const show = (img: number): void => {
    layers[top].style.backgroundImage = `url("${assetUrl(BACKDROP_IMAGES[img])}")`;
    layers[top].classList.add('on');
  };
  show(cur);
  if (n > 1) {
    const timer = setInterval(() => {
      if (!root.isConnected) { clearInterval(timer); return; }
      cur = (cur + 1) % n;
      layers[top].classList.remove('on');
      top = 1 - top;
      show(cur);
    }, HOLD * 1000);
  }

  // parallaxe : le fond dérive de quelques pour cent, la lunette de quelques dizaines de pixels, en sens contraire
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const place = (t: number): void => {
    const [bx, by] = drift(t, 2.6, 1.6);
    const bg = `scale(1.08) translate3d(${bx.toFixed(3)}%, ${by.toFixed(3)}%, 0)`;
    layers[0].style.transform = bg;
    layers[1].style.transform = bg;
    const [sx, sy] = drift(t + 9000, 26, 16, 1.7);
    scope.style.transform = `translate3d(${(-sx).toFixed(2)}px, ${(-sy).toFixed(2)}px, 0) rotate(${(Math.sin(t * 0.0004) * 0.6).toFixed(3)}deg)`;
  };
  place(0);
  if (!still && typeof requestAnimationFrame === 'function') {
    const loop = (t: number): void => {
      if (!root.isConnected) return;
      place(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return root;
}
