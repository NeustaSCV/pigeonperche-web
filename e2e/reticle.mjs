// Réticule de la lunette : exactitude mesurée en jeu, coût de dessin, et captures.
// Usage : HR_URL=<copie figée> [HR_AVANT=<copie de l'ancien réticule>] node e2e/reticle.mjs [--shots]
//   Mesures (toujours) : à plusieurs grossissements, sur ordinateur et en portrait tactile, la position mesurée de
//   chaque repère du réticule (centre de gravité de ses pixels dans le canvas) est comparée à la projection, par la
//   caméra du jeu, d'un point du monde placé à N mrad de la ligne de visée. Le réticule n'est redessiné que si la
//   vue ou le grossissement change. Le losange du point d'impact prédit est à sa place.
//   --shots : captures dans e2e/out/reticule/ (réticule seul sur fonds clair et sombre, en jeu) ; avec HR_AVANT,
//   chaque capture est montée côte à côte avec l'ancien réticule.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const URL = process.env.HR_URL || 'http://127.0.0.1:5173/';
const AVANT = process.env.HR_AVANT || '';
const SHOTS = process.argv.includes('--shots');
const OUT = 'e2e/out/reticule';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let ok = true;
const check = (label, pass, detail = '') => { console.log(`${pass ? '  ok ' : '  !! '} ${label}${detail ? ' — ' + detail : ''}`); if (!pass) ok = false; };
const errors = [];

const VIEWS = {
  ordinateur: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  retina: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  portrait: { viewport: { width: 375, height: 664 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
async function open(base, view, query) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(base + '?dr=0&q=low&play&test&' + (view === 'portrait' ? 'fs=0&' : '') + query);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
  await page.waitForTimeout(400);
  return page;
}
/** installe le tireur au poste d'un objectif du plan de tir, en lunette, tourelles réglées pour la cible */
const setup = (page, o) => page.evaluate(async ({ step, target, weapon, zoom }) => {
  const g = window.hr.game, L = window.hr.level;
  const P = L.testPlan.find((p) => p.step === step) ?? L.testPlan[0];
  const p = L.posts[P.post];
  g.equip(weapon ?? P.weapon);
  g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0);
  g.player.heartRate = 60;
  g.scope.enter(0, 0);
  g.rifle.zoom = Math.min(g.rifle.def.scope[1], Math.max(g.rifle.def.scope[0], zoom ?? P.zoom));
  const id = target ?? P.targets[0];
  g.testPrepare?.(id);
  await new Promise((r) => setTimeout(r, 500));
  g.testDial(id);
  await new Promise((r) => setTimeout(r, 350));
  return g.testDial(id);
}, o);

// =====================================================================================================
// 1. exactitude : repères du réticule contre la projection de la caméra
// =====================================================================================================
const measure = (page, mag) => page.evaluate((mag) => {
  const g = window.hr.game, e = g.engine, v = e.view, cam = e.camera, r = g.ui.reticle;
  g.timeScale = 0;
  g.rifle.zoom = mag;
  g.step(0, 0);
  e.render(0, 16);
  r.predict = null;
  r.draw(cam.fov, 1, v);
  const c = r.canvas, k = c.width / v.w, ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height), A = (x, y) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3]);
  // projection d'un point du monde à (mx ; my) mrad de la ligne de visée (my > 0 : sous le centre), en px CSS
  const V = cam.position.constructor;
  const eye = g.player.eye(new V()), los = g.scope.lineOfSight(new V());
  const right = new V().crossVectors(los, cam.up).normalize(), up = new V().crossVectors(right, los).normalize();
  const proj = (mx, my) => { const q = eye.clone().addScaledVector(los, 1000).addScaledVector(right, mx).addScaledVector(up, -my).project(cam); return [(q.x * 0.5 + 0.5) * v.w, (1 - (q.y * 0.5 + 0.5)) * v.h]; };
  const ppm = e.pxPerMil();
  // centre de gravité de l'encre dans une fenêtre (px CSS), en px CSS. `inner` : la fenêtre est réduite aux pixels
  // entièrement compris entre ses bornes sur cet axe ('x' ou 'y'), pour ne pas mordre sur un repère voisin
  const centroid = (x0, y0, x1, y1, inner) => {
    let s = 0, sx = 0, sy = 0;
    const X0 = inner === 'x' ? Math.ceil(x0 * k) : Math.floor(x0 * k), X1 = inner === 'x' ? Math.floor(x1 * k) : Math.ceil(x1 * k);
    const Y0 = inner === 'y' ? Math.ceil(y0 * k) : Math.floor(y0 * k), Y1 = inner === 'y' ? Math.floor(y1 * k) : Math.ceil(y1 * k);
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const a = A(x, y); if (a > 24) { s += a; sx += a * (x + 0.5); sy += a * (y + 0.5); } }
    return s > 0 ? [sx / s / k, sy / s / k, s] : null;
  };
  const inField = (p) => Math.hypot(p[0] - v.cx, p[1] - v.cy) < v.R - 10;
  const out = { mag, ppm, fov: cam.fov, half: v.R / ppm, marks: [], centre: null, n: 0, max: 0 };
  const c0 = proj(0, 0);
  out.centre = Math.hypot(c0[0] - v.cx, c0[1] - v.cy);
  const add = (kind, mx, my, got, want, axis) => {
    const err = axis === 'x' ? got[0] - want[0] : axis === 'y' ? got[1] - want[1] : Math.hypot(got[0] - want[0], got[1] - want[1]);
    out.marks.push({ kind, mx, my, err });
    out.n++; out.max = Math.max(out.max, Math.abs(err));
  };
  // graduations entières de la branche horizontale : bande au-dessus du trait, au-delà des traits fins de 0,2 mrad
  for (const s of [-1, 1]) for (let n = 1; n <= 10; n++) {
    const want = proj(s * n, 0);
    if (!inField(want)) continue;
    const got = centroid(want[0] - 0.09 * ppm - 1.5, v.cy - 0.3 * ppm, want[0] + 0.09 * ppm + 1.5, v.cy - 0.16 * ppm, 'y');
    if (got) add('trait horizontal', s * n, 0, got, want, 'x');
  }
  // graduations entières des branches haute (± 0,25) et basse (± 0,2) : bande à droite du trait, au-delà des demi-mrad
  for (let n = -10; n <= 24; n++) {
    if (n === 0) continue;
    const want = proj(0, n);
    if (!inField(want)) continue;
    const got = centroid(v.cx + 0.13 * ppm, want[1] - 0.09 * ppm - 1.5, v.cx + 0.2 * ppm, want[1] + 0.09 * ppm + 1.5, 'x');
    if (got) add('trait vertical', 0, n, got, want, 'y');
  }
  // points de dérive de l'arbre (un par mrad)
  for (let drop = 1; drop <= 24; drop++) for (const s of [-1, 1]) for (let n = 1; n <= Math.min(6, 1 + Math.ceil(drop / 2)); n++) {
    const want = proj(s * n, drop);
    if (!inField(want)) continue;
    const w = 0.3 * ppm;
    const got = centroid(want[0] - w, want[1] - w, want[0] + w, want[1] + w);
    if (got && got[2] > 300 && A(Math.floor(want[0] * k), Math.floor(want[1] * k)) > 100) add('point de dérive', s * n, drop, got, want, 'xy');
  }
  // début des barres épaisses (10,5 mrad à gauche, à droite et en haut ; 25 mrad en bas) : quantité d'encre le long
  // d'une rangée de pixels prise dans la barre, hors de la branche fine
  const full = 0.9 * 255;
  const edge = (dx, dy, start) => {
    const want = proj(dx * start, dy * start), far = Math.min(v.R - 12, (start + 6) * ppm);
    if (far <= start * ppm + 3) return;
    let ink = 0;
    const o = 0; // rangée de pixels qui touche l'axe de la barre
    const from = Math.round((start - 0.25) * ppm * k), to = Math.round(far * k);
    for (let i = from; i < to; i++) { const a = A(Math.round(v.cx * k) + (dx ? (dx > 0 ? i : -i - 1) : o), Math.round(v.cy * k) + (dy ? (dy > 0 ? i : -i - 1) : o)); if (a > 60) ink += Math.min(full, a) / full; }
    const got = (to - ink) / k; // distance au centre du début de la barre, px CSS
    const w = dx ? Math.abs(want[0] - v.cx) : Math.abs(want[1] - v.cy);
    out.marks.push({ kind: 'début de barre', mx: dx * start, my: dy * start, err: got - w });
    out.n++; out.max = Math.max(out.max, Math.abs(got - w));
  };
  if (r.draws !== undefined) { edge(1, 0, 10.5); edge(-1, 0, 10.5); edge(0, -1, 10.5); edge(0, 1, 25); }
  g.timeScale = 1;
  return out;
}, mag);

console.log('— exactitude : repères du réticule contre la projection de la caméra —');
for (const [view, mags] of [['ordinateur', [5, 8, 12, 18, 25, 35]], ['retina', [7, 12, 25, 35]], ['portrait', [7, 12, 25, 35]]]) {
  const page = await open(URL, view, 'level=avance&d=real&w=338lm300');
  await setup(page, { step: 'mile', weapon: '338lm300', zoom: 25 });
  for (const mag of mags) {
    await page.evaluate((m) => { const g = window.hr.game; g.equip(m < 7 ? '300prc' : '338lm300'); g.scope.enter(g.scope.yaw, g.scope.pitch); }, mag);
    await page.waitForTimeout(250);
    const m = await measure(page, mag);
    const kinds = {};
    for (const k of m.marks) { const o = (kinds[k.kind] ??= { n: 0, max: 0 }); o.n++; o.max = Math.max(o.max, Math.abs(k.err)); }
    // tolérances en px CSS : un tiers de pixel pour un repère (moins de 0,02 mrad à 25× sur ordinateur), 0,6 px pour
    // le début d'une barre (mesuré au pixel près par une quantité d'encre)
    const pass = m.n > 0 && m.centre < 0.3 && Object.entries(kinds).every(([k, o]) => o.max < (k === 'début de barre' ? 0.6 : 0.35));
    check(`${view}, ${mag}× (${m.ppm.toFixed(2)} px/mrad, demi-champ ${m.half.toFixed(1)} mrad) : ${m.n} repères à leur valeur`, pass,
      `écart max ${m.max.toFixed(3)} px = ${(m.max / m.ppm).toFixed(4)} mrad ; ` + Object.entries(kinds).map(([k, o]) => `${k} : ${o.n} (max ${o.max.toFixed(3)} px)`).join(' ; ') + ` ; centre optique à ${m.centre.toFixed(3)} px de la ligne de visée`);
  }
  // coût : aucun nouveau tracé tant que rien ne change, un seul par changement de grossissement
  const cost = await page.evaluate(async () => {
    const g = window.hr.game, r = g.ui.reticle;
    if (r.draws === undefined) return null;
    const wait = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    await wait(10);
    const a = r.draws;
    await wait(90);
    const b = r.draws;
    g.rifle.zoom = g.rifle.zoom > 12 ? 10 : 20;
    await wait(30);
    const c = r.draws;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { r.lastKey = ''; r.draw(g.engine.camera.fov, 1, g.engine.view); }
    return { idle: b - a, zoom: c - b, ms: (performance.now() - t0) / 20 };
  });
  if (cost) check(`${view} : réticule redessiné seulement au changement`, cost.idle === 0 && cost.zoom === 1, `90 images sans changement : ${cost.idle} tracé ; changement de grossissement : ${cost.zoom} tracé ; coût d'un tracé complet ${cost.ms.toFixed(2)} ms`);
  await page.context().close();
}

// losange du point d'impact prédit (Assisté) : à l'endroit que le jeu calcule
console.log('— point d’impact prédit —');
for (const view of ['ordinateur', 'portrait']) {
  const page = await open(URL, view, 'level=facile&d=assist&tuto=0');
  await setup(page, {});
  await page.evaluate(() => { window.hr.game.rifle.elevClicks += 12; window.hr.game.rifle.windClicks -= 9; });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const g = window.hr.game, e = g.engine, v = e.view, r = g.ui.reticle;
    g.timeScale = 0; g.step(0, 0);
    const p = r.predict, el = r.canvas.nextElementSibling;
    if (!p || !el) return { p, el: !!el };
    const b = el.getBoundingClientRect(), root = r.canvas.getBoundingClientRect();
    const got = [b.left + b.width / 2 - root.left, b.top + b.height / 2 - root.top], want = [v.cx + p.x, v.cy + p.y];
    return { p, shown: el.style.display !== 'none', err: Math.hypot(got[0] - want[0], got[1] - want[1]), mil: [p.x / e.pxPerMil(), p.y / e.pxPerMil()] };
  });
  check(`${view} : losange affiché sur le point d’impact prédit`, !!m.p && m.shown && m.err < 0.1, m.p ? `prédit à (${m.mil[0].toFixed(2)} ; ${m.mil[1].toFixed(2)}) mrad du centre, losange à ${m.err.toFixed(3)} px de ce point` : 'pas de prédiction');
  if (SHOTS) await page.screenshot({ path: `${OUT}/jeu-${view}-facile-assiste-losange.png` });
  await page.context().close();
}

// =====================================================================================================
// 2. captures
// =====================================================================================================
if (SHOTS) {
  console.log('— captures —');
  const pair = async (name, shoot, title) => {
    const after = await shoot(URL);
    if (!AVANT) { writeFileSync(`${OUT}/${name}.png`, after); return; }
    const before = await shoot(AVANT);
    const p = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:#22262a;font:13px system-ui;color:#dde"><div style="padding:6px 10px">${title}</div><div id="row" style="display:flex;gap:8px;padding:0 8px 8px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:2px 0 4px">AVANT</figcaption><img id="a"></figure><figure style="margin:0"><figcaption style="padding:2px 0 4px">APRÈS</figcaption><img id="b"></figure></div></body>`);
    await p.evaluate(async ([a, b]) => { for (const [id, d] of [['a', a], ['b', b]]) { const i = document.getElementById(id); i.src = 'data:image/png;base64,' + d; await i.decode(); } }, [before.toString('base64'), after.toString('base64')]);
    const size = await p.evaluate(() => { const r = document.getElementById('row'); return [Math.ceil(r.scrollWidth) + 8, Math.ceil(r.getBoundingClientRect().bottom) + 4]; });
    await p.setViewportSize({ width: Math.max(300, size[0]), height: Math.max(200, size[1]) });
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await p.close();
  };
  // réticule seul : le canvas du réticule posé sur un fond uni, recadré (en mrad autour du centre) et agrandi
  const alone = (page, mag, bg, crop, scale) => page.evaluate(({ mag, bg, crop, scale }) => {
    const g = window.hr.game, e = g.engine, v = e.view, r = g.ui.reticle;
    r.predict = null;
    r.lastKey = '';
    r.draw(e.scopeFov(mag), 1, v);
    const ppm = e.pxPerMil(e.scopeFov(mag)), k = r.canvas.width / v.w;
    const box = crop ? [v.cx + crop[0] * ppm, v.cy + crop[1] * ppm, v.cx + crop[2] * ppm, v.cy + crop[3] * ppm] : [v.cx - v.R - 4, v.cy - v.R - 4, v.cx + v.R + 4, v.cy + v.R + 4];
    const c = document.createElement('canvas');
    c.width = Math.round((box[2] - box[0]) * k * scale); c.height = Math.round((box[3] - box[1]) * k * scale);
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.save();
    x.beginPath(); x.arc((v.cx - box[0]) * k * scale, (v.cy - box[1]) * k * scale, v.R * k * scale, 0, 7); x.clip();
    if (bg === 'split') { x.fillStyle = '#c9d6e2'; x.fillRect(0, 0, c.width / 2, c.height); x.fillStyle = '#1b201c'; x.fillRect(c.width / 2, 0, c.width, c.height); } else { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
    x.imageSmoothingEnabled = scale < 1;
    x.drawImage(r.canvas, box[0] * k, box[1] * k, (box[2] - box[0]) * k, (box[3] - box[1]) * k, 0, 0, c.width, c.height);
    x.restore();
    r.lastKey = '';
    return c.toDataURL('image/png').split(',')[1];
  }, { mag, bg, crop, scale });
  const BG = { clair: '#c9d6e2', sec: '#b9a37c', sombre: '#1b201c' };
  for (const view of ['ordinateur', 'retina', 'portrait']) {
    const pages = {};
    for (const base of AVANT ? [URL, AVANT] : [URL]) pages[base] = await open(base, view, 'level=avance&d=real&w=338lm300');
    const k = view === 'ordinateur' ? 1 : 2;
    const shots = [
      // [nom, grossissement, fond, recadrage en mrad, agrandissement]
      ['champ-05x', 5, BG.clair, null, 1 / k], ['champ-12x', 12, BG.sec, null, 1 / k], ['champ-25x', 25, BG.clair, null, 1 / k], ['champ-35x', 35, BG.sec, null, 1 / k],
      ['champ-25x-sombre', 25, BG.sombre, null, 1 / k], ['champ-08x-clair-sombre', 8, 'split', null, 1 / k],
      ['centre-05x', 5, BG.clair, [-14, -12, 14, 14], 3 / k], ['centre-12x', 12, BG.clair, [-7, -5, 7, 7], 3 / k], ['centre-25x', 25, BG.clair, [-4.6, -3, 4.6, 3.6], 3 / k], ['centre-35x', 35, BG.clair, [-3, -2, 3, 2.4], 3 / k],
      ['centre-25x-sombre', 25, BG.sombre, [-4.6, -3, 4.6, 3.6], 3 / k],
      ['arbre-12x', 12, BG.sec, [-8, 0, 8, 26], 2 / k], ['arbre-25x', 25, BG.sec, [-8, 6, 8, 19], 2 / k], ['arbre-25x-sombre', 25, BG.sombre, [-8, 6, 8, 19], 2 / k],
    ];
    for (const [name, mag, bg, crop, scale] of shots) {
      if (view === 'retina' && !/25x|12x/.test(name)) continue;
      await pair(`seul-${view}-${name}`, async (base) => Buffer.from(await alone(pages[base], mag, bg, crop, scale), 'base64'), `Réticule seul · ${view} · ${mag}× · ${crop ? `recadré de ${crop[0]} à ${crop[2]} mrad, agrandi ×${(scale * k).toFixed(0)}` : 'champ entier'}`);
    }
    for (const p of Object.values(pages)) await p.context().close();
  }
  // en jeu
  const scenes = [
    ['jeu-ordinateur-avance-2500m-25x', 'ordinateur', 'level=avance&d=real&step=8', { step: 'extreme', weapon: '50bmg', zoom: 25 }, null],
    ['jeu-ordinateur-avance-2500m-25x-centre', 'ordinateur', 'level=avance&d=real&step=8', { step: 'extreme', weapon: '50bmg', zoom: 25 }, { x: 500, y: 250, width: 600, height: 400 }],
    ['jeu-ordinateur-avance-2500m-408-contre-visee', 'ordinateur', 'level=avance&d=real&step=8', { step: 'extreme', weapon: '408ct', zoom: 25 }, null],
    ['jeu-ordinateur-avance-800m-20x', 'ordinateur', 'level=avance&d=real', { step: 'zero', zoom: 20 }, null],
    ['jeu-ordinateur-facile-proche-10x', 'ordinateur', 'level=facile&d=standard&tuto=0', {}, null],
    ['jeu-ordinateur-standard-proche', 'ordinateur', 'level=standard&d=standard&tuto=0', {}, null],
    ['jeu-portrait-facile-proche-10x', 'portrait', 'level=facile&d=standard&tuto=0', {}, null],
    ['jeu-portrait-avance-2500m-25x', 'portrait', 'level=avance&d=real&step=8', { step: 'extreme', weapon: '50bmg', zoom: 25 }, null],
  ];
  for (const [name, view, query, o, clip] of scenes) {
    await pair(name, async (base) => {
      const page = await open(base, view, query);
      const info = await setup(page, o);
      if (base === URL) console.log(`  ${name} : cible à ${Math.round(info.dist)} m, visible ${info.visible}`);
      await page.evaluate(() => { const g = window.hr.game; g.scope.swayX = g.scope.swayY = 0; });
      const buf = await page.screenshot(clip ? { clip } : {});
      await page.context().close();
      return buf;
    }, `${name}`);
  }
  // fonds réels : ciel (clair) et versant à l'ombre ou sol (sombre), niveau avancé
  for (const [name, pitch] of [['jeu-ordinateur-ciel-12x', 0.12], ['jeu-ordinateur-sol-12x', -0.5]]) {
    await pair(name, async (base) => {
      const page = await open(base, 'ordinateur', 'level=avance&d=real');
      await setup(page, { step: 'zero', zoom: 12 });
      await page.evaluate((pitch) => { const g = window.hr.game; g.scope.pitch = pitch; g.rifle.zoom = 12; }, pitch);
      await page.waitForTimeout(600);
      const buf = await page.screenshot();
      await page.context().close();
      return buf;
    }, name);
  }
}
if (errors.length) { console.log('ERREURS\n' + [...new Set(errors)].join('\n')); ok = false; }
await browser.close();
console.log(ok ? 'réticule : tous les contrôles passent' : 'réticule : ÉCHEC');
process.exit(ok ? 0 : 1);
