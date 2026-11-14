// Outils communs aux scripts tactiles : contexte mobile Playwright, vrais événements tactiles multi-doigts
// envoyés par le protocole CDP (Input.dispatchTouchEvent), contrôles géométriques (chevauchements, encoches).
import { chromium } from 'playwright';
import { LEVEL, LQ } from './levellib.mjs';

export const BASE = process.env.HR_URL || 'http://127.0.0.1:5173/';
/** adresse du jeu pour une requête donnée, sur le niveau demandé (--level, standard par défaut) */
export const gameUrl = (query) => BASE + '?' + query + (query ? '&' : '') + LQ;
/**
 * Les scénarios tactiles lisent leurs positions dans data.testTouch (et data.tutorial s'il existe) : sans testTouch,
 * le scénario ne peut pas être joué sur ce niveau. Le scénario du tutoriel (e2e/tutorial.mjs) exige data.tutorial :
 * il met `scenario.needTutorial` à vrai. e2e/mobile.mjs s'en passe (niveau sans tutoriel : ses contrôles sont sautés).
 */
export const scenario = { needTutorial: false };
export async function assertScenario(page) {
  const s = await page.evaluate(() => ({ id: window.hr.level.id, touch: !!window.hr.level.testTouch, tuto: !!window.hr.level.tutorial }));
  if (s.id !== LEVEL || !s.touch || (scenario.needTutorial && !s.tuto)) { console.log(`! niveau « ${LEVEL} » (chargé : « ${s.id} ») : data.testTouch ${s.touch ? 'présent' : 'absent'}, data.tutorial ${s.tuto ? 'présent' : 'absent'} — scénario non jouable`); process.exit(1); }
}
export const launch = () => chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

/** Île / encoche et barre d'accueil simulées (iPhone tenu à la verticale, page ajoutée à l'écran d'accueil) : marges sûres en pixels CSS. */
export const NOTCH = { left: 0, right: 0, top: 47, bottom: 34 };
/** Safari avec ses barres (zone utile 375 × 664) ou Android : aucune marge. */
export const NONE = { left: 0, right: 0, top: 0, bottom: 0 };

export async function mobilePage(browser, viewport, query, { notch = null, dsf = 2, init = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(gameUrl(query));
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  await assertScenario(page);
  await page.waitForTimeout(1200);
  if (notch) await setNotch(page, notch);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors, fingers: new Fingers(cdp) };
}

/** Impose les marges sûres (comme le ferait env(safe-area-inset-*)) et dessine l'encoche pour les captures. */
export async function setNotch(page, n) {
  await page.evaluate((n) => {
    const r = document.documentElement.style;
    r.setProperty('--sal', n.left + 'px');
    r.setProperty('--sar', n.right + 'px');
    r.setProperty('--sat', n.top + 'px');
    r.setProperty('--sab', n.bottom + 'px');
    document.getElementById('fake-notch')?.remove();
    const d = document.createElement('div');
    d.id = 'fake-notch';
    d.style.cssText = 'position:fixed;inset:0;z-index:99;pointer-events:none';
    d.innerHTML = (n.top ? `<i style="position:absolute;left:calc(50% - 62px);top:11px;width:124px;height:${Math.max(20, n.top - 22)}px;background:#000;border-radius:20px"></i>` : '')
      + (n.bottom ? `<i style="position:absolute;left:calc(50% - 72px);bottom:8px;width:144px;height:5px;border-radius:3px;background:rgba(255,255,255,.7)"></i>` : '');
    document.body.appendChild(d);
    // le jeu relit les marges pour placer le champ de la lunette
    window.dispatchEvent(new Event('resize'));
  }, n);
  await page.waitForTimeout(150);
}

/** Doigts simulés : chaque doigt a un identifiant ; les événements portent toujours tous les doigts posés. */
export class Fingers {
  constructor(cdp) { this.cdp = cdp; this.pts = new Map(); }
  async send(type) {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1 })) });
  }
  async down(id, x, y) { this.pts.set(id, { x, y }); await this.send('touchStart'); }
  async move(id, x, y) { this.pts.set(id, { x, y }); await this.send('touchMove'); }
  /** lève un doigt : s'il en reste, CDP l'exprime par un touchMove sans ce point (touchEnd doit être vide) */
  async up(id) {
    this.pts.delete(id);
    if (this.pts.size) await this.send('touchMove');
    else await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async cancel() { this.pts.clear(); await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); }
  /** glisse un doigt posé jusqu'à (x, y) en plusieurs pas */
  async slide(id, x, y, steps = 8, pause = 16) {
    const p = this.pts.get(id);
    const x0 = p.x, y0 = p.y;
    for (let i = 1; i <= steps; i++) {
      await this.move(id, x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
      await new Promise((r) => setTimeout(r, pause));
    }
  }
  async tap(x, y, id = 9, hold = 50) {
    await this.down(id, x, y);
    await new Promise((r) => setTimeout(r, hold));
    await this.up(id);
  }
}

/** centre d'un élément visible (sélecteur CSS), en pixels CSS */
export async function center(page, sel) {
  const r = await page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (b.width < 1 || b.height < 1 || cs.display === 'none' || cs.visibility === 'hidden') return null;
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
  }, sel);
  if (!r) throw new Error('élément absent ou invisible : ' + sel);
  return r;
}
export const tb = (id) => `#touch [data-tb="${id}"]`;
export async function tapSel(page, fingers, sel, hold = 50) {
  const c = await center(page, sel);
  await fingers.tap(c.x, c.y, 9, hold);
  await page.waitForTimeout(120);
  return c;
}
/** bouton dont le texte contient `text`, dans l'écran affiché */
export async function tapText(page, fingers, text) {
  const c = await page.evaluate((text) => {
    const all = [...document.querySelectorAll('.screen.on button, .screen.on [data-act]')];
    const e = all.find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()) && b.getBoundingClientRect().width > 0);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, text);
  if (!c) throw new Error('bouton introuvable : ' + text);
  await fingers.tap(c.x, c.y);
  await page.waitForTimeout(350);
}

/** boutons tactiles visibles */
export const visibleButtons = (page) => page.evaluate(() => [...document.querySelectorAll('#touch [data-tb]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).display !== 'none'; }).map((e) => e.dataset.tb));

/**
 * Géométrie de l'interface en jeu : chevauchements entre boutons et blocs du HUD, éléments hors de la zone sûre
 * (encoche, barre d'accueil) ou hors de l'écran, boutons de moins de 44 px.
 */
export const layoutReport = (page, notch) => page.evaluate((n) => {
  const W = window.innerWidth, H = window.innerHeight;
  const safe = { l: n.left, t: n.top, r: W - n.right, b: H - n.bottom };
  const items = [];
  const vis = (e) => {
    if (!e) return false;
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const add = (name, e, kind) => {
    if (!vis(e)) return;
    // le texte seul compte pour les blocs du HUD (leur boîte peut être plus large que ce qui est écrit)
    let b = e.getBoundingClientRect();
    if (kind === 'hud') {
      const rg = document.createRange();
      rg.selectNodeContents(e);
      const rb = rg.getBoundingClientRect();
      if (rb.width > 0) b = rb;
    }
    if (kind === 'hud' && !e.textContent.trim() && !e.querySelector('i')) return;
    items.push({ name, kind, l: b.left, t: b.top, r: b.right, b: b.bottom });
  };
  document.querySelectorAll('#touch [data-tb]').forEach((e) => add('bouton ' + e.dataset.tb, e, 'btn'));
  document.querySelectorAll('#touch output').forEach((e) => add('valeur ' + e.dataset.o, e, 'hud'));
  document.querySelectorAll('#touch .tl-row small').forEach((e, i) => add('libellé tourelle ' + i, e, 'hud'));
  const hud = document.getElementById('hud');
  if (hud.classList.contains('on')) {
    for (const [name, sel] of [['objectif', '.tl'], ['état (haut droit)', '.tr'], ['arme', '.bl'], ['pouls et souffle', '.br'], ['invite', '.bc .prompt'], ['boussole', '.compass .way'], ['tutoriel', '.tuto']]) {
      add(name, hud.querySelector(sel), sel === '.tuto' ? 'btn' : 'hud');
    }
    const tape = hud.querySelector('.compass .tape');
    if (vis(tape) && !hud.querySelector('.compass').classList.contains('off')) { const b = tape.getBoundingClientRect(); items.push({ name: 'ruban de boussole', kind: 'hud', l: b.left + b.width * 0.18, t: b.top, r: b.right - b.width * 0.18, b: b.bottom }); }
  }
  const overlaps = [], unsafe = [], small = [], inField = [];
  // portrait, en lunette : rien ne doit recouvrir le champ circulaire
  const v = window.hr.engine.view;
  const scope = v.portrait && document.getElementById('touch').classList.contains('scope');
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (scope) {
      const dx = Math.max(a.l - v.cx, 0, v.cx - a.r), dy = Math.max(a.t - v.cy, 0, v.cy - a.b);
      if (Math.hypot(dx, dy) < v.R - 1) inField.push(`${a.name} (à ${Math.round(Math.hypot(dx, dy))} px du centre, rayon ${Math.round(v.R)})`);
    }
    if (a.l < safe.l - 0.5 || a.r > safe.r + 0.5 || a.t < safe.t - 0.5 || a.b > safe.b + 0.5) unsafe.push(`${a.name} [${Math.round(a.l)},${Math.round(a.t)} → ${Math.round(a.r)},${Math.round(a.b)}]`);
    if (a.kind === 'btn' && a.name.startsWith('bouton') && (a.r - a.l < 43.5 || a.b - a.t < 43.5)) small.push(`${a.name} ${Math.round(a.r - a.l)}×${Math.round(a.b - a.t)}`);
    for (let j = i + 1; j < items.length; j++) {
      const c = items[j];
      const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (ox > 1.5 && oy > 1.5) overlaps.push(`${a.name} × ${c.name} (${Math.round(ox)}×${Math.round(oy)} px)`);
    }
  }
  const field = scope ? { cx: v.cx, cy: v.cy, R: v.R, ratio: (2 * v.R) / W, top: v.cy - v.R, bottom: v.cy + v.R } : null;
  return { count: items.length, names: items.map((i) => i.name), overlaps, unsafe, small, inField, field };
}, notch);

/** écran plein cadre affiché : carte dans la zone sûre, cibles tactiles ≥ 44 px, pas de touche clavier mentionnée */
export const screenReport = (page, notch) => page.evaluate((n) => {
  const W = window.innerWidth, H = window.innerHeight;
  const scr = document.querySelector('.screen.on');
  if (!scr) return null;
  const card = scr.querySelector('.card') || scr;
  const b = card.getBoundingClientRect();
  const out = { id: scr.id, card: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], inSafe: true, small: [], keys: [], clipped: [] };
  if (scr.id !== 'menu') out.inSafe = b.left >= n.left - 0.5 && b.right <= W - n.right + 0.5 && b.top >= n.top - 0.5 && b.bottom <= H - n.bottom + 0.5;
  const scrollerOf = (e) => e.closest('.scroll');
  scr.querySelectorAll('button, input').forEach((e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || getComputedStyle(e).display === 'none') return;
    if (r.height < 43.5 || r.width < 43.5) out.small.push(`${(e.textContent || e.type).trim().slice(0, 18)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    // hors écran sans pouvoir y défiler : inatteignable
    const s = scrollerOf(e);
    const canScroll = s && s.scrollHeight > s.clientHeight + 1;
    if (!canScroll && (r.left < n.left - 0.5 || r.right > W - n.right + 0.5 || r.top < -0.5 || r.bottom > H - n.bottom + 0.5)) out.clipped.push(`${(e.textContent || e.type).trim().slice(0, 18)} [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`);
  });
  const text = scr.innerText;
  for (const k of ['Clic', 'Tab', 'Échap', 'Entrée', 'Molette', 'Souris', 'Maj ', 'clavier', 'Z Q S D']) if (text.includes(k)) out.keys.push(k);
  return out;
}, notch);
