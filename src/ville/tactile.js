// Ville nouvelle, commandes tactiles (téléphone, tablette). Rien de tout ceci ne s'installe sur ordinateur.
// Mêmes conventions que le jeu solo (src/ui/touch.ts, src/core/device.ts) : chaque doigt est suivi par son
// `pointerId`, un doigt glissé sur l'image regarde (jamais il ne tire), les boutons agissent dès l'appui, un appui
// maintenu répète les crans, un geste interrompu relâche tout. Le tir n'existe que sur son bouton.
//
// Téléphone : le multijoueur se joue à la verticale, comme le jeu solo. Tourné à l'horizontale, il affiche le même
// écran « Tournez votre appareil » que le jeu solo (src/game/game.ts, src/ui/hud.ts) et ne reçoit plus aucun geste.
// Tablette (petit côté d'au moins 700 px), comme en solo : les deux tenues sont jouables.
//
// Disposition en portrait : l'observateur (#viseur) et le tableau replié en haut ; la lunette juste dessous ; en bas à
// gauche l'encart des tourelles sous le pouce gauche ; en bas à droite, comme en solo, « Tirer » dans l'angle et
// « Œil nu » à sa gauche, le grossissement au-dessus, et le dernier résultat au-dessus encore.
// Le centre et le rayon de la lunette sont calculés ici (state.lunette) pour que rien ne la recouvre.
import { safeInsets, isTablet } from '../core/device';

const REPET_DELAI = 380, REPET_PAS = 85;      // comme le jeu solo : premier cran à l'appui, puis 12 crans par seconde
const GAIN_OEIL = 1.35;                       // œil nu : l'image tourne un peu plus vite que le doigt
const MAG_MIN = 4, MAG_MAX = 25;              // bornes de la molette sur ordinateur
// encart des tourelles : hauteur normale et hauteur resserrée (petits écrans), largeur en paysage
const ENC_H = 270, ENC_H_SERRE = 248, ENC_L = 200;      // = --enc et largeur de #tourelles dans ville.html

const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// pictogrammes du jeu solo
const ICONE = {
  tirer: S('<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6"/><circle cx="12" cy="12" r="0.9" class="f"/>'),
  epauler: S('<circle cx="9.5" cy="12" r="6"/><path d="M15.5 9.5h6v5h-6M2 12h3.5M9.5 6v2.5M9.5 15.5V18"/>'),
};

/**
 * Sensibilité du doigt en lunette, en déplacement d'image par déplacement du doigt. La valeur de base suit le
 * grossissement : on balaie un peu plus large au plus faible grossissement (chercher la cible), l'image suit
 * exactement le doigt à fort grossissement (pointer). Un geste vif va plus loin, un geste lent reste fin.
 */
export function gainLunette(mag, vitesse) {
  const u = Math.min(1, Math.max(0, Math.log(Math.max(mag, 1) / MAG_MIN) / Math.log(16 / MAG_MIN)));
  const vif = Math.min(1, Math.max(0, (vitesse - 0.25) / 0.95));     // px par ms
  return (1.5 - 0.6 * u) * (1 + 0.8 * vif);
}

export function installTactile({ view, state, tir, camera, reseau, redessine }) {
  const racine = document.documentElement;
  const zone = document.createElement('div'); zone.id = 'touch';
  zone.innerHTML = `
    <div class="tg-zoom"><button class="tb" data-tb="zmoins" aria-label="Élargir le champ"><b>−</b></button><output data-o="zoom">8×</output><button class="tb" data-tb="zplus" aria-label="Grossir"><b>+</b></button></div>
    <button class="tb tb-epauler" data-tb="epauler" aria-label="Épauler">${ICONE.epauler}<span data-o="epauler">Épauler</span></button>
    <button class="tb tb-tirer" data-tb="tirer" aria-label="Tirer">${ICONE.tirer}<span>Tirer</span></button>`;
  document.body.appendChild(zone);
  const sortie = Object.fromEntries([...zone.querySelectorAll('[data-o]')].map((e) => [e.dataset.o, e]));
  const bTirer = zone.querySelector('[data-tb="tirer"]');
  const tourelles = document.getElementById('tourelles');

  const vibre = (ms) => { try { navigator.vibrate?.(ms); } catch { /* pas de vibreur (iOS) */ } };
  const grossir = (k) => { state.mag = Math.max(MAG_MIN, Math.min(MAG_MAX, state.mag * k)); };

  // ---------- garde-fous contre les gestes du navigateur (mêmes protections que le jeu solo) ----------
  const opt = { passive: false, capture: true };
  const surJeu = (t) => t instanceof Element && !!t.closest('#view, #touch, #tourelles, .m-resume, #couche');
  const defile = (t) => (t instanceof Element ? t.closest('#salon, #manche') : null);
  const texte = (t) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement;
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault(), opt);   // pincement de Safari
  // sur la surface de jeu, le toucher est consommé : ni loupe, ni menu d'appui long, ni clic de compatibilité (c'est
  // lui qui tirait à la souris), ni zoom au double toucher ; un second doigt ne zoome jamais la page
  document.addEventListener('touchstart', (e) => { if ((e.touches.length > 1 || surJeu(e.target)) && e.cancelable && !texte(e.target)) e.preventDefault(); }, opt);
  document.addEventListener('touchmove', (e) => {
    if (!e.cancelable) return;
    const s = e.touches.length === 1 ? defile(e.target) : null;
    if (!s || s.scrollHeight <= s.clientHeight + 1) e.preventDefault();       // seuls le salon et le tableau déplié défilent
  }, opt);
  document.addEventListener('dblclick', (e) => e.preventDefault(), opt);
  // appui long : sur ordinateur le menu contextuel épaule (clic droit) ; au doigt il ne doit rien faire
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, opt);
  document.addEventListener('selectstart', (e) => { if (!texte(e.target)) e.preventDefault(); }, opt);
  document.addEventListener('dragstart', (e) => e.preventDefault(), opt);

  // ---------- doigts ----------
  const tenus = new Map();        // pointerId → { el, minuterie } : boutons enfoncés
  const regards = new Map();      // pointerId → { x, y, t } : doigts posés sur l'image
  let pince = 0;
  /** Action d'un bouton ; renvoie vrai si un appui maintenu la répète. */
  const agit = (el) => {
    const t = el.dataset.t, b = el.dataset.tb;
    if (t === 'KeyG') { tir.reglerSurCible(); return false; }
    if (t) { tir.cran(t, el.dataset.g === '1'); return true; }
    if (b === 'zplus') { grossir(1.09); return true; }
    if (b === 'zmoins') { grossir(1 / 1.09); return true; }
    if (b === 'tirer') tir.tirer();
    else if (b === 'epauler') { if (!state.couche) state.scope = !state.scope; }
    else if (b === 'manche') { state.mancheOuverte = !state.mancheOuverte; reseau?.tableau(); }
    return false;
  };
  const lache = (id) => {
    const h = tenus.get(id);
    if (h) { tenus.delete(id); clearTimeout(h.minuterie); clearInterval(h.minuterie); h.el.classList.remove('down'); }
    if (regards.delete(id)) pince = 0;
  };
  const lacheTout = () => { for (const id of [...tenus.keys(), ...regards.keys()]) lache(id); };

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || state.salon || bloque) return;
    const cible = e.target instanceof Element ? e.target : null; if (!cible) return;
    const el = cible.closest('[data-tb], #tourelles [data-t]');
    if (el) {
      for (const h of tenus.values()) if (h.el === el) return;        // un même bouton n'est tenu que par un doigt
      const h = { el, minuterie: 0 }; tenus.set(e.pointerId, h);
      if (el.dataset.tb !== 'manche') el.classList.add('down');       // (le tableau est redessiné : pas d'état enfoncé)
      vibre(el.dataset.tb === 'tirer' ? 22 : 8);
      if (agit(el)) h.minuterie = setTimeout(() => { h.minuterie = setInterval(() => { agit(el); vibre(4); }, REPET_PAS); }, REPET_DELAI);
      return;
    }
    // un doigt sur l'image : il regarde. Poser, lever, toucher brièvement : aucun tir, jamais.
    if (cible === view) { regards.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp }); pince = 0; }
  });
  window.addEventListener('pointermove', (e) => {
    const h = tenus.get(e.pointerId);
    if (h) {                                                           // le doigt a quitté le bouton : on relâche, rien ne reste « collé »
      const r = h.el.getBoundingClientRect(), m = 18;
      if (e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m) lache(e.pointerId);
      return;
    }
    const l = regards.get(e.pointerId); if (!l) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y, dt = Math.max(1, e.timeStamp - l.t);
    l.x = e.clientX; l.y = e.clientY; l.t = e.timeStamp;
    if (regards.size === 2) {                                          // pincement à deux doigts : grossissement (lunette à l'œil)
      const [a, b] = [...regards.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (state.scope && pince > 20 && d > 20) grossir(Math.min(1.25, Math.max(0.8, d / pince)));
      pince = d; return;
    }
    if (state.couche || state.fly) return;
    // angle par pixel : celui de l'image affichée, donc d'autant plus fin que le grossissement est fort
    const parPx = Math.tan((camera.fov * Math.PI) / 360) / (window.innerHeight / 2);
    const k = parPx * (state.scope ? gainLunette(state.mag, Math.hypot(dx, dy) / dt) : GAIN_OEIL);
    // comme dans le jeu solo : glisser à droite regarde à droite, glisser vers le bas regarde vers le bas
    state.yaw -= dx * k; state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch - dy * k));
  });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, (e) => lache(e.pointerId));
  // appel entrant, centre de contrôle, changement d'application : rien ne doit rester enfoncé
  window.addEventListener('blur', lacheTout); window.addEventListener('pagehide', lacheTout);
  document.addEventListener('visibilitychange', () => { if (document.hidden) lacheTout(); });

  // ---------- géométrie : tenue de l'appareil, et où tient la lunette une fois réservée la place des commandes ----------
  const tourne = document.createElement('div'); tourne.id = 'rotate';      // l'écran de rotation du jeu solo, mot pour mot
  tourne.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="14" y="62" width="66" height="36" rx="5"/><path d="M22 76v8"/><rect x="62" y="22" width="36" height="66" rx="5" class="g"/><path d="M76 80h8" class="g"/><path d="M22 50a30 30 0 0 1 28-28M50 22l-8-3M50 22l-5 7"/></svg><h2>Tournez votre appareil</h2><p>Pigeon perché se joue à la verticale.</p>';
  document.body.appendChild(tourne);
  let bloque = false;
  const cale = () => {
    // saisie du pseudo : le clavier virtuel réduit la hauteur utile ; comme en solo, on ne change ni de mise en page
    // ni d'écran tant qu'il est ouvert
    if (document.activeElement instanceof HTMLInputElement) return;
    const w = window.innerWidth, h = window.innerHeight, m = safeInsets(), portrait = h >= w;
    const aTourner = !portrait && !isTablet(w, h);                    // téléphone tenu à l'horizontale
    const bas = Math.max(m.bottom, 10);
    let R, cx = w / 2, cy = h / 2, serre = false;
    if (portrait) {
      // en haut : l'observateur (jusqu'à deux lignes de nom, la distance, deux lignes de correction) et le tableau replié ;
      // en bas : l'encart des tourelles et ses marges
      // (spectateur : la liste des emplacements prend une rangée en plus)
      const haut = m.top + 110 + (state.spectateur ? 52 : 0), reste = (enc) => (h - haut - (8 + enc + 12 + bas)) / 2;
      serre = reste(ENC_H) < Math.min(0.4 * w, 160);                                  // écran court : l'encart se resserre pour laisser la lunette respirer
      R = Math.max(90, Math.min(0.46 * w, reste(serre ? ENC_H_SERRE : ENC_H)));
      cy = haut + R;
    } else R = Math.max(90, Math.min(0.47 * h, w / 2 - Math.max(m.left, m.right) - ENC_L - 12));    // tablette à l'horizontale : une bande de chaque côté
    state.lunette = { cx, cy, R };
    racine.classList.toggle('portrait', portrait); racine.classList.toggle('serre', serre); racine.classList.toggle('turn', aTourner);
    const st = racine.style; st.setProperty('--lx', `${cx}px`); st.setProperty('--ly', `${cy}px`); st.setProperty('--lr', `${R}px`);
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);      // les barres de Safari peuvent laisser la page décalée
    // téléphone tourné : plus rien n'est tenu, la lunette est quittée (une manche en ligne ne se met pas en pause)
    if (aTourner && !bloque) { lacheTout(); state.scope = false; }
    bloque = aTourner;
  };
  cale();
  const recale = () => { cale(); redessine?.(); };
  window.addEventListener('resize', recale);
  window.addEventListener('orientationchange', () => setTimeout(recale, 250));

  // ---------- salon : saisie du pseudo sans que le clavier virtuel masque le champ ni le bouton ----------
  const salon = document.getElementById('salon'), pseudo = salon?.querySelector('[data-s="pseudo"]');
  if (pseudo) {
    for (const [k, v] of [['enterkeyhint', 'go'], ['autocapitalize', 'words'], ['autocorrect', 'off']]) pseudo.setAttribute(k, v);
    let fin = 0;
    // pendant la saisie, le salon ne garde que le cadre d'entrée, remonté en haut de l'écran
    pseudo.addEventListener('focus', () => { clearTimeout(fin); salon.classList.add('saisie'); salon.scrollTop = 0; });
    // on attend la fin du toucher en cours avant de tout remettre en place : le bouton visé ne doit pas se dérober
    pseudo.addEventListener('blur', () => { fin = setTimeout(() => { salon.classList.remove('saisie'); recale(); }, 350); });
    pseudo.addEventListener('keydown', (e) => { if (e.key === 'Enter') pseudo.blur(); });
  }

  // ---------- à chaque image ----------
  const vu = {};
  const pose = (k, v, f) => { if (vu[k] !== v) { vu[k] = v; f(v); } };
  const update = (now) => {
    const jeu = !state.salon && !state.fly;
    pose('cls', (jeu ? 'on' : '') + (state.scope ? ' scope' : '') + (state.spectateur ? ' spect' : '') + (state.couche ? ' couche' : ''), (v) => { zone.className = v; if (!jeu) lacheTout(); });
    pose('pose', !!state.scope && jeu, (v) => racine.classList.toggle('scope-pose', v));
    pose('spect', !!state.spectateur, () => cale());
    pose('touche', !!state.couche, (v) => racine.classList.toggle('touche', v));
    pose('manche', !!(reseau && reseau.role()), (v) => racine.classList.toggle('en-manche', v));
    if (!jeu) return;
    pose('lib', state.scope ? 'Œil nu' : 'Épauler', (v) => { sortie.epauler.textContent = v; });
    if (state.scope) {
      pose('zoom', state.mag.toFixed(state.mag < 10 ? 1 : 0).replace('.', ',') + '×', (v) => { sortie.zoom.textContent = v; });
      pose('culasse', now < tir.etat.pret, (v) => bTirer.classList.toggle('attente', v));      // culasse en cours : le bouton s'efface un instant
    }
  };
  return { update, cale, gainLunette, enfonces: () => [...tenus.values()].map((h) => h.el.dataset.tb || h.el.dataset.t), regards };
}
