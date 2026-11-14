// Appareil tactile : détection, garde-fous contre les gestes du système (zoom, défilement, sélection, menu
// contextuel), orientation portrait, plein écran, encoches. Rien de tout cela ne s'installe sur ordinateur.

/** Appareil à écran tactile comme pointeur principal ; `?touch=1` et `?touch=0` forcent la réponse (tests). */
export function isTouchDevice(params: URLSearchParams): boolean {
  const f = params.get('touch');
  if (f === '1') return true;
  if (f === '0') return false;
  const mm = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  const points = navigator.maxTouchPoints || 0;
  // pointeur principal grossier (téléphone, tablette), ou écran tactile sans aucun pointeur fin (pas de souris)
  return points > 0 && (mm('(pointer: coarse)') || !mm('(any-pointer: fine)'));
}

/** Zone où le navigateur doit garder son comportement tactile : défilement interne des écrans, curseurs. */
const scroller = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>('.scroll') : null);
const isRange = (t: EventTarget | null): boolean => t instanceof HTMLInputElement && t.type === 'range';
/** champ de saisie (nom du classement) : le toucher, le curseur et la sélection y restent ceux du système */
const isText = (t: EventTarget | null): boolean => t instanceof HTMLInputElement && t.type === 'text';
const onGame = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('#view, #touch, #rotate');

/**
 * Neutralise les gestes du navigateur mobile. Renvoie la liste des protections posées (lue par les tests).
 * Safari iOS ignore `user-scalable=no` depuis iOS 10 : le zoom par pincement et par double tap est donc
 * annulé ici, par code, en plus de la balise viewport et de `touch-action`.
 */
export function installGestureGuards(): string[] {
  const done: string[] = [];
  const opt: AddEventListenerOptions = { passive: false, capture: true };
  const on = (name: string, target: EventTarget, type: string, fn: (e: any) => void): void => {
    target.addEventListener(type, fn, opt);
    if (!done.includes(name)) done.push(name);
  };
  // pincement de Safari (événements propriétaires) : zoom de la page et rotation
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) on(t, document, t, (e) => e.preventDefault());

  // un second doigt ne doit jamais lancer un zoom de page ; sur la surface de jeu, le premier toucher est
  // consommé aussi : pas de loupe, pas de menu d'appui long, pas de clic de compatibilité, pas de double tap
  on('touchstart', document, 'touchstart', (e: TouchEvent) => {
    if (e.touches.length > 1 || onGame(e.target)) { if (e.cancelable) e.preventDefault(); }
  });
  // défilement de la page, effet élastique, tirer-pour-actualiser : tout mouvement est annulé, sauf dans un
  // écran à défilement interne (un seul doigt, et seulement s'il y a réellement de quoi défiler) et sur un curseur
  on('touchmove', document, 'touchmove', (e: TouchEvent) => {
    if (!e.cancelable) return;
    if (e.touches.length > 1) { e.preventDefault(); return; }
    if (isRange(e.target)) return;
    const s = scroller(e.target);
    if (!s || s.scrollHeight <= s.clientHeight + 1) e.preventDefault();
  });
  // double tap : le second toucher rapproché est annulé (pas de zoom) et son clic est rejoué à la main pour que
  // deux appuis rapides sur un même bouton (clics de tourelle du carnet) comptent tous les deux
  let lastT = 0, lastX = 0, lastY = 0;
  on('touchend', document, 'touchend', (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (!t) return;
    const now = e.timeStamp;
    const quick = now - lastT < 350 && Math.hypot(t.clientX - lastX, t.clientY - lastY) < 40;
    lastT = now; lastX = t.clientX; lastY = t.clientY;
    if (!quick || !e.cancelable || onGame(e.target) || isRange(e.target) || isText(e.target)) return;
    e.preventDefault();
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('button, [data-act], [data-w], [data-tur], [data-k]') : null;
    el?.click();
  });
  on('dblclick', document, 'dblclick', (e) => e.preventDefault());
  // appui long : menu contextuel (Android), sélection de texte et loupe, glisser d'image
  on('contextmenu', document, 'contextmenu', (e) => e.preventDefault());
  on('selectstart', document, 'selectstart', (e) => { if (!isText(e.target)) e.preventDefault(); });
  on('dragstart', document, 'dragstart', (e) => e.preventDefault());
  return done;
}

interface FsDoc extends Document { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }
interface FsEl extends HTMLElement { webkitRequestFullscreen?: () => Promise<void> | void }

/** Le plein écran existe-t-il pour une page web ? (Android : oui ; iPhone : non ; iPad : oui) */
export function canFullscreen(): boolean {
  const el = document.documentElement as FsEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}
export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}
/** Petit côté de l'écran à partir duquel l'appareil est traité comme une tablette (les deux orientations sont jouables). */
export const TABLET_MIN_SIDE = 700;
/** Téléphone : le jeu ne se joue qu'en portrait. Tablette : portrait ou paysage. */
export function isTablet(w: number, h: number): boolean {
  return Math.min(w, h) >= TABLET_MIN_SIDE;
}

/** Verrouille l'orientation en portrait là où l'API existe (Android en plein écran, application installée). */
export async function lockPortrait(): Promise<boolean> {
  try {
    const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (!o?.lock) return false;
    await o.lock('portrait');
    return true;
  } catch { return false; /* le verrouillage exige souvent le plein écran et n'existe pas sur iOS */ }
}

/**
 * Plein écran, puis verrouillage en portrait sur téléphone (`portraitOnly`) ; à appeler dans un geste de
 * l'utilisateur. Sans effet là où l'API manque. Aucun verrouillage en paysage n'est jamais demandé.
 */
export async function goFullscreen(portraitOnly: boolean): Promise<void> {
  const el = document.documentElement as FsEl;
  try {
    if (!isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    }
  } catch { /* refusé ou indisponible */ }
  if (portraitOnly) await lockPortrait();
}

/** Dimensions utiles : `visualViewport` suit les barres du navigateur mobile mieux que innerHeight. */
export function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  // l'échelle reste à 1 (zoom neutralisé) : la taille visuelle est la taille utile
  if (vv && vv.scale === 1) return { w: Math.round(vv.width), h: Math.round(vv.height) };
  return { w: window.innerWidth, h: window.innerHeight };
}

/** Marges sûres (encoche ou île en haut, barre d'accueil en bas…), lues sur les variables CSS `--sat` etc. */
export function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  let probe = document.getElementById('hr-safe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'hr-safe';
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--sat) var(--sar) var(--sab) var(--sal)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string): number => parseFloat(v) || 0;
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

/**
 * iPhone ou iPad dans Safari, hors écran d'accueil : aucune page web n'y obtient le plein écran, mais ajoutée à
 * l'écran d'accueil elle s'ouvre sans les barres du navigateur. Le jeu se joue très bien sans (portrait) : l'astuce
 * n'est qu'une ligne discrète au bas du menu.
 */
export function needsHomeScreenTip(params: URLSearchParams): boolean {
  const f = params.get('a2hs');
  if (f === '1') return true;
  if (f === '0') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as any).standalone === true || (typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches));
  return ios && !standalone;
}
