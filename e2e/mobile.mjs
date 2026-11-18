// Version mobile, en PORTRAIT : contexte Playwright tactile (hasTouch, isMobile). iPhone 375 × 664 (zone utile réelle
// dans Safari avec ses barres), 390 × 844 et 430 × 932 (écran d'accueil, île et barre d'accueil simulées), Android
// 412 × 780, tablette dans les deux sens, et un passage du téléphone à l'horizontale (écran de rotation, pause).
// Les gestes sont de vrais événements tactiles (CDP Input.dispatchTouchEvent), multi-doigts compris.
// Une ligne par contrôle, code de sortie 1 au moindre échec. Captures dans e2e/out/mobile-*.png.
// Usage : node e2e/mobile.mjs [--level <id>]   (serveur de développement lancé, ou HR_URL)
// Les positions du scénario (poste, râtelier, cible lointaine…) viennent du niveau : data.testTouch et data.tutorial.
import { mkdirSync } from 'node:fs';
import { BASE, NONE, NOTCH, assertScenario, center, gameUrl, launch, layoutReport, mobilePage, screenReport, setNotch, tapSel, tapText, tb, visibleButtons } from './touchlib.mjs';

mkdirSync('e2e/out', { recursive: true });
const browser = await launch();
let fails = 0, total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `e2e/out/mobile-${name}.png` });
const G = (page, f, arg) => page.evaluate(f, arg);
const geometry = async (page, label, notch) => {
  const r = await layoutReport(page, notch);
  check(`${label} : rien ne se chevauche (${r.count} éléments)`, r.overlaps.length === 0, r.overlaps.join(' ; '));
  check(`${label} : rien sous l'île, la barre d'accueil ni hors de l'écran`, r.unsafe.length === 0, r.unsafe.join(' ; '));
  check(`${label} : boutons ≥ 44 px`, r.small.length === 0, r.small.join(' ; '));
  // aucun bouton collé au bord inférieur : les gestes de bord d'iOS et la barre de Safari y sont prioritaires
  const low = await G(page, () => { const H = window.innerHeight; return [...document.querySelectorAll('#touch [data-tb]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).display !== 'none' && H - b.bottom < 18; }).map((e) => `${e.dataset.tb} à ${Math.round(H - e.getBoundingClientRect().bottom)} px`); });
  check(`${label} : aucun bouton à moins de 18 px du bord inférieur`, low.length === 0, low.join(' ; '));
  if (r.field) {
    check(`${label} : rien ne recouvre le champ circulaire de la lunette`, r.inField.length === 0, r.inField.join(' ; '));
    const H = await G(page, () => window.innerHeight);
    check(`${label} : champ dans la moitié haute, tenu dans la largeur`, r.field.cy < H / 2 && r.field.ratio <= 0.96 && r.field.ratio >= 0.84 && r.field.top >= notch.top, `diamètre ${(r.field.ratio * 100).toFixed(1)} % de la largeur, centre à ${Math.round(r.field.cy)} px sur ${H}`);
  }
  return r;
};
const screenOk = async (page, label, notch) => {
  const r = await screenReport(page, notch);
  check(`${label} : carte dans la zone sûre`, !!r && r.inSafe, r ? JSON.stringify(r.card) : 'aucun écran');
  check(`${label} : cibles tactiles ≥ 44 px, toutes atteignables`, !!r && r.small.length === 0 && r.clipped.length === 0, r ? [...r.small, ...r.clipped].join(' ; ') : '');
  check(`${label} : aucune touche clavier mentionnée`, !!r && r.keys.length === 0, r ? r.keys.join(', ') : '');
  // une colonne : rien ne dépasse en largeur
  const wide = await G(page, () => { const W = window.innerWidth; const s = document.querySelector('.screen.on'); return [...s.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).visibility !== 'hidden' && (b.right > W + 0.5 || b.left < -0.5); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${e.className} [${Math.round(e.getBoundingClientRect().left)} → ${Math.round(e.getBoundingClientRect().right)}]`); });
  check(`${label} : rien ne dépasse de la largeur de l'écran`, wide.length === 0, wide.join(' ; '));
};
/** le niveau a-t-il un tutoriel ? (lu une fois, sur une page de test) */
let tutoKnown = null;
const hasTutorial = async () => {
  if (tutoKnown === null) {
    const p = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await p.goto(gameUrl('test&q=low&dr=0'));
    await p.waitForFunction(() => window.hr && window.hr.level, null, { timeout: 120000 });
    tutoKnown = await p.evaluate(() => !!window.hr.level.tutorial);
    await p.close();
  }
  return tutoKnown;
};
const scopeAt = (page, zoom = 10) => G(page, (zoom) => { const g = window.hr.game; g.player.teleport(...window.hr.level.testTouch.post, 'prone'); g.scope.enter(window.hr.level.testTouch.post[2], 0); g.rifle.zoom = zoom; g.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)); }, zoom);

// =====================================================================================================
// iPhone dans Safari : zone utile 375 × 664, ratio de pixels 3 (mesures de l'appareil du propriétaire)
// =====================================================================================================
{
  const W = 375, H = 664;
  const ctxInit = `window.__lock = []; try { if (screen.orientation) screen.orientation.lock = (o) => { window.__lock.push(o); return Promise.resolve(); }; } catch (e) {}`;
  const { page, cdp, errors, fingers } = await mobilePage(browser, { width: W, height: H }, 'fs=0&d=standard&dr=0', { dsf: 3, init: ctxInit });
  console.log(`\n— iPhone dans Safari, portrait ${W} × ${H}, ratio de pixels 3 —`);
  let s = await G(page, () => { const e = window.hr.engine, c = e.renderer.domElement, r = document.getElementById('rotate'); return { touch: window.hr.touch, cls: document.documentElement.className, blocked: window.hr.game.blocked, disp: getComputedStyle(r).display, q: e.q.name, maxDpr: e.maxDpr, pr: e.pixelRatio, bw: c.width, bh: c.height, cw: c.clientWidth, ch: c.clientHeight, aspect: e.camera.aspect, view: e.view, audio: window.hr.game.audio.started, lock: window.__lock, dvh: getComputedStyle(document.documentElement).height }; });
  check('appareil tactile détecté sans paramètre (pointer: coarse, maxTouchPoints)', s.touch === true);
  check('portrait : mise en page portrait, pas d’écran de rotation, jeu libre', /\bportrait\b/.test(s.cls) && !/\bturn\b/.test(s.cls) && s.disp === 'none' && s.blocked === false, s.cls);
  check('rendu calé sur la zone utile', s.cw === W && s.ch === H && Math.abs(s.aspect - W / H) < 0.01 && Math.abs(s.bw / s.bh - W / H) < 0.02 && s.dvh === H + 'px', `canvas ${s.cw}×${s.ch}, tampon ${s.bw}×${s.bh}`);
  check('qualité basse par défaut, ratio de pixels plafonné à 1,5, au plus 1,6 M de pixels rendus', s.q === 'low' && s.maxDpr === 1.5 && s.pr <= 1.5 && s.bw * s.bh <= 1.6e6, `${s.q}, ratio ${s.pr.toFixed(2)} (écran : 3), ${(s.bw * s.bh / 1e6).toFixed(2)} M de pixels`);
  check('champ à l’œil nu : horizontal ≈ 50–55°, vertical agrandi', (() => { const hf = 2 * Math.atan(Math.tan((s.view.baseFov * Math.PI) / 360) * (W / H)) * 180 / Math.PI; s.hf = hf; return hf > 49 && hf < 56 && s.view.baseFov > 70 && s.view.baseFov <= 88; })(), `vertical ${s.view.baseFov.toFixed(1)}°, horizontal ${s.hf.toFixed(1)}°`);
  check('verrouillage d’orientation : « portrait » demandé là où l’API existe, jamais « landscape »', s.lock.includes('portrait') && !s.lock.some((o) => /landscape/.test(o)), JSON.stringify(s.lock));
  const man = await (await fetch(BASE + 'manifest.webmanifest')).json();
  check('manifeste : orientation portrait', man.orientation === 'portrait', man.orientation);
  check('audio pas encore démarré avant le premier toucher', s.audio === false);

  // ---------------------------------------------------------------- gestes du système
  console.log('\n— gestes du système neutralisés —');
  s = await G(page, () => {
    const cs = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
    const ev = (type, target, init = {}) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, init); (target || document.body).dispatchEvent(e); return e.defaultPrevented; };
    const tEv = (type, target, n) => {
      const mk = (i) => new Touch({ identifier: 100 + i, target, clientX: 120 + i * 60, clientY: 200 });
      const ts = Array.from({ length: n }, (_, i) => mk(i));
      const e = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : ts, targetTouches: ts, changedTouches: ts });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const view = document.getElementById('view'), menu = document.getElementById('menu'), h1 = menu.querySelector('h1');
    return {
      viewport: document.querySelector('meta[name=viewport]').content,
      metas: ['theme-color', 'mobile-web-app-capable', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style'].map((n) => document.querySelector(`meta[name="${n}"]`)?.content ?? null),
      manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
      taView: cs('#view', 'touchAction'), taTouch: cs('#touch', 'touchAction'), taScreen: cs('#pause', 'touchAction'), taScroll: cs('#book .scroll', 'touchAction'), taRange: cs('input[type=range]', 'touchAction'),
      osHtml: cs('html', 'overscrollBehaviorY'), osBody: cs('body', 'overscrollBehaviorY'), osScroll: cs('#book .scroll', 'overscrollBehaviorY'),
      posBody: cs('body', 'position'), ovBody: cs('body', 'overflowY'),
      userSelect: cs('body', 'userSelect') || cs('body', 'webkitUserSelect'), callout: getComputedStyle(document.body).getPropertyValue('-webkit-touch-callout'), tapHl: cs('body', 'webkitTapHighlightColor'),
      guards: window.hr.guards,
      gesture: ['gesturestart', 'gesturechange', 'gestureend'].map((t) => ev(t)),
      dblclick: ev('dblclick', h1), contextCanvas: ev('contextmenu', view), contextBtn: ev('contextmenu', menu.querySelector('button')), selectstart: ev('selectstart', h1), dragstart: ev('dragstart', view),
      pinchStart: tEv('touchstart', h1, 2), pinchMove: tEv('touchmove', h1, 2), pageMove: tEv('touchmove', h1, 1), canvasStart: tEv('touchstart', view, 1),
    };
  });
  check('balise viewport', /width=device-width/.test(s.viewport) && /initial-scale=1/.test(s.viewport) && /maximum-scale=1/.test(s.viewport) && /user-scalable=no/.test(s.viewport) && /viewport-fit=cover/.test(s.viewport), s.viewport);
  check('balises écran d’accueil et manifeste', s.metas.every((m) => m) && !!s.manifest, JSON.stringify(s.metas) + ' ' + s.manifest);
  check('touch-action: none sur le canvas et la surface de jeu', s.taView === 'none' && s.taTouch === 'none', `${s.taView} / ${s.taTouch}`);
  check('touch-action: manipulation sur les écrans, pan-y dans les zones à défilement, none sur les curseurs', s.taScreen === 'manipulation' && s.taScroll === 'pan-y' && s.taRange === 'none', `${s.taScreen} / ${s.taScroll} / ${s.taRange}`);
  check('overscroll-behavior: none (page), contain (défilement interne) ; corps fixe sans défilement', s.osHtml === 'none' && s.osBody === 'none' && s.osScroll === 'contain' && s.posBody === 'fixed' && s.ovBody === 'hidden', `${s.osHtml} / ${s.osBody} / ${s.osScroll} / ${s.posBody} / ${s.ovBody}`);
  check('sélection de texte, loupe et surbrillance coupées', s.userSelect === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(s.tapHl), `user-select ${s.userSelect}, callout « ${s.callout} », surbrillance ${s.tapHl}`);
  const needG = ['gesturestart', 'gesturechange', 'gestureend', 'touchstart', 'touchmove', 'touchend', 'dblclick', 'contextmenu', 'selectstart', 'dragstart'];
  check('écouteurs anti-geste posés', needG.every((n) => s.guards.includes(n)), s.guards.join(', '));
  check('gesturestart / gesturechange / gestureend annulés', s.gesture.every(Boolean));
  check('dblclick, menu contextuel (canvas et bouton), sélection et glisser annulés', s.dblclick && s.contextCanvas && s.contextBtn && s.selectstart && s.dragstart, JSON.stringify([s.dblclick, s.contextCanvas, s.contextBtn, s.selectstart, s.dragstart]));
  check('second doigt (pincement) et défilement de page annulés ; toucher sur le canvas consommé', s.pinchStart && s.pinchMove && s.pageMove && s.canvasStart, JSON.stringify([s.pinchStart, s.pinchMove, s.pageMove, s.canvasStart]));
  // vrais gestes : double tap et pincement sur le titre, glissement vers le bas
  const scale = () => G(page, () => ({ s: window.visualViewport.scale, y: window.scrollY, top: document.documentElement.scrollTop }));
  await fingers.tap(190, 110); await sleep(90); await fingers.tap(190, 110); await sleep(500);
  let v = await scale();
  check('double tap sur le titre : visualViewport.scale reste à 1', v.s === 1, `échelle ${v.s}`);
  await fingers.down(1, 150, 120); await fingers.down(2, 220, 120);
  await fingers.slide(1, 60, 120, 6); await fingers.slide(2, 320, 120, 6);
  await fingers.up(1); await fingers.up(2); await sleep(400);
  v = await scale();
  check('pincement réel sur le titre : pas de zoom de page', v.s === 1, `échelle ${v.s}`);
  await fingers.down(1, 190, 60); await fingers.slide(1, 190, 300, 8); await fingers.up(1); await sleep(300);
  v = await scale();
  check('glissement vers le bas (tirer-pour-actualiser, effet élastique) : la page ne bouge pas', v.y === 0 && v.top === 0 && v.s === 1);
  check('aucun bouton du menu déclenché par ces gestes', (await G(page, () => window.hr.game.state)) === 'menu');
  check('audio démarré dès le premier toucher', (await G(page, () => window.hr.game.audio.started)) === true);

  // ---------------------------------------------------------------- menu, commandes, briefing
  console.log('\n— écrans —');
  await screenOk(page, 'menu', NONE);
  s = await G(page, () => { const h = document.querySelector('#menu h1').getBoundingClientRect(), st = document.querySelector('#menu .m-start').getBoundingClientRect(); return { foot: document.querySelector('#menu .foot').innerText, h: [h.left, h.right, h.height], st: [st.left, st.right, st.top, st.bottom], lines: document.querySelectorAll('#menu h1 > span').length, sc: document.getElementById('menu').scrollHeight - document.getElementById('menu').clientHeight }; });
  check('menu : titre sur deux lignes dans la largeur, « Commencer » pleine largeur, tout tient sans défiler', s.lines === 2 && s.h[0] >= 0 && s.h[1] <= W && s.st[1] - s.st[0] > W * 0.8 && s.st[3] < H && s.sc <= 1, JSON.stringify(s));
  check('menu : texte adapté au tactile, plus de mention de l’horizontale', !/horizontale|souris/i.test(s.foot), s.foot);
  await shot(page, 'menu');
  await tapText(page, fingers, 'Commandes');
  s = await G(page, () => { const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0); const ps = vis('#help .pschema'); return { scr: document.querySelector('.screen.on')?.id, portrait: ps.length, land: vis('#help .tschema').length, tall: ps.every((e) => e.getBoundingClientRect().height > e.getBoundingClientRect().width * 1.5), text: document.querySelector('#help .pschemas').innerText }; });
  check('« Commandes » : schéma tactile redessiné en portrait (deux téléphones verticaux)', s.scr === 'help' && s.portrait === 2 && s.land === 0 && s.tall && /manette/i.test(s.text) && /tirer/i.test(s.text) && /élév/i.test(s.text) && /souffle/i.test(s.text), s.text.replace(/\s+/g, ' ').slice(0, 90));
  await screenOk(page, 'commandes', NONE);
  await shot(page, 'commandes');
  await tapText(page, fingers, 'Retour');
  await tapText(page, fingers, 'Commencer');
  // hors mode essai, la carte n'est chargée qu'à ce toucher
  await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 });
  await sleep(700);
  // niveau sans tutoriel (data.tutorial nul) : le briefing ne le propose pas, ces contrôles sont sautés
  const HAS_TUTO = await G(page, () => !!window.hr.level.tutorial && window.hr.game.difficulty !== 'real');
  s = await G(page, () => ({ st: window.hr.game.state, choice: !!document.querySelector('#brief [data-tuto]'), sel: document.querySelector('#brief [data-tuto].sel')?.dataset.tuto }));
  if (HAS_TUTO) check('briefing : première partie, tutoriel proposé (« Avec le tutoriel » présélectionné)', s.st === 'brief' && s.choice && s.sel === 'on');
  else check('briefing : niveau sans tutoriel, aucun choix proposé', s.st === 'brief' && !s.sel, JSON.stringify(s));
  await screenOk(page, 'briefing', NONE);
  await shot(page, 'briefing');
  if (HAS_TUTO) {
    await tapText(page, fingers, 'Sans');
    s = await G(page, () => localStorage.getItem('hr.tuto'));
    check('choix « Sans » mémorisé (localStorage hr.tuto)', s === 'off', String(s));
  }
  await tapText(page, fingers, 'Continuer');
  await sleep(1200);

  // ---------------------------------------------------------------- en jeu
  console.log('\n— en jeu, au doigt —');
  s = await G(page, () => ({ st: window.hr.game.state, tuto: window.hr.game.tutorial, lock: document.pointerLockElement, on: document.getElementById('touch').classList.contains('on'), hud: document.getElementById('hud').innerText, fov: window.hr.engine.camera.fov, base: window.hr.engine.view.baseFov }));
  check('en jeu, sans tutoriel, sans verrouillage du pointeur', s.st === 'play' && s.tuto === null && s.lock === null);
  check('caméra à l’épaule : champ vertical de la vue portrait', Math.abs(s.fov - s.base) < 0.01, `${s.fov.toFixed(1)}°`);
  let btns = await visibleButtons(page);
  check('commandes tactiles affichées : Carnet, Briefing, Pause, Accroupi, Couché', s.on && ['book', 'brief', 'pause', 'crouch', 'prone'].every((b) => btns.includes(b)) && !btns.includes('fire') && !btns.includes('aim') && !btns.includes('rack'), btns.join(', '));
  check('HUD : aucune touche clavier mentionnée', !/Clic|Tab\b|Échap|<b>[A-Z]<\/b>/.test(s.hud), s.hud.replace(/\s+/g, ' ').slice(0, 120));
  s = await G(page, () => { const r = (id) => document.querySelector(`#touch [data-tb=${id}]`).getBoundingClientRect(); const W = window.innerWidth, H = window.innerHeight; return { top: ['book', 'brief', 'pause'].every((id) => r(id).bottom < H * 0.12 && r(id).left > W * 0.5), arc: ['crouch', 'prone'].every((id) => r(id).left > W * 0.6 && r(id).top > H * 0.6) }; });
  check('boutons : rangée discrète en haut à droite, postures sous le pouce droit', s.top && s.arc, JSON.stringify(s));
  await sleep(600);
  await geometry(page, 'jeu', NONE);
  await shot(page, 'jeu');

  // zones : la manette ne naît que dans le bas gauche ; ailleurs, on regarde
  const SX = 90, SY = 520;
  const y0 = await G(page, () => window.hr.game.player.yaw);
  await fingers.down(1, 90, 230); await fingers.slide(1, 170, 232, 8); await sleep(120);
  s = await G(page, () => ({ stick: window.hr.game.touchCtl.stickActive, yaw: window.hr.game.player.yaw }));
  await fingers.up(1);
  check('haut de l’écran, à gauche comme à droite : glisser fait tourner le regard, pas de manette', !s.stick && Math.abs(s.yaw - y0) > 0.1, `cap ${(s.yaw - y0).toFixed(2)} rad`);
  // manette + regard en même temps (deux pouces)
  const p0 = await G(page, () => { const p = window.hr.game.player; return { x: p.pos.x, z: p.pos.z, yaw: p.yaw }; });
  await fingers.down(1, SX, SY);
  await fingers.slide(1, SX, SY - 80, 6);
  await sleep(500);
  s = await G(page, () => { const i = window.hr.game.input, t = window.hr.game.touchCtl; return { ax: i.axisX, ay: i.axisY, run: i.run, stick: t.stickActive, shown: document.querySelector('#touch .stick').classList.contains('on') }; });
  check('manette flottante : apparaît sous le pouce gauche, en bas ; poussée à fond = course', s.stick && s.shown && s.ay > 0.95 && s.run === true, JSON.stringify(s));
  await fingers.down(2, 250, 400);
  await fingers.slide(2, 330, 392, 10);
  await shot(page, 'manette');
  await sleep(500);
  const p1 = await G(page, () => { const p = window.hr.game.player, i = window.hr.game.input; return { x: p.pos.x, z: p.pos.z, yaw: p.yaw, speed: p.speed, ay: i.axisY }; });
  check('se déplacer et regarder en même temps (multi-touch, deux pouces)', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5 && Math.abs(p1.yaw - p0.yaw) > 0.15 && p1.ay > 0.95, `déplacement ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m, cap ${(p1.yaw - p0.yaw).toFixed(2)} rad, ${p1.speed.toFixed(1)} m/s`);
  await fingers.up(2);
  await fingers.slide(1, SX, SY - 53, 4); // manette à mi-course (le centre a suivi le pouce) : marche
  await sleep(700);
  s = await G(page, () => ({ run: window.hr.game.input.run, ay: window.hr.game.input.axisY, speed: window.hr.game.player.speed }));
  check('manette à mi-course : marche, vitesse proportionnelle', !s.run && s.ay > 0.1 && s.ay < 0.9 && s.speed > 0.2 && s.speed < 1.9, JSON.stringify(s));
  await fingers.up(1);
  await sleep(300);
  s = await G(page, () => { const i = window.hr.game.input, t = window.hr.game.touchCtl; return { ax: i.axisX, ay: i.axisY, run: i.run, stick: t.stickActive }; });
  check('doigt levé : manette relâchée', s.ax === 0 && s.ay === 0 && !s.run && !s.stick);

  // marche jusqu'à la brèche est : la manette est tenue au doigt, le cap est celui de la boussole
  await G(page, () => {
    const g = window.hr.game, out = { x: 0, z: 0, dist: 0, bearing: 0, hint: '' };
    const tick = () => { if (!window.__steer) return; g.player.guideTo((window.hr.level.testTouch.postKey ?? window.hr.level.tutorial.post), out); g.player.yaw = out.bearing; requestAnimationFrame(tick); };
    window.__steer = true;
    tick();
  });
  await fingers.down(1, SX, SY);
  await fingers.slide(1, SX, SY - 80, 5);
  let arrived = false;
  try { await page.waitForFunction(() => window.hr.game.player.nearestPost() === (window.hr.level.testTouch.postKey ?? window.hr.level.tutorial.post), null, { timeout: 45000 }); arrived = true; } catch { /* pas arrivé */ }
  await fingers.up(1);
  await G(page, () => { window.__steer = false; });
  s = await G(page, () => { const p = window.hr.game.player; return { post: p.nearestPost(), x: p.pos.x.toFixed(1), z: p.pos.z.toFixed(1), way: document.querySelector('[data-id=cLabel]').innerText }; });
  check('brèche est rejointe à la manette en suivant le cap de la boussole ; « en position » affiché', arrived && /en position/i.test(s.way), JSON.stringify(s));
  // s'avancer jusqu'au poste exact pour avoir la vue dégagée (orientation fournie, déplacement à la manette)
  await G(page, () => { const g = window.hr.game; g.player.teleport(...window.hr.level.testTouch.post, 'stand'); });
  await sleep(300);

  // postures
  await tapSel(page, fingers, tb('crouch'));
  await sleep(500);
  s = await G(page, () => ({ st: window.hr.game.player.stance, cap: document.querySelector('[data-cap=crouch]').textContent }));
  check('bouton Accroupi', s.st === 'crouch' && s.cap === 'Debout', JSON.stringify(s));
  await tapSel(page, fingers, tb('prone'));
  await sleep(1300);
  btns = await visibleButtons(page);
  s = await G(page, () => ({ st: window.hr.game.player.stance, cap: document.querySelector('[data-cap=prone]').textContent }));
  check('bouton Couché ; il devient « Se relever », Épauler apparaît', s.st === 'prone' && s.cap === 'Se relever' && btns.includes('aim') && !btns.includes('crouch'), `${s.st}, « ${s.cap} », ${btns.join(', ')}`);
  await geometry(page, 'jeu, couché', NONE);
  await shot(page, 'jeu-couche');
  await tapSel(page, fingers, tb('aim'));
  await sleep(700);
  btns = await visibleButtons(page);
  s = await G(page, () => ({ sc: window.hr.game.scope.active, cap: document.querySelector('[data-cap=aim]').textContent, off: window.hr.engine.camera.view?.enabled === true, view: window.hr.engine.view, cF: window.hr.engine.finish.u('uCenterF').value.toArray(), rF: window.hr.engine.finish.u('uScopeR').value, cL: window.hr.engine.lens.u('uCenterL').value.toArray() }));
  const scopeBtns = ['fire', 'aim', 'breath', 'range', 'zin', 'zout', 'e-10', 'e-1', 'e+1', 'e+10', 'w-10', 'w-1', 'w+1', 'w+10', 'book', 'brief', 'pause'];
  check('bouton Épauler : lunette, boutons de tir, zoom et tourelles', s.sc && s.cap === 'Quitter' && scopeBtns.every((b) => btns.includes(b)) && !btns.includes('prone') && !btns.includes('crouch'), btns.join(', '));
  check('lunette : projection décentrée (setViewOffset), masque et lentille centrés sur le centre optique', s.off && Math.abs(s.cF[0] - s.view.cx / W) < 1e-4 && Math.abs(s.cF[1] - (1 - s.view.cy / H)) < 1e-4 && Math.abs(s.rF - s.view.R / H) < 1e-4 && Math.abs(s.cL[1] - s.cF[1]) < 1e-6, `centre (${s.view.cx.toFixed(1)} ; ${s.view.cy.toFixed(1)}), rayon ${s.view.R.toFixed(1)} px`);
  s = await G(page, () => { const r = (id) => document.querySelector(`#touch [data-tb="${id}"]`).getBoundingClientRect(); const v = window.hr.engine.view, H = window.innerHeight, W = window.innerWidth; const low = ['fire', 'aim', 'breath', 'range', 'zin', 'zout', 'e-10', 'e-1', 'e+1', 'e+10', 'w-10', 'w-1', 'w+1', 'w+10'].every((id) => r(id).top >= v.cy + v.R); return { low, fire: r('fire').width, fireRight: r('fire').left > W / 2 && r('fire').top > H * 0.7, breathLeft: r('breath').right < W / 2 && r('breath').top > H * 0.7, vals: ['elev', 'wind', 'zoom'].map((o) => document.querySelector(`[data-o=${o}]`).getBoundingClientRect().height > 8) }; });
  check('lunette : tourelles, zoom, Souffle, Télémètre, Quitter et Tirer sous le champ ; Tirer (gros) à droite, Souffle à gauche', s.low && s.fire >= 78 && s.fireRight && s.breathLeft && s.vals.every(Boolean), JSON.stringify(s));

  // grossissement : boutons, maintien, pincement
  const zoom = () => G(page, () => window.hr.game.rifle.zoom);
  await G(page, () => { window.hr.game.rifle.zoom = 6; });
  const zin = await center(page, tb('zin')), zout = await center(page, tb('zout'));
  for (let i = 0; i < 3; i++) { await fingers.tap(zin.x, zin.y); await sleep(120); }
  let z = await zoom();
  check('zoom + : trois appuis, trois crans', Math.abs(z - 6 * 1.09 ** 3) < 0.05, `6 → ${z.toFixed(2)}×`);
  await fingers.down(1, zin.x, zin.y); await sleep(1100); await fingers.up(1); await sleep(100);
  const zHold = await zoom();
  check('zoom + maintenu : répétition', zHold > z * 1.09 ** 4, `${z.toFixed(2)} → ${zHold.toFixed(2)}×`);
  await fingers.tap(zout.x, zout.y); await sleep(150);
  z = await zoom();
  check('zoom − : un cran', Math.abs(z - zHold / 1.09) < 0.05, `${zHold.toFixed(2)} → ${z.toFixed(2)}×`);
  await G(page, () => { window.hr.game.rifle.zoom = 6; });
  await fingers.down(1, 160, 180); await fingers.down(2, 215, 180);
  await fingers.slide(1, 110, 180, 8); await fingers.slide(2, 275, 180, 8);
  await fingers.up(1); await fingers.up(2); await sleep(200);
  z = await zoom();
  const vs = await scale();
  check('pincement à deux doigts sur le champ : grossit, sans zoom de page', z > 9 && vs.s === 1, `6 → ${z.toFixed(2)}×, page ${vs.s}`);
  // sensibilité de visée réduite avec le grossissement
  const dragYaw = async (zm) => {
    await G(page, (zm) => { window.hr.game.rifle.zoom = zm; }, zm);
    await sleep(80);
    const a = await G(page, () => window.hr.game.scope.yaw);
    await fingers.down(1, 140, 200); await fingers.slide(1, 240, 200, 10); await fingers.up(1); await sleep(120);
    return (await G(page, () => window.hr.game.scope.yaw)) - a;
  };
  const y4 = await dragYaw(4), y16 = await dragYaw(16);
  // au doigt, le zoom le plus bas balaie plus large encore que la seule proportion du grossissement (rapport 4) : 6 à 13
  check('viser en glissant : sensibilité réduite avec le grossissement', y4 > 0 && y16 > 0 && y4 / y16 > 6 && y4 / y16 < 13 && y4 * 1000 > 90, `100 px : ${(y4 * 1000).toFixed(1)} mrad à 4×, ${(y16 * 1000).toFixed(1)} mrad à 16× (rapport ${(y4 / y16).toFixed(2)})`);
  // viser aussi depuis la zone libre de la moitié basse, sous les pouces
  s = await G(page, () => { const v = window.hr.engine.view; const bs = [...document.querySelectorAll('#touch [data-tb]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect()); const top = Math.max(...bs.filter((b) => b.top < window.innerHeight * 0.8 && b.top > v.cy).map((b) => b.bottom)), bot = Math.min(...bs.filter((b) => b.bottom > window.innerHeight * 0.9).map((b) => b.top)); return { top, bot, yaw: window.hr.game.scope.yaw }; });
  if (s.bot - s.top > 30) {
    const yy = (s.top + s.bot) / 2;
    await fingers.down(1, 120, yy); await fingers.slide(1, 220, yy, 8); await fingers.up(1); await sleep(120);
    const yaw = await G(page, () => window.hr.game.scope.yaw);
    check('viser en glissant dans la zone libre de la moitié basse', yaw - s.yaw > 0.001, `zone libre de ${Math.round(s.bot - s.top)} px de haut`);
  }
  await G(page, () => { window.hr.game.rifle.zoom = 10; });

  // tourelles : clics de 0,1 mrad, ±1 mrad, répétition au maintien, rien de collé
  const tur = () => G(page, () => ({ e: window.hr.game.rifle.elevClicks, w: window.hr.game.rifle.windClicks, pressed: window.hr.game.touchCtl.pressed, shown: document.querySelector('[data-o=elev]').textContent + ' / ' + document.querySelector('[data-o=wind]').textContent }));
  const tapN = async (id, n) => { const c = await center(page, tb(id)); for (let i = 0; i < n; i++) { await fingers.tap(c.x, c.y, 9, 40); await sleep(70); } await sleep(120); };
  await tapN('e+10', 2); await tapN('e+1', 3); await tapN('e-1', 1); await tapN('w+1', 4); await tapN('w-1', 1); await tapN('w-10', 1); await tapN('w+10', 1);
  s = await tur();
  check('tourelles : +1 ×2, + ×3, − ×1 → 2,2 mrad ; dérive D ×4, G ×1, G1, D1 → D 0,3 ; valeurs affichées', s.e === 22 && s.w === 3 && /2,2/.test(s.shown) && /D 0,3/.test(s.shown), JSON.stringify(s));
  const ep = await center(page, tb('e+1'));
  await fingers.down(1, ep.x, ep.y); await sleep(1250);
  const during = await tur();
  await fingers.up(1); await sleep(150);
  s = await tur();
  check('tourelle maintenue : les clics s’enchaînent, puis s’arrêtent au relâchement', during.e > 26 && during.pressed.includes('e+1') && s.pressed.length === 0 && s.e >= during.e && s.e <= during.e + 2, `22 → ${during.e} → ${s.e}`);
  await fingers.down(1, ep.x, ep.y); await sleep(150);
  await fingers.slide(1, ep.x + 20, ep.y + 110, 5);
  await sleep(100);
  const slid = await tur();
  await sleep(700);
  s = await tur();
  await fingers.up(1);
  check('doigt glissé hors du bouton : relâché, plus aucun clic', slid.pressed.length === 0 && s.e === slid.e, `${slid.e} → ${s.e}, enfoncés : [${slid.pressed}]`);
  const br = await center(page, tb('breath'));
  await fingers.down(1, br.x, br.y); await sleep(350);
  const held = await G(page, () => ({ b: window.hr.game.scope.breath, k: window.hr.game.input.down('Space'), cls: document.querySelector('[data-tb=breath]').classList.contains('down') }));
  await fingers.cancel(); await sleep(250);
  s = await G(page, () => ({ b: window.hr.game.scope.breath, k: window.hr.game.input.down('Space'), pressed: window.hr.game.touchCtl.pressed, cls: document.querySelector('[data-tb=breath]').classList.contains('down') }));
  check('Souffle maintenu : apnée, retour visuel ; geste interrompu (touchcancel) : relâché', held.b === 'held' && held.k && held.cls && s.b !== 'held' && !s.k && s.pressed.length === 0 && !s.cls, `${JSON.stringify(held)} → ${JSON.stringify(s)}`);

  // réglage d'après le carnet, puis tir sur la plaque carrée
  const need = await G(page, () => { const g = window.hr.game; g.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)); const d = g.targets.get((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)).aimPoint(g.engine.camera.position.clone()).distanceTo(g.player.eye(g.engine.camera.position.clone())); return { need: g.tableElev(g.rifle.def, d), d }; });
  s = await tur();
  const want = Math.round(need.need * 10);
  const diff = want - s.e;
  await tapN(diff > 0 ? 'e+10' : 'e-10', Math.floor(Math.abs(diff) / 10));
  await tapN(diff > 0 ? 'e+1' : 'e-1', Math.abs(diff) % 10);
  await tapN('w-1', 3);
  s = await tur();
  check(`tourelle réglée aux boutons sur la valeur du carnet (${need.need.toFixed(1)} mrad à ${Math.round(need.d)} m), dérive à zéro`, s.e === want && s.w === 0, JSON.stringify(s));
  await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
  await sleep(600);
  await geometry(page, 'lunette', NONE);
  const rg = await center(page, tb('range'));
  await fingers.tap(rg.x, rg.y); await sleep(300);
  s = await G(page, () => { const e = document.querySelector('[data-id=range]'), b = e.getBoundingClientRect(), v = window.hr.engine.view; return { r: window.hr.game.range, shown: e.textContent, under: b.top >= v.cy + v.R && b.left >= 0 && b.right <= window.innerWidth, wind: document.querySelector('[data-id=windV]').textContent }; });
  check('bouton Télémètre : distance mesurée, affichée sous le champ avec le vent', s.r !== null && Math.abs(s.r - need.d) < 6 && /m/.test(s.shown) && s.under && /m\/s/.test(s.wind), `${s.r?.toFixed(1)} m, « ${s.shown} », vent « ${s.wind} »`);
  await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
  await sleep(250);
  await shot(page, 'lunette');
  await geometry(page, 'lunette, distance affichée', NONE);
  const fire = await center(page, tb('fire'));
  let hit = false, shots = 0, multi = false;
  for (let i = 0; i < 6 && !hit; i++) {
    const ready = await G(page, () => { const r = window.hr.game.rifle; return { ready: r.ready, mag: r.mag, ch: r.chambered }; });
    if (!ready.ch && ready.mag === 0) { await tapSel(page, fingers, tb('reload')); await sleep(3200); continue; }
    if (!ready.ready) { await sleep(500); continue; }
    await fingers.down(1, br.x, br.y); // pouce gauche : souffle retenu
    await sleep(450);
    const before = await G(page, () => { const g = window.hr.game; g.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)); return { n: g.rifle.shotsFired, breath: g.scope.breath }; });
    await sleep(60);
    await fingers.tap(fire.x, fire.y, 2, 60); // pouce droit : détente, l'autre doigt toujours posé
    await sleep(120);
    const after = await G(page, () => ({ n: window.hr.game.rifle.shotsFired, breath: window.hr.game.scope.breath }));
    if (after.n === before.n + 1 && before.breath === 'held') multi = true;
    shots += after.n - before.n;
    await fingers.up(1);
    await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 15000 });
    await sleep(300);
    hit = await G(page, () => window.hr.game.targets.get((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)).done);
  }
  s = await G(page, () => ({ log: window.hr.game.mission.log[0], mag: window.hr.game.rifle.mag }));
  check('bouton Tirer avec le souffle retenu de l’autre pouce (multi-touch) : le coup part', multi && shots >= 1, `${shots} tir(s)`);
  check('plaque carrée touchée au doigt', hit, s.log ? `${s.log.result}, ${Math.round(s.log.distance)} m, É ${s.log.elev.toFixed(1)} / D ${s.log.wind.toFixed(1)}` : 'aucun tir enregistré');
  await sleep(900);
  // niveau dont le premier objectif n'a qu'une cible : il vient d'être validé et le briefing suivant s'affiche ;
  // on le passe et on reprend en lunette au même poste
  try { await page.waitForFunction(() => window.hr.game.state === 'brief', null, { timeout: 2500 }); } catch { /* objectif encore en cours */ }
  if (await G(page, () => window.hr.game.state === 'brief')) { await G(page, () => window.hr.game.continueBrief()); await sleep(500); await scopeAt(page); await sleep(700); }
  btns = await visibleButtons(page);
  check('bouton Recharger affiché quand le chargeur est entamé', btns.includes('reload'));
  await geometry(page, 'lunette, Recharger affiché', NONE);
  await tapSel(page, fingers, tb('reload'));
  s = await G(page, () => window.hr.game.rifle.reloadT);
  check('bouton Recharger', s > 0, `rechargement ${s.toFixed(1)} s`);
  await sleep(3200);

  // carnet
  console.log('\n— carnet, râtelier, pause —');
  await tapSel(page, fingers, tb('book'));
  await sleep(700);
  s = await G(page, () => ({ st: window.hr.game.state, on: document.getElementById('touch').classList.contains('on'), cols: [...document.querySelectorAll('#book table.dope tr:first-child th')].filter((e) => e.getBoundingClientRect().width > 0).length, rows: document.querySelectorAll('#book table.dope tr').length, list: [...document.querySelectorAll('#book .dope-list .dl')].filter((e) => e.getBoundingClientRect().height > 0).length }));
  // table à colonnes (physique d'origine) ou liste décomposée du carnet avancé (une ligne par distance, en portrait)
  check('bouton Carnet : carnet ouvert, commandes de jeu masquées, table de tir lisible', s.st === 'book' && !s.on && ((s.cols >= 4 && s.rows > 5) || s.list > 5), s.list > 5 ? `liste décomposée, ${s.list} distances` : `${s.cols} colonnes, ${s.rows - 1} lignes`);
  await screenOk(page, 'carnet', NONE);
  await shot(page, 'carnet');
  const sc0 = await G(page, () => { const e = document.querySelector('#book .book-grid > .scroll'); const b = e.getBoundingClientRect(); return { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, x: b.left + b.width / 2, y: b.top + b.height * 0.75, h: b.height }; });
  if (sc0.max > 4) {
    await fingers.down(1, sc0.x, sc0.y); await fingers.slide(1, sc0.x, sc0.y - Math.min(140, sc0.h * 0.6), 10, 20); await fingers.up(1); await sleep(500);
    const sc1 = await G(page, () => ({ top: document.querySelector('#book .book-grid > .scroll').scrollTop, page: window.scrollY, s: window.visualViewport.scale }));
    check('carnet : défilement interne au doigt conservé, la page ne bouge pas', sc1.top > 10 && sc1.page === 0 && sc1.s === 1, `défilement ${sc0.top} → ${Math.round(sc1.top)} px sur ${Math.round(sc0.max)}`);
  } else check('carnet : la table tient sans défilement', true, `reste ${Math.round(sc0.max)} px`);
  const e0 = (await tur()).e;
  const plus = await center(page, '#book [data-tur="elev:1"]');
  await fingers.tap(plus.x, plus.y, 9, 40); await sleep(90); await fingers.tap(plus.x, plus.y, 9, 40); await sleep(300);
  s = await G(page, () => ({ e: window.hr.game.rifle.elevClicks, s: window.visualViewport.scale, out: document.querySelector('[data-id=bElev]').textContent }));
  check('carnet : deux appuis rapides sur « + » = deux clics, sans zoom', s.e === e0 + 2 && s.s === 1, `${e0} → ${s.e} (${s.out})`);
  await tapText(page, fingers, 'Fermer');
  check('carnet : bouton Fermer', (await G(page, () => window.hr.game.state)) === 'play');
  await tapSel(page, fingers, tb('aim'));
  await sleep(400);
  s = await G(page, () => ({ sc: window.hr.game.scope.active, off: window.hr.engine.camera.view?.enabled === true }));
  check('bouton Quitter : lunette quittée, projection recentrée', s.sc === false && s.off === false);
  await tapSel(page, fingers, tb('prone'));
  await sleep(900);
  check('bouton Se relever', (await G(page, () => window.hr.game.player.stance)) === 'crouch');

  // râtelier : le bouton n'apparaît que sous l'abri
  btns = await visibleButtons(page);
  const noRack = !btns.includes('rack');
  await G(page, () => window.hr.game.player.teleport(...window.hr.level.testTouch.rack, 'stand'));
  await sleep(500);
  btns = await visibleButtons(page);
  check('bouton Râtelier : seulement près du râtelier', noRack && btns.includes('rack'), btns.join(', '));
  await geometry(page, 'jeu près du râtelier (alerte du campement affichée)', NONE);
  await shot(page, 'jeu-ratelier');
  await tapSel(page, fingers, tb('rack'));
  await sleep(700);
  check('bouton Râtelier : râtelier ouvert', (await G(page, () => window.hr.game.state)) === 'rack');
  await screenOk(page, 'râtelier', NONE);
  // deux autres armes du râtelier du niveau : la première est choisie puis laissée, la seconde est prise
  // (carte d'origine : .223 puis 6.5 Creedmoor, arme en main .22 LR)
  const RK = await G(page, () => { const g = window.hr.game, cur = g.rifle.def.id, others = g.weapons.map((w) => w.id).filter((id) => id !== cur); return { cur, a: others.includes('223') ? '223' : others[0], b: others.includes('65cm') ? '65cm' : others[1] ?? others[0] }; });
  const w223 = await center(page, `#rack [data-w="${RK.a}"]`);
  await fingers.tap(w223.x, w223.y); await sleep(300);
  await shot(page, 'ratelier');
  s = await G(page, () => ({ sel: window.hr.game.ui.rackSel, cur: window.hr.game.rifle.def.id }));
  check('râtelier : arme choisie au doigt', s.sel === RK.a && s.cur === RK.cur);
  await tapText(page, fingers, 'Fermer');
  s = await G(page, () => ({ st: window.hr.game.state, cur: window.hr.game.rifle.def.id }));
  check('râtelier : bouton Fermer, arme inchangée', s.st === 'play' && s.cur === RK.cur);
  await tapSel(page, fingers, tb('rack')); await sleep(500);
  const w65 = await center(page, `#rack [data-w="${RK.b}"]`);
  await fingers.tap(w65.x, w65.y); await sleep(250);
  await tapText(page, fingers, 'Prendre cette arme');
  s = await G(page, () => ({ st: window.hr.game.state, cur: window.hr.game.rifle.def.id }));
  check('râtelier : « Prendre cette arme »', s.st === 'play' && s.cur === RK.b, JSON.stringify(s));

  // pause, briefing
  await tapSel(page, fingers, tb('pause'));
  await sleep(600);
  check('bouton Pause', (await G(page, () => window.hr.game.state)) === 'pause');
  await screenOk(page, 'pause', NONE);
  await shot(page, 'pause');
  await tapText(page, fingers, 'Reprendre');
  check('pause : Reprendre', (await G(page, () => window.hr.game.state)) === 'play');
  await tapSel(page, fingers, tb('brief'));
  await sleep(500);
  check('bouton Briefing', (await G(page, () => window.hr.game.state)) === 'brief');
  await tapText(page, fingers, 'Continuer');
  check('briefing : Continuer', (await G(page, () => window.hr.game.state)) === 'play');

  // perte de focus : onglet masqué, appel entrant
  await fingers.down(1, SX, SY); await fingers.slide(1, SX, SY - 70, 4);
  await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  s = await G(page, () => { const i = window.hr.game.input; return { st: window.hr.game.state, ay: i.axisY, stick: window.hr.game.touchCtl.stickActive }; });
  check('onglet masqué (visibilitychange) : pause automatique, manette relâchée', s.st === 'pause' && s.ay === 0 && !s.stick, JSON.stringify(s));
  await fingers.up(1);
  await G(page, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await tapText(page, fingers, 'Reprendre');

  // téléphone tourné à l'horizontale en pleine partie
  console.log('\n— téléphone à l’horizontale —');
  await fingers.down(1, SX, SY); await fingers.slide(1, SX, SY - 70, 4);
  await page.setViewportSize({ width: H, height: W });
  await sleep(600);
  s = await G(page, () => { const r = document.getElementById('rotate'), b = r.getBoundingClientRect(); return { st: window.hr.game.state, blocked: window.hr.game.blocked, disp: getComputedStyle(r).display, full: b.width === window.innerWidth && b.height === window.innerHeight, txt: r.innerText, cls: document.documentElement.className, ay: window.hr.game.input.axisY, lock: window.__lock }; });
  await fingers.up(1);
  check('paysage : écran « Tournez votre appareil » plein cadre, vers la verticale', s.disp === 'flex' && s.full && /Tournez votre appareil/i.test(s.txt) && /verticale/i.test(s.txt) && /\bturn\b/.test(s.cls), s.txt.replace(/\s+/g, ' '));
  check('paysage : jeu en pause, commandes relâchées, plus de rappel « écran d’accueil »', s.st === 'pause' && s.blocked && s.ay === 0 && !/accueil/i.test(s.txt), JSON.stringify({ st: s.st, blocked: s.blocked }));
  check('aucun verrouillage en paysage demandé', !s.lock.some((o) => /landscape/.test(o)), JSON.stringify(s.lock));
  await shot(page, 'rotation');
  await page.setViewportSize({ width: W, height: H });
  await sleep(600);
  s = await G(page, () => ({ st: window.hr.game.state, blocked: window.hr.game.blocked, disp: getComputedStyle(document.getElementById('rotate')).display }));
  check('retour à la verticale : écran de rotation retiré, pause conservée', !s.blocked && s.disp === 'none' && s.st === 'pause');
  await tapText(page, fingers, 'Reprendre');

  // barres de Safari : la hauteur utile change (la barre d'outils se déplie)
  console.log('\n— barres du navigateur —');
  await scopeAt(page);
  await sleep(700);
  const r0 = await layoutReport(page, NONE);
  await page.setViewportSize({ width: W, height: 560 });
  await sleep(500);
  s = await G(page, () => { const c = window.hr.engine.renderer.domElement; return { ch: c.clientHeight, ratio: c.width / c.height, aspect: window.hr.engine.camera.aspect, view: window.hr.engine.view }; });
  check('hauteur utile réduite (barres du navigateur) : rendu recalé', s.ch === 560 && Math.abs(s.aspect - W / 560) < 0.01 && Math.abs(s.ratio - W / 560) < 0.02, JSON.stringify({ ch: s.ch, aspect: s.aspect }));
  await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
  await sleep(300);
  const r1 = await geometry(page, 'lunette en 375 × 560', NONE);
  check('hauteur réduite : le champ rétrécit pour laisser la place aux commandes', r1.field.R < r0.field.R && r1.field.R > 120, `rayon ${r0.field.R.toFixed(0)} → ${r1.field.R.toFixed(0)} px`);
  await shot(page, 'lunette-560');
  await page.setViewportSize({ width: W, height: H });
  await sleep(400);
  s = await G(page, () => ({ pressed: window.hr.game.touchCtl.pressed, ax: window.hr.game.input.axisX, ay: window.hr.game.input.axisY, R: window.hr.engine.view.R }));
  check('fin de scénario : aucun bouton resté enfoncé, champ revenu à sa taille', s.pressed.length === 0 && s.ax === 0 && s.ay === 0 && Math.abs(s.R - r0.field.R) < 0.6);
  // écrans de fin
  await G(page, () => { const g = window.hr.game; g.scope.exit(); g.ui.fail('La cible s’est fondue dans la foule en fuite.'); g.setState('fail'); });
  await sleep(700);
  await screenOk(page, 'échec', NONE);
  await shot(page, 'echec');
  check('aucune erreur dans la console', errors.length === 0, [...new Set(errors)].join(' | '));
  void cdp;
  await page.context().close();
}

// =====================================================================================================
// exactitude optique : la taille apparente d'un objet connu correspond aux mils du réticule
// =====================================================================================================
{
  console.log('\n— exactitude optique de la lunette —');
  // disque de 1 m de diamètre posé à 500 m sur la ligne de visée : il doit couvrir 2 mrad, centré sur le centre
  // optique. Mesure faite sur l'image réellement rendue (tampon WebGL après post-traitement), temps figé.
  const measure = (page, zoom) => G(page, async (zoom) => {
    const g = window.hr.game, e = g.engine, cam = e.camera, v = e.view;
    g.rifle.zoom = zoom;
    g.timeScale = 0;
    await new Promise((r) => setTimeout(r, 250));
    g.step(0, 0);
    const gl = e.renderer.domElement;
    const grab = () => { e.render(0, 16); const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(gl, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const a = grab();
    const eye = g.player.eye(cam.position.clone()), los = g.scope.lineOfSight(eye.clone());
    const P = eye.clone().addScaledVector(los, 500);
    const M = g.bulletMesh;
    const disc = new M.constructor(M.geometry, M.material.clone());
    disc.material.color.setRGB(0.95, 0.02, 0.95); // sous le seuil du halo lumineux, qui élargirait la tache
    disc.material.depthTest = false;
    disc.renderOrder = 999;
    disc.frustumCulled = false;
    disc.position.copy(P);
    disc.lookAt(eye);
    disc.scale.set(0.5 / 0.0045, 0.5 / 0.0045, 1);
    e.scene.add(disc);
    const b = grab();
    e.scene.remove(disc);
    g.timeScale = 1;
    const k = gl.width / v.w;
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sx = 0, sy = 0, n = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 60) { n++; sx += x + 0.5; sy += y + 0.5; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // projection par la matrice de la caméra : 1 m à 500 m, de part et d'autre de la ligne de visée
    const right = los.clone().cross(cam.up).normalize();
    const pr = (p) => { const q = p.clone().project(cam); return [(q.x * 0.5 + 0.5) * v.w, (1 - (q.y * 0.5 + 0.5)) * v.h]; };
    const c0 = pr(P), cl = pr(P.clone().addScaledVector(right, -0.5)), cr = pr(P.clone().addScaledVector(right, 0.5));
    // réticule : encre sur les branches à 1, 2, 3 mrad du centre optique, rien dans les quadrants hauts (la position de
    // chaque graduation est mesurée par e2e/reticle.mjs)
    const ppm = e.pxPerMil(), rc = g.ui.reticle.canvas, rk = rc.width / v.w, rg = rc.getContext('2d');
    const al = (mx, my) => rg.getImageData(Math.round((v.cx + mx * ppm) * rk), Math.round((v.cy + my * ppm) * rk), 1, 1).data[3];
    return { zoom, ppm, fov: cam.fov, view: { ...v }, n, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k, cx: sx / n / k, cy: sy / n / k, proj: Math.hypot(cr[0] - cl[0], cr[1] - cl[1]), c0, dots: [al(1, 0), al(2, 0), al(-3, 0), al(0, -2)], gaps: [al(1.5, -1.5), al(-2.5, -2.5)], field: (v.R / ppm) * zoom };
  }, zoom);
  const REF = 0.462 * 2 * Math.tan((55 * Math.PI) / 360) * 1000; // demi-champ en mrad × grossissement, écran de référence
  for (const [label, vp, dsf, q] of [['portrait 375 × 664', { width: 375, height: 664 }, 3, 'dr=0&tuto=0&play&d=standard&fs=0&w=338lm'], ['portrait 430 × 932', { width: 430, height: 932 }, 3, 'dr=0&tuto=0&play&d=standard&fs=0&w=338lm'], ['paysage de référence 1280 × 720 (ordinateur)', { width: 1280, height: 720 }, 1, 'dr=0&test&play&d=standard&w=338lm&q=low&touch=0']]) {
    const desktop = dsf === 1;
    let page, errors;
    if (desktop) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      page = await ctx.newPage(); errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      await page.goto(gameUrl(q));
      await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
      await sleep(1200);
    } else ({ page, errors } = await mobilePage(browser, vp, q, { dsf, notch: vp.height > 800 ? NOTCH : null }));
    // arme de la mesure optique : celle du niveau (testTouch.weapon), sinon le .338 de la carte d'origine s'il est au râtelier
    await G(page, () => { const g = window.hr.game; g.continueBrief(); const T = window.hr.level.testTouch, F = T.far; g.equip(T.weapon ?? '338lm'); g.player.teleport(...F.at); g.scope.enter(0, 0); g.autoAim(F.target); });
    await sleep(900);
    for (const zoom of [8, 25]) {
      const m = await measure(page, zoom);
      const want = 2 * m.ppm;
      check(`${label}, ${zoom}× : 1 m à 500 m se projette sur 2 mrad du réticule (matrice de la caméra)`, Math.abs(m.proj / want - 1) < 0.002 && Math.hypot(m.c0[0] - m.view.cx, m.c0[1] - m.view.cy) < 0.3, `${m.proj.toFixed(2)} px pour ${want.toFixed(2)} px (${m.ppm.toFixed(2)} px/mrad), ligne de visée à ${Math.hypot(m.c0[0] - m.view.cx, m.c0[1] - m.view.cy).toFixed(2)} px du centre optique`);
      const tol = 1.6 + want * 0.04;
      check(`${label}, ${zoom}× : sur l'image rendue, le disque de 1 m mesure 2 mrad, centré sur le centre optique`, m.n > 8 && Math.abs(m.w - want) < tol && Math.abs(m.h - want) < tol && Math.hypot(m.cx - m.view.cx, m.cy - m.view.cy) < 1.5, `${m.w.toFixed(1)} × ${m.h.toFixed(1)} px mesurés pour ${want.toFixed(1)} px ; centre mesuré (${m.cx.toFixed(1)} ; ${m.cy.toFixed(1)}), centre optique (${m.view.cx.toFixed(1)} ; ${m.view.cy.toFixed(1)})`);
      check(`${label}, ${zoom}× : branches du réticule sur le centre optique (encre à 1, 2, 3 mrad) ; même champ réel que l'écran de référence`, m.dots.every((a) => a > 120) && m.gaps.every((a) => a < 40) && Math.abs(m.field / REF - 1) < 0.002, `demi-champ ${(m.field / zoom).toFixed(2)} mrad à ${zoom}× (référence ${(REF / zoom).toFixed(2)})`);
    }
    check(`${label} : aucune erreur`, errors.length === 0, errors.join(' | '));
    await page.context().close();
  }
}

// =====================================================================================================
// tutoriel en portrait : la carte ne masque ni le champ ni les commandes
// =====================================================================================================
if (!(await hasTutorial())) console.log('\n— tutoriel au doigt : niveau sans tutoriel (data.tutorial nul), contrôles sautés —');
else {
  console.log('\n— tutoriel au doigt, portrait 375 × 664 —');
  const { page, fingers, errors } = await mobilePage(browser, { width: 375, height: 664 }, 'fs=0&d=assist&dr=0&play', { dsf: 3 });
  await tapText(page, fingers, 'Continuer');
  await sleep(1500);
  let s = await G(page, () => ({ st: window.hr.game.state, step: window.hr.game.tutorial?.stepId, card: document.querySelector('.tuto').innerText, vis: !document.querySelector('.tuto').classList.contains('hidden') }));
  check('tutoriel lancé par défaut à la première partie (Assisté)', s.st === 'play' && s.step === 'look' && s.vis && /Tutoriel · 1 \/ 17/i.test(s.card), s.card.replace(/\s+/g, ' ').slice(0, 90));
  check('tutoriel : commande tactile du portrait, pas de touche ni de « moitié droite »', /pouce droit/i.test(s.card) && !/Souris|moitié/i.test(s.card), s.card.replace(/\s+/g, ' ').slice(-60));
  await geometry(page, 'tutoriel', NONE);
  await shot(page, 'tutoriel');
  await G(page, () => { window.hr.game.tutorial.index = 1; });
  await sleep(400);
  s = await G(page, () => document.querySelector('.tuto').innerText.replace(/\s+/g, ' '));
  check('tutoriel « Se déplacer » : manette sous le pouce gauche, en bas de l’écran', /pouce gauche en bas/i.test(s) && !/moitié/i.test(s), s.slice(-70));
  // étapes en lunette : la carte passe au-dessus du champ, qui descend ; bouton mis en évidence
  for (const id of ['wind', 'book', 'elev', 'impact']) {
    await G(page, (id) => {
      const g = window.hr.game, t = g.tutorial;
      g.player.teleport(...window.hr.level.testTouch.post, 'prone');
      g.scope.enter(1.75, 0);
      g.rifle.zoom = 10;
      g.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near));
      t.index = ['look', 'move', 'go', 'prone', 'scope', 'zoom', 'wind', 'range', 'mrad', 'book', 'elev', 'breath', 'fire', 'impact'].indexOf(id);
      t.flags.aimed = 0; t.flags.book = false;
      if (id === 'impact') t.onImpact(false);
      g.rifle.elevClicks = id === 'elev' ? 0 : g.rifle.elevClicks;
    }, id);
    await sleep(id === 'wind' ? 350 : 900);
    await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
    s = await G(page, () => { const c = document.querySelector('.tuto').getBoundingClientRect(), v = window.hr.engine.view; return { step: window.hr.game.tutorial.stepId, halo: [...document.querySelectorAll('#touch .tb.halo')].map((e) => e.dataset.tb), card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' '), above: c.bottom <= v.cy - v.R + 0.5, ratio: (2 * v.R) / window.innerWidth, h: c.height }; });
    const wantHalo = id !== 'wind';
    check(`tutoriel en lunette, étape « ${id} » : carte au-dessus du champ${wantHalo ? ', bouton mis en évidence par un halo' : ''}`, s.step === id && s.above && (!wantHalo || s.halo.length > 0) && s.ratio > 0.84, `carte ${Math.round(s.h)} px, champ ${(s.ratio * 100).toFixed(1)} % de la largeur${wantHalo ? ', halo : ' + s.halo.join(', ') : ''}`);
    if (id === 'wind') check('tutoriel « Lire le vent » : le vent se lit « sous la lunette »', /sous la lunette/i.test(s.card) && !/en haut à droite/i.test(s.card), s.card.slice(0, 110));
    if (id === 'book') check('tutoriel « Carnet » : bouton situé « en haut à gauche de la lunette »', /en haut à gauche de la lunette/i.test(s.card), s.card.slice(-60));
    await geometry(page, `tutoriel en lunette (${id})`, NONE);
    if (id === 'elev') await shot(page, 'tutoriel-lunette');
    if (id === 'impact') await shot(page, 'tutoriel-corriger');
    if (id === 'wind') await shot(page, 'tutoriel-vent');
  }
  await tapSel(page, fingers, '.tuto-skip');
  await sleep(500);
  s = await G(page, () => ({ t: window.hr.game.tutorial.skipped, vis: !document.querySelector('.tuto').classList.contains('hidden'), pref: localStorage.getItem('hr.tuto'), top: window.hr.engine.view.cy - window.hr.engine.view.R }));
  check('« Passer » au doigt : tutoriel retiré, choix mémorisé, le champ remonte en haut de l’écran', s.t && !s.vis && s.pref === 'off' && s.top < 8, JSON.stringify(s));
  check('aucune erreur dans la console', errors.length === 0, [...new Set(errors)].join(' | '));
  await page.context().close();
}

// =====================================================================================================
// autres téléphones : tour des écrans, géométrie hors lunette et en lunette
// =====================================================================================================
async function tour(label, tag, vp, notch, dsf, extra = '') {
  console.log(`\n— ${label}, ${vp.width} × ${vp.height} —`);
  const { page, fingers, errors } = await mobilePage(browser, vp, 'fs=0&d=assist&dr=0&tuto=0' + extra, { dsf, notch });
  let s = await G(page, () => { const e = window.hr.engine, c = e.renderer.domElement; return { cls: document.documentElement.className, ts: Number(getComputedStyle(document.documentElement).getPropertyValue('--ts')), px: c.width * c.height, pr: e.pixelRatio, base: e.view.baseFov, fs: !!document.querySelector('#menu .m-fs'), can: typeof document.documentElement.requestFullscreen === 'function', lock: typeof screen.orientation?.lock === 'function', tip: document.querySelector('#menu .hometip')?.innerText ?? null }; });
  const hf = 2 * Math.atan(Math.tan((s.base * Math.PI) / 360) * (vp.width / vp.height)) * 180 / Math.PI;
  check(`${tag} : mise en page portrait, pas d’écran de rotation ; ≤ 1,6 M de pixels rendus ; champ horizontal ≥ 45°`, /\bportrait\b/.test(s.cls) && !/\bturn\b/.test(s.cls) && s.px <= 1.6e6 && hf >= 45 && hf <= 56, `--ts ${s.ts}, ratio ${s.pr.toFixed(2)}, ${(s.px / 1e6).toFixed(2)} M de pixels, champ ${s.base.toFixed(1)}° × ${hf.toFixed(1)}°`);
  await screenOk(page, `${tag} menu`, notch);
  await shot(page, `${tag}-menu`);
  await tapText(page, fingers, 'Commandes'); await sleep(400);
  await screenOk(page, `${tag} commandes`, notch);
  await shot(page, `${tag}-commandes`);
  await tapText(page, fingers, 'Retour');
  await tapText(page, fingers, 'Commencer'); await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 }); await sleep(700);
  await screenOk(page, `${tag} briefing`, notch);
  await shot(page, `${tag}-briefing`);
  await tapText(page, fingers, 'Continuer'); await sleep(1300);
  await geometry(page, `${tag} jeu`, notch);
  await shot(page, `${tag}-jeu`);
  await G(page, () => window.hr.game.player.teleport(...window.hr.level.testTouch.post, 'stand'));
  await tapSel(page, fingers, tb('prone')); await sleep(1300);
  await tapSel(page, fingers, tb('aim')); await sleep(700);
  await G(page, () => { const g = window.hr.game; g.rifle.zoom = 12; g.rifle.clickElev(14); g.mission.alert = 35; g.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)); });
  await sleep(700);
  await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
  check(`${tag} : lunette active, point d’impact prédit affiché (Assisté)`, await G(page, () => window.hr.game.scope.active && !!window.hr.game.ui.reticle.predict));
  await geometry(page, `${tag} lunette`, notch);
  await shot(page, `${tag}-lunette`);
  await tapSel(page, fingers, tb('book')); await sleep(600);
  await screenOk(page, `${tag} carnet`, notch);
  await shot(page, `${tag}-carnet`);
  await tapText(page, fingers, 'Fermer');
  await tapSel(page, fingers, tb('pause')); await sleep(500);
  await screenOk(page, `${tag} pause`, notch);
  await shot(page, `${tag}-pause`);
  await tapText(page, fingers, 'Reprendre');
  await G(page, () => { const g = window.hr.game; g.scope.exit(); g.player.teleport(...window.hr.level.testTouch.rack, 'stand'); });
  await sleep(600);
  await geometry(page, `${tag} jeu près du râtelier`, notch);
  await tapSel(page, fingers, tb('rack')); await sleep(600);
  await screenOk(page, `${tag} râtelier`, notch);
  await shot(page, `${tag}-ratelier`);
  await tapText(page, fingers, 'Fermer');
  // tutoriel en lunette sur cet écran
  await G(page, () => { const g = window.hr.game; g.ui.fail('La cible s’est fondue dans la foule en fuite.'); g.setState('fail'); });
  await sleep(600);
  await screenOk(page, `${tag} échec`, notch);
  await shot(page, `${tag}-echec`);
  check(`${tag} : aucune erreur dans la console`, errors.length === 0, [...new Set(errors)].join(' | '));
  await page.context().close();
  return s;
}
await tour('iPhone, écran d’accueil (île et barre d’accueil simulées)', '390', { width: 390, height: 844 }, NOTCH, 3, '&a2hs=0');
{
  const s = await tour('iPhone Pro Max dans Safari hors écran d’accueil simulé (île, barre d’accueil)', '430', { width: 430, height: 932 }, { ...NOTCH, top: 59 }, 3, '&a2hs=1');
  check('astuce « écran d’accueil » : une ligne discrète au bas du menu', !!s.tip && /écran d’accueil/i.test(s.tip) && s.tip.length < 90, String(s.tip));
}
{
  const s = await tour('Android', 'android', { width: 412, height: 780 }, NONE, 2.625);
  check('Android : plein écran disponible (Chromium), bouton « Plein écran » proposé, API de verrouillage présente, pas d’astuce iPhone', s.fs === s.can && s.can && s.lock && s.tip === null, JSON.stringify(s));
}

// =====================================================================================================
// tablette : portrait et paysage sont jouables
// =====================================================================================================
{
  console.log('\n— tablette, 820 × 1180 puis 1180 × 820 —');
  const { page, fingers, errors } = await mobilePage(browser, { width: 820, height: 1180 }, 'fs=0&d=standard&dr=0&tuto=0&play', { dsf: 2 });
  await tapText(page, fingers, 'Continuer');
  await sleep(1000);
  await G(page, () => window.hr.game.player.teleport(...window.hr.level.testTouch.post, 'stand'));
  await tapSel(page, fingers, tb('prone')); await sleep(1300);
  await tapSel(page, fingers, tb('aim')); await sleep(700);
  await G(page, () => { window.hr.game.rifle.zoom = 12; window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)); });
  await sleep(600);
  let s = await G(page, () => ({ cls: document.documentElement.className, ts: Number(getComputedStyle(document.documentElement).getPropertyValue('--ts')), fire: document.querySelector('[data-tb=fire]').getBoundingClientRect().width, px: window.hr.engine.renderer.domElement.width * window.hr.engine.renderer.domElement.height }));
  check('tablette à la verticale : mise en page portrait, boutons agrandis, ≤ 1,6 M de pixels', /\bportrait\b/.test(s.cls) && !/\bturn\b/.test(s.cls) && s.ts > 1.3 && s.fire > 100 && s.px <= 1.6e6, `--ts ${s.ts}, Tirer ${Math.round(s.fire)} px, ${(s.px / 1e6).toFixed(2)} M de pixels`);
  await geometry(page, 'tablette verticale, lunette', NONE);
  await shot(page, 'tablette-portrait-lunette');
  await page.setViewportSize({ width: 1180, height: 820 });
  await sleep(700);
  await G(page, () => window.hr.game.autoAim((window.hr.level.testTouch.near ?? window.hr.level.tutorial.near)));
  await sleep(300);
  s = await G(page, () => ({ cls: document.documentElement.className, st: window.hr.game.state, blocked: window.hr.game.blocked, disp: getComputedStyle(document.getElementById('rotate')).display, view: window.hr.engine.view, off: window.hr.engine.camera.view?.enabled === true, fire: document.querySelector('[data-tb=fire]').getBoundingClientRect().width }));
  check('tablette à l’horizontale : pas d’écran de rotation, partie non interrompue, mise en page paysage (champ centré)', !/\bportrait\b|\bturn\b/.test(s.cls) && s.st === 'play' && !s.blocked && s.disp === 'none' && !s.view.portrait && Math.abs(s.view.cy - 410) < 0.5 && Math.abs(s.view.R - 0.462 * 820) < 0.5 && !s.off, JSON.stringify(s.view));
  const r = await layoutReport(page, NONE);
  check('tablette à l’horizontale : rien ne se chevauche, rien hors écran', s.fire > 100 && r.overlaps.length === 0 && r.unsafe.length === 0 && r.small.length === 0, [...r.overlaps, ...r.unsafe, ...r.small].join(' ; '));
  await shot(page, 'tablette-paysage-lunette');
  check('aucune erreur dans la console', errors.length === 0, [...new Set(errors)].join(' | '));
  await page.context().close();
}

// =====================================================================================================
// cadence en émulation (information, pas un contrôle) : coût d'une image en portrait, qualité basse
// =====================================================================================================
{
  console.log('\n— cadence mesurée en émulation (Chromium sur l’ordinateur de test, pas un téléphone) —');
  const REP = 4;
  for (const [label, vp] of [['375 × 664', { width: 375, height: 664 }], ['430 × 932', { width: 430, height: 932 }]]) {
    const { page } = await mobilePage(browser, vp, `fs=0&d=standard&dr=0&tuto=0&play&test&rep=${REP}`, { dsf: 3 });
    await G(page, () => window.hr.game.continueBrief());
    for (const view of ['cour, caméra à l’épaule', 'lunette 18× sur le marché']) {
      await G(page, async (scope) => {
        const g = window.hr.game;
        if (!scope) { g.scope.exit(); g.player.teleport(...window.hr.level.testTouch.yard, 'stand'); }
        else { const C = window.hr.level.testTouch.crowd; g.equip(C.weapon); g.player.teleport(...C.at); g.scope.enter(0, -0.2); g.rifle.zoom = 18; await new Promise((r) => setTimeout(r, 300)); g.autoAim(C.target); }
      }, view.startsWith('lunette'));
      await sleep(1500);
      const r = await G(page, async () => { const g = window.hr.game, e = g.engine; const n0 = g.perf.frames, t0 = performance.now(); await new Promise((r) => setTimeout(r, 2500)); const ms = (performance.now() - t0) / (g.perf.frames - n0); const c = e.renderer.domElement; return { ms, calls: e.stats.calls, tris: e.stats.tris, pr: e.pixelRatio, px: c.width * c.height }; });
      // chaque image affichée est rendue REP fois : à 60 images/s affichées, le coût d'un rendu est ≤ 16,7 / REP ms
      const capped = r.ms < 17.4;
      console.log(`INFO   ${label}, ${view} : ${capped ? '≤ ' : ''}${(r.ms / REP).toFixed(1)} ms par image rendue (${capped ? `60 images/s tenues avec ${REP} rendus par image : plafond d'affichage atteint` : `${Math.round(1000 / (r.ms / REP))} images/s possibles`}), ${r.calls} appels, ${(r.tris / 1e6).toFixed(2)} M de triangles, ratio ${r.pr.toFixed(2)}, ${(r.px / 1e6).toFixed(2)} M de pixels`);
    }
    await page.context().close();
  }
}

await browser.close();
console.log(`\n${total - fails} contrôles réussis sur ${total}`);
process.exit(fails ? 1 : 0);
