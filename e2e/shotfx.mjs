// Effets visuels du coup de feu : captures horodatées, planches avant/après, coût, décompte des appels de dessin.
//
//   node e2e/shotfx.mjs capture --tag apres [--level facile] [--portrait] [--cal 22lr,308,338lm,408ct,50bmg] [--vue couche,accroupi,lunette]
//       images à 0, 17, 50, 150, 400 ms et 1 s du départ du coup (horloge d'images pilotée à la main, 60 i/s)
//       → e2e/out/tir/brut/<tag>/<niveau>_<bureau|portrait>_<calibre>_<vue>_<ms>.png, et cout-<…>.json
//       --sans-poussiere : vide les particules à chaque image (pour juger le reste : flamme, recul, douille)
//   node e2e/shotfx.mjs planches [--tags avant,apres]
//       → e2e/out/tir/<niveau>_<bureau|portrait>_<calibre>_<vue>.jpg : une ligne par état, une colonne par instant
//   node e2e/shotfx.mjs cout --tag apres [--level facile] [--portrait] [--cal 50bmg] [--vue couche,lunette]
//       temps réel : temps par image avant le tir, pic au premier tir et aux suivants, appels de dessin
//   node e2e/shotfx.mjs appels [--level facile] [--portrait] [--q medium]
//       décompte des appels de dessin par catégorie d'objets, au départ et au poste de tir couché
//
// HR_URL : adresse du jeu (une copie figée : `npx vite build --outDir .tmp/x` puis `npx vite preview --outDir .tmp/x`).
// Le même outil tourne sur l'état d'avant (sans `game.shotFx`) : c'est la ligne « avant » des planches.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || 'capture';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const BASE = process.env.HR_URL || 'http://127.0.0.1:5173/';
const OUT = resolve(here, 'out/tir');
const LEVEL = arg('level', 'facile');
const PORTRAIT = flag('portrait');
const ECRAN = PORTRAIT ? 'portrait' : 'bureau';
const TAG = arg('tag', 'apres');
const CALS = arg('cal', mode === 'cout' ? '50bmg' : '22lr,308,338lm,408ct,50bmg').split(',');
const VUES = arg('vue', mode === 'cout' ? 'couche,lunette' : 'couche,accroupi,lunette').split(',');
const TEMPS = [0, 1, 3, 9, 24, 60]; // images à 60 i/s : 0, 17, 50, 150, 400 ms et 1 s
const ms = (i) => String(Math.round((i * 1000) / 60)).padStart(4, '0');

async function lancer({ w, h, dpr = 1, q, manuel = true, extra = '' }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: PORTRAIT, isMobile: PORTRAIT });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push('PAGE ' + String(e.stack || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)); });
  if (manuel) await page.addInitScript(() => {
    // horloge d'images à la main : après __manuel(), chaque __tick(ms) fait avancer le jeu d'exactement une image
    const real = window.requestAnimationFrame.bind(window);
    let manual = false, q = [], vt = 0;
    window.requestAnimationFrame = (cb) => { if (!manual) return real((t) => { vt = t; cb(t); }); q.push(cb); return 0; };
    window.__manuel = (on = true) => { manual = on; if (!on) { const c = q; q = []; for (const f of c) real(f); } };
    window.__tick = (ms) => { vt += ms; const c = q; q = []; for (const f of c) f(vt); };
  });
  const t0 = Date.now();
  await page.goto(`${BASE}?dr=0&play&test&fs=0&tuto=0&coach=0&q=${q}&level=${LEVEL}&arsenal=${CALS.join(',')}&w=${CALS[0]}${PORTRAIT ? '&touch=1' : ''}${extra}`);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  const charge = Date.now() - t0;
  const got = await page.evaluate(() => window.hr.level.id);
  if (got !== LEVEL) { console.log(`! niveau demandé « ${LEVEL} », niveau chargé « ${got} »`); process.exit(1); }
  return { browser, page, erreurs, charge };
}

/** Dans la page : installe window.__fx (pose du tireur et de la caméra, remise à zéro entre deux tirs). */
async function outils(page) {
  await page.evaluate(() => {
    const g = window.hr.game, L = window.hr.level;
    if (g.state === 'brief') g.continueBrief();
    g.cinematic = false;
    const plan = L.testPlan[0];
    // tir couché : premier poste du plan du niveau ; accroupi : un poste « crouch » s'il y en a, sinon le même poste
    const couche = plan.post;
    const accroupi = Object.keys(L.posts).find((k) => L.posts[k].stance === 'crouch') ?? couche;
    const cibles = [...new Set(L.testPlan.flatMap((p) => p.targets))];
    window.__fx = {
      poser(cal, vue) {
        const pl = g.player;
        g.equip(cal);
        const key = vue === 'accroupi' ? accroupi : couche;
        const post = L.posts[key];
        document.getElementById('ui').style.visibility = vue === 'lunette' ? '' : 'hidden';
        pl.teleport(post.x, post.z, 0, vue === 'accroupi' ? 'crouch' : 'prone', post.y ?? 0);
        g.step(0, 0);
        // cible : celle du plan pour ce poste, sinon la première visible d'ici
        let cible = (L.testPlan.find((p) => p.post === key) ?? plan).targets[0];
        if (!g.testDial(cible).visible) cible = cibles.find((c) => g.testDial(c).visible) ?? cible;
        g.testDial(cible);
        g.scope.enter(g.scope.yaw, g.scope.pitch);
        g.rifle.zoom = Math.min(g.rifle.def.scope[1], Math.max(g.rifle.def.scope[0], 10));
        this.cible = cible; this.vue = vue;
        return { poste: key, cible };
      },
      camera() {
        const pl = g.player, vue = this.vue, portrait = innerHeight > innerWidth;
        g.testDial(this.cible);
        if (vue === 'lunette') { g.forceThirdPerson = false; g.testCam = null; return; }
        const y = pl.yaw, f = [Math.sin(y), -Math.cos(y)], r = [Math.cos(y), Math.sin(y)], p = pl.pos;
        const at = (df, dr, dy) => [p.x + f[0] * df + r[0] * dr, p.y + dy, p.z + f[1] * df + r[1] * dr];
        g.forceThirdPerson = true;
        // caméra en avant de la bouche, hors des gerbes latérales du frein ; en portrait, plus loin (champ étroit)
        const k = portrait ? 1.5 : 1;
        g.testCam = vue === 'couche'
          ? { pos: at(1.3 + 2.0 * k, 1.9 * k, 0.2 + 0.6 * k), look: at(1.3, 0, 0.2), fov: portrait ? 56 : 44 }
          : { pos: at(0.9 + 1.4 * k, 2.9 * k, 0.95 + 0.8 * k), look: at(0.9, 0, 0.95), fov: portrait ? 56 : 44 };
      },
      pret() {
        const r = g.rifle, sc = g.scope;
        if (g.state === 'brief') g.continueBrief();
        g.fx.ps.length = 0;
        g.shotFx?.reset();
        r.boltT = 0; r.reloadT = 0; r.chambered = true; r.mag = Math.max(0, r.def.magazine - 1);
        sc.kickX = sc.kickY = sc.kvX = sc.kvY = 0; sc.blackout = 0;
        g.testDial(this.cible);
      },
      tirer() { if (g.state === 'brief') g.continueBrief(); g.scope.swayX = g.scope.swayY = 0; return g.steadyFire(); },
      // un objectif atteint ouvre la fiche du suivant : on la referme aussitôt (elle masquerait la scène)
      etat() { if (g.state === 'brief') g.continueBrief(); const e = g.engine; return { calls: e.stats.calls, tris: e.stats.tris, particules: g.fx.ps.length, fx: g.shotFx?.drawn ?? 0 }; },
      info() { const i = g.shotFx?.info; return i ? { hauteur: +i.height.toFixed(2), poussiere: +i.dust.toFixed(2), sol: i.ground, teinte: i.rgb.map((v) => +v.toFixed(2)) } : null; },
    };
  });
}

const ecran = () => (PORTRAIT ? { w: 390, h: 844, dpr: 2, q: arg('q', 'low') } : { w: 1280, h: 720, dpr: 1, q: arg('q', 'medium') });

// ---------------------------------------------------------------------------------------------- captures
async function capture() {
  const dir = `${OUT}/brut/${TAG}`;
  mkdirSync(dir, { recursive: true });
  const { browser, page, erreurs } = await lancer(ecran());
  await page.waitForTimeout(1500);
  await outils(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__manuel());
  const tick = (n = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__tick(1000 / 60); }, n);
  const cout = {};
  for (const cal of CALS) {
    for (const vue of VUES) {
      const pose = await page.evaluate(([cal, vue]) => window.__fx.poser(cal, vue), [cal, vue]);
      await tick(50);
      await page.evaluate(() => window.__fx.camera());
      await tick(30);
      await page.evaluate(() => window.__fx.pret());
      await tick(20);
      const repos = await page.evaluate(() => window.__fx.etat());
      const ok = await page.evaluate(() => window.__fx.tirer());
      const max = { calls: 0, tris: 0, particules: 0, fx: 0, pas: 0 };
      for (let i = 0; i <= TEMPS[TEMPS.length - 1]; i++) {
        const m = await page.evaluate((sansPoussiere) => {
          if (sansPoussiere) window.hr.game.fx.ps.length = 0;
          const t0 = performance.now(); window.__tick(1000 / 60); return { ...window.__fx.etat(), pas: performance.now() - t0 };
        }, flag('sans-poussiere'));
        for (const k in max) max[k] = Math.max(max[k], m[k]);
        if (TEMPS.includes(i)) await page.screenshot({ path: `${dir}/${LEVEL}_${ECRAN}_${cal}_${vue}_${ms(i)}.png` });
      }
      const info = await page.evaluate(() => window.__fx.info());
      cout[`${cal}_${vue}`] = { ...pose, tir: ok, info, repos, max };
      console.log(LEVEL, ECRAN, TAG, cal, vue, JSON.stringify({ ...pose, tir: ok, info, repos, max }));
    }
  }
  writeFileSync(`${dir}/cout-${LEVEL}-${ECRAN}.json`, JSON.stringify(cout, null, 1));
  if (erreurs.length) console.log('ERREURS\n' + [...new Set(erreurs)].slice(0, 8).join('\n'));
  await browser.close();
}

// ---------------------------------------------------------------------------------------------- planches
async function planches() {
  const tags = arg('tags', 'avant,apres').split(',');
  const noms = { avant: 'avant', apres: 'après' };
  const groupes = new Map();
  for (const tag of tags) {
    const dir = `${OUT}/brut/${tag}`;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = f.match(/^(\w+?)_(bureau|portrait)_(\w+?)_(couche|accroupi|lunette)_(\d+)\.png$/);
      if (!m) continue;
      const key = `${m[1]}_${m[2]}_${m[3]}_${m[4]}`;
      if (!groupes.has(key)) groupes.set(key, {});
      (groupes.get(key)[tag] ??= {})[+m[5]] = pathToFileURL(`${dir}/${f}`).href;
    }
  }
  const only = arg('filtre', '');
  const browser = await chromium.launch({ headless: true });
  for (const [key, g] of [...groupes].sort()) {
    if (only && !key.includes(only)) continue;
    const portrait = key.includes('_portrait_');
    const W = portrait ? 230 : 400;
    const ts = [...new Set(Object.values(g).flatMap((r) => Object.keys(r).map(Number)))].sort((a, b) => a - b);
    const rows = tags.filter((t) => g[t]);
    const html = `<body style="margin:0;background:#0c0e10;font:13px Helvetica,Arial,sans-serif;color:#f0ece0"><div id="s" style="display:inline-grid;grid-template-columns:repeat(${ts.length},${W}px);gap:2px">${
      rows.map((t) => ts.map((x) => `<div style="position:relative"><img src="${g[t][x] ?? ''}" style="width:${W}px;display:block"><span style="position:absolute;left:0;top:0;background:#000;padding:3px 6px">${noms[t] ?? t} · ${x >= 1000 ? '1 s' : x + ' ms'}</span></div>`).join('')).join('')
    }</div></body>`;
    const page = await browser.newPage({ viewport: { width: W * ts.length + 20, height: 400 }, deviceScaleFactor: 1 });
    // les images sont des fichiers locaux : la page doit en être un aussi
    const tmp = `${OUT}/brut/_planche.html`;
    writeFileSync(tmp, html);
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.locator('#s').screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 86 });
    await page.close();
    console.log(`e2e/out/tir/${key}.jpg`);
  }
  await browser.close();
}

// ---------------------------------------------------------------------------------------------- coût en temps réel
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
async function cout() {
  const cas = PORTRAIT ? { w: 390, h: 844, dpr: 3, q: arg('q', 'low') } : { w: 2560, h: 1440, dpr: 1, q: arg('q', 'medium') };
  const res = [];
  for (const vue of VUES) {
    // une page neuve par vue : le premier tir de chacune est un vrai premier tir (programmes jamais utilisés)
    const { browser, page, erreurs } = await lancer({ ...cas, manuel: false });
    await page.waitForTimeout(2500);
    await outils(page);
    const cal = CALS[0];
    await page.evaluate(([cal, vue]) => window.__fx.poser(cal, vue), [cal, vue]);
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      window.__fx.camera();
      const g = window.hr.game;
      window.__ech = [];
      const step = g.step.bind(g);
      g.step = (dt, dtReal) => { step(dt, dtReal); window.__ech.push([performance.now(), g.engine.stats.calls, g.fx.ps.length]); };
    });
    await page.waitForTimeout(2500);
    const tirs = [];
    for (let n = 0; n < 5; n++) {
      await page.evaluate(() => { window.__fx.pret(); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { window.__ech.length = 0; });
      await page.waitForTimeout(1000);
      const avant = await page.evaluate(() => { const e = window.__ech.slice(); window.__ech.length = 0; window.__fx.tirer(); return e; });
      await page.waitForTimeout(1500);
      const apres = await page.evaluate(() => window.__ech.slice());
      const dts = (e) => e.slice(1).map((x, i) => x[0] - e[i][0]);
      const da = dts(apres);
      tirs.push({
        ms_avant: +med(dts(avant)).toFixed(2), ms_max_avant: +Math.max(...dts(avant)).toFixed(1), ms_apres: +med(da).toFixed(2),
        // pic : la plus longue des cinq premières images après le départ du coup (compilation éventuelle), puis de toutes
        ms_pic_tir: +Math.max(...da.slice(0, 5)).toFixed(1), ms_max_apres: +Math.max(...da).toFixed(1),
        appels_avant: med(avant.map((x) => x[1])), appels_max_avant: Math.max(...avant.map((x) => x[1])), appels_max_apres: Math.max(...apres.map((x) => x[1])),
        particules_max: Math.max(...apres.map((x) => x[2])),
      });
    }
    const gpu = await page.evaluate(() => { const gl = window.hr.engine.renderer.getContext(); const x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?'; });
    const r = { niveau: LEVEL, ecran: `${cas.w}×${cas.h} densité ${cas.dpr} qualité ${cas.q}`, tag: TAG, calibre: cal, vue, gpu, tirs };
    res.push(r);
    console.log(`${LEVEL} ${ECRAN} ${TAG} ${cal} ${vue}`);
    tirs.forEach((t, i) => console.log(`  tir ${i + 1} : ${JSON.stringify(t)}`));
    if (erreurs.length) console.log('ERREURS\n' + [...new Set(erreurs)].slice(0, 5).join('\n'));
    await browser.close();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/cout-${TAG}-${LEVEL}-${ECRAN}.json`, JSON.stringify(res, null, 1));
}

// ---------------------------------------------------------------------------------------------- appels de dessin par catégorie
async function appels() {
  const cas = PORTRAIT ? { w: 390, h: 844, dpr: 3, q: arg('q', 'low') } : { w: 2560, h: 1440, dpr: 1, q: arg('q', 'medium') };
  const { browser, page } = await lancer({ ...cas, manuel: false });
  await page.waitForTimeout(3000);
  await outils(page);
  const mesure = async (nom) => {
    const r = await page.evaluate(async () => {
      const g = window.hr.game, e = g.engine;
      // les cascades d'ombre lointaines ne sont rafraîchies qu'une image sur deux ou sur quatre : on relève 16 images
      const lire = async () => {
        const v = [];
        for (let i = 0; i < 16; i++) { await new Promise((r) => requestAnimationFrame(r)); v.push(e.stats.calls); }
        return { min: Math.min(...v), max: Math.max(...v), moy: v.reduce((a, b) => a + b, 0) / v.length };
      };
      const total = await lire();
      // catégories : groupes de la scène ; on masque chacune tour à tour et on relève la différence (ombres comprises)
      const cats = {
        relief: [g.terrain.group], herbe: g.veg.chunks.map((c) => c.mesh), 'site de tir': [g.siteGroup], 'décor et bâtiments': [g.sceneryGroup],
        cibles: [...g.targets.values()].map((t) => t.group), tireur: [g.player.char.group], 'effets (particules, traînée, pollen, oiseaux)': [g.fx.group],
      };
      const herbe = new Set(cats.herbe);
      cats['végétation hors herbe'] = [];
      g.veg.group.traverse((o) => { if (o.isMesh && !herbe.has(o)) cats['végétation hors herbe'].push(o); });
      if (g.shotFx) cats['effets du tir'] = [g.shotFx.group];
      const out = {};
      for (const [k, objs] of Object.entries(cats)) {
        const vis = objs.map((o) => o.visible);
        objs.forEach((o) => { o.visible = false; });
        const sans = await lire();
        objs.forEach((o, i) => { o.visible = vis[i]; });
        out[k] = +(total.moy - sans.moy).toFixed(1);
      }
      // reste : ciel, post-traitement, râtelier, eau, drapeaux…
      const somme = Object.values(out).reduce((a, b) => a + b, 0);
      out['reste (ciel, eau, post-traitement, divers)'] = +(total.moy - somme).toFixed(1);
      // part des passes d'ombre : rendu sans ombres
      const sh = e.renderer.shadowMap.enabled;
      e.renderer.shadowMap.enabled = false;
      const sansOmbre = await lire();
      e.renderer.shadowMap.enabled = sh;
      return { total, cats: out, ombres: +(total.moy - sansOmbre.moy).toFixed(1) };
    });
    console.log(`${LEVEL} ${ECRAN} qualité ${cas.q} — ${nom} : ${r.total.moy.toFixed(0)} appels en moyenne (${r.total.min} à ${r.total.max} selon l'image), dont passes d'ombre ${r.ombres}`);
    for (const [k, v] of Object.entries(r.cats)) console.log(`    ${String(v).padStart(6)}  ${k}`);
    return r;
  };
  const out = {};
  out.depart = await mesure('départ (debout, vue du jeu)');
  for (const vue of ['couche', 'lunette']) {
    await page.evaluate(([cal, vue]) => window.__fx.poser(cal, vue), [CALS[0], vue]);
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__fx.camera());
    await page.waitForTimeout(1500);
    out[vue] = await mesure(vue === 'couche' ? 'poste de tir couché, caméra extérieure rapprochée' : 'poste de tir couché, lunette ×10');
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/appels-${TAG}-${LEVEL}-${ECRAN}-${cas.q}.json`, JSON.stringify(out, null, 1));
  await browser.close();
}

mkdirSync(OUT, { recursive: true });
await ({ capture, planches, cout, appels }[mode] ?? (() => { console.log('mode inconnu : capture | planches | cout | appels'); }))();
