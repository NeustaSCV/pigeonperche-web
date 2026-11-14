// Vérification visuelle des carabines : chaque arme est isolée devant un fond neutre (game.studio) et photographiée
// sous plusieurs angles, puis cadrée en situation (râtelier, tireur couché, accroupi, arme dans le dos).
// Mesure aussi la boîte englobante (longueur hors tout réelle), les appels de dessin et les triangles.
// Usage : node e2e/rifles.mjs [id ...] [--views=right,close] [--no-scene]   → e2e/out/rifle-<id>-<vue>.png
//         node e2e/rifles.mjs --boards   → planches seules : profil des 17 armes (e2e/out/rifles-profils.png) et
//         trois-quarts avant / arrière des dix armes récentes (e2e/out/rifles-nouvelles-34.png), sans mise en situation.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync('e2e/out', { recursive: true });
const args = process.argv.slice(2);
const OLD = ['22lr', '223', '65cm', '308', '308sub', '300wm', '338lm'];
// armes des familles « intermediate » et « elr » : cotes lues dans src/config/weapons.ts (build.overallMm)
const NEW = ['6cm', '65prc', '7prc', '300prc', '338lm300', '33xc', '375ct', '408ct', '416b', '50bmg'];
const ALL = [...OLD, ...NEW];
const ids = args.filter((a) => !a.startsWith('--'));
const IDS = ids.length ? ids : ALL;
const BOARDS = args.includes('--boards');
const vArg = args.find((a) => a.startsWith('--views='));
const VIEWS = vArg ? vArg.slice(8).split(',') : BOARDS ? ['right', 'front34', 'rear34'] : ['right', 'left', 'front34', 'rear34', 'top', 'close', 'bipod'];
const SCENE = !args.includes('--no-scene') && !BOARDS;
// longueurs hors tout réelles (m), frein de bouche ou modérateur compris (cotes publiées : native/tools/weapons-ref/SOURCES.md) :
// CZ 457 Varmint 981 ; Tikka T3x Tac A1 24 pouces 1 115 + frein 45 ; Ruger Precision Rifle 20 pouces 997 à 1 086 selon la crosse
// (réglée ici à 1 040), + 146 avec le modérateur ; Sako TRG 42 1 200 + frein 45 ; PGM 338 1 240. Tolérance 1,5 cm.
const REAL = { '22lr': 0.981, '223': 1.16, '65cm': 1.16, '308': 1.04, '308sub': 1.186, '300wm': 1.245, '338lm': 1.24 };
// fiche de chaque arme : longueur hors tout (build.overallMm) ; pour les dix récentes, c'est la cote à tenir
const OVERALL = {};
{
  const src = readFileSync('src/config/weapons.ts', 'utf8');
  for (const m of src.matchAll(/id: '([^']+)'[\s\S]*?overallMm: (\d+)/g)) OVERALL[m[1]] = +m[2] / 1000;
  for (const id of NEW) REAL[id] = OVERALL[id];
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)));
// (sur une page construite — vite preview — les sources ne sont pas servies : le 404 de l'import ci-dessous est attendu)
page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/src/config/weapons.ts')) errors.push(m.text().slice(0, 400)); });
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&q=high&play&test&d=standard&level=standard');
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); document.getElementById('ui').style.visibility = 'hidden'; });
// les armes récentes ne sont pas au râtelier de ce niveau : on les y ajoute le temps du test pour pouvoir les épauler
await page.evaluate(async (ids) => {
  const g = window.hr.game;
  try {
    const { WEAPONS } = await import('/src/config/weapons.ts');
    for (const id of ids) if (!g.weapons.some((w) => w.id === id)) { const w = WEAPONS.find((x) => x.id === id); if (w) g.weapons.push(w); }
  } catch (e) { console.warn('armes hors râtelier indisponibles : ' + e); }
}, IDS.filter((id) => NEW.includes(id)));
const fov = 30;
const fit = (len) => (len / 2 / Math.tan((fov * Math.PI) / 360) / (16 / 9)) * 1.12;
let ok = true;
const rows = [];
for (const id of IDS) {
  for (const lod of [0, 1]) {
    const info = await page.evaluate(([id, lod]) => window.hr.game.studio(id, lod, false), [id, lod]);
    const C = info.center;
    const d = fit(info.length);
    const cam = (c) => page.evaluate((c) => window.hr.game.studioCam(c.pos, c.look, c.fov), { ...c, fov });
    if (lod === 1) {
      await cam({ pos: [C[0] - d, C[1], C[2]], look: C });
      await page.waitForTimeout(350);
      await page.screenshot({ path: `e2e/out/rifle-${id}-lod.png` });
      const good = info.tris <= 8000 && info.calls <= 2;
      rows.push({ arme: id, version: 'râtelier', longueur: +info.length.toFixed(3), réelle: REAL[id], fiche: OVERALL[id], canon: info.barrel, appels: info.calls, triangles: info.tris, ok: good });
      if (!good) ok = false;
      continue;
    }
    const full = await page.evaluate(([id]) => window.hr.game.studio(id, 0, true), [id]);
    const good = Math.abs(info.length - REAL[id]) < 0.015 && full.tris <= 30000 && full.calls <= 4;
    rows.push({ arme: id, version: 'en main', longueur: +info.length.toFixed(3), réelle: REAL[id], fiche: OVERALL[id], canon: info.barrel, appels: full.calls, triangles: full.tris, ok: good });
    if (!good) ok = false;
    // caméras dans le repère de l'arme (canon vers +Z, côté droit = −X)
    const cams = {
      right: { pos: [C[0] - d, C[1], C[2]], look: C },
      left: { pos: [C[0] + d, C[1], C[2]], look: C },
      front34: { pos: [C[0] - d * 0.62, C[1] + d * 0.3, C[2] + d * 0.72], look: C },
      rear34: { pos: [C[0] - d * 0.62, C[1] + d * 0.3, C[2] - d * 0.72], look: C },
      top: { pos: [C[0] - 0.001, C[1] + d, C[2]], look: C },
      close: { pos: [-0.5, 0.16, 0.12], look: [0, 0.05, 0.1] },
      bipod: { pos: [C[0] - d * 0.55, C[1] + d * 0.12, C[2] + d * 0.8], look: [C[0], C[1] - 0.08, C[2]] },
    };
    for (const v of VIEWS) {
      // le soleil arrive de trois quarts avant, du côté photographié
      await page.evaluate(([id, bip, sun]) => window.hr.game.studio(id, 0, bip, sun), [id, v === 'bipod', v === 'left' ? 0.9 : v === 'rear34' ? -2.0 : -0.9]);
      await cam(cams[v]);
      await page.waitForTimeout(350);
      await page.screenshot({ path: `e2e/out/rifle-${id}-${v}.png` });
    }
  }
  if (SCENE && !(await page.evaluate((id) => window.hr.game.weapons.some((w) => w.id === id), id))) {
    console.log(`${id} : mise en situation sautée (arme hors du râtelier de ce niveau, et sources non servies par cette page)`);
  } else if (SCENE) {
    // en situation : tireur couché sur bipied, accroupi épaulé, arme dans le dos
    await page.evaluate((id) => { const g = window.hr.game; g.studio(null); g.equip(id); g.scope.exit(); g.player.teleport(-2, 6, 0.6, 'prone'); }, id);
    const shot = async (name, stance, aim, cam) => {
      await page.evaluate(([stance, aim, cam]) => {
        const g = window.hr.game, p = g.player;
        p.teleport(-2, 6, 0.6, stance);
        if (aim) g.scope.enter(0.6, 0); else g.scope.exit();
        const s = Math.sin(0.6), c = Math.cos(0.6);
        // repère local : avant (vers le regard), droite, haut
        const w = (f, r, u) => [p.pos.x + s * f + c * r, p.pos.y + u, p.pos.z - c * f + s * r];
        g.testCam = { pos: w(...cam.pos), look: w(...cam.look), fov: cam.fov };
        g.forceThirdPerson = true;
      }, [stance, aim, cam]);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `e2e/out/rifle-${id}-${name}.png` });
    };
    // (couché, l'arme est devant le tireur, crosse à l'épaule : son milieu est à 1,2 m environ du bassin)
    await shot('prone', 'prone', false, { pos: [1.9, 1.6, 0.95], look: [0.75, -0.05, 0.2], fov: 42 });
    await shot('prone-close', 'prone', false, { pos: [1.0, -1.1, 0.5], look: [0.9, -0.09, 0.22], fov: 40 });
    await shot('crouch', 'crouch', true, { pos: [0.3, 2.2, 1.1], look: [0.3, 0, 0.95], fov: 40 });
    await shot('stand', 'stand', true, { pos: [0.4, 2.6, 1.35], look: [0.4, 0, 1.25], fov: 40 });
    await shot('back', 'stand', false, { pos: [-2.0, -1.3, 1.5], look: [0, 0, 1.1], fov: 40 });
    await page.evaluate(() => { const g = window.hr.game; g.scope.exit(); g.forceThirdPerson = false; g.testCam = null; });
  }
}
if (SCENE && !ids.length) {
  // râtelier : les sept armes, de face puis de trois quarts
  await page.evaluate(() => { const g = window.hr.game; g.studio(null); g.player.teleport(3.5, 15, Math.PI, 'stand'); g.testCam = { pos: [3.5, 261.15, 17.6], look: [3.5, 260.85, 20.2], fov: 50 }; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'e2e/out/rifle-rack.png' });
  await page.evaluate(() => { window.hr.game.testCam = { pos: [1.7, 261.5, 18.4], look: [3.6, 260.9, 20.2], fov: 50 }; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/out/rifle-rack-34.png' });
  const st = await page.evaluate(() => ({ calls: window.hr.engine.stats.calls, tris: window.hr.engine.stats.tris }));
  console.log('râtelier en vue :', JSON.stringify(st));
}
// planches-contact : toutes les vues d'une arme sur une seule image
const sheet = await browser.newPage({ viewport: { width: 1920, height: 1440 }, deviceScaleFactor: 1 });
for (const id of BOARDS ? [] : IDS) {
  const names = [...VIEWS, 'lod', ...(SCENE ? ['prone', 'prone-close', 'crouch', 'stand', 'back'] : [])].filter((v) => existsSync(`e2e/out/rifle-${id}-${v}.png`));
  const cells = names.map((v) => `<div><img src="data:image/png;base64,${readFileSync(`e2e/out/rifle-${id}-${v}.png`).toString('base64')}"><span>${id} · ${v}</span></div>`).join('');
  await sheet.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(3,640px);font:14px sans-serif;color:#fff}div{position:relative;height:360px}img{width:640px;height:360px;display:block}span{position:absolute;left:6px;top:4px;text-shadow:0 0 3px #000}</style>${cells}`);
  await sheet.screenshot({ path: `e2e/out/rifle-${id}-sheet.png` });
}
// planches d'ensemble : profil droit de chaque arme, puis trois-quarts des dix armes récentes
const board = async (file, cols, w, h, cells) => {
  const html = cells.filter((c) => existsSync(c.png)).map((c) => `<div><img src="data:image/png;base64,${readFileSync(c.png).toString('base64')}"><span>${c.label}</span></div>`).join('');
  await sheet.setViewportSize({ width: cols * w, height: Math.ceil(cells.length / cols) * h });
  await sheet.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${w}px);font:15px sans-serif;color:#fff}div{position:relative;height:${h}px;overflow:hidden}img{width:${w}px;height:${h}px;display:block;object-fit:cover}span{position:absolute;left:6px;top:4px;text-shadow:0 0 3px #000}</style>${html}`);
  await sheet.screenshot({ path: file });
};
if ((BOARDS || !ids.length) && VIEWS.includes('right')) await board('e2e/out/rifles-profils.png', 2, 960, 300, IDS.map((id) => ({ png: `e2e/out/rifle-${id}-right.png`, label: `${id} · ${OVERALL[id] ?? '?'} m` })));
const recent = IDS.filter((id) => NEW.includes(id));
if ((BOARDS || !ids.length) && recent.length && VIEWS.includes('front34')) await board('e2e/out/rifles-nouvelles-34.png', 4, 480, 270, recent.flatMap((id) => ['front34', 'rear34'].map((v) => ({ png: `e2e/out/rifle-${id}-${v}.png`, label: `${id} · ${v}` }))));
console.table(rows);
if (errors.length) { console.log('ERREURS\n' + [...new Set(errors)].join('\n')); ok = false; }
await browser.close();
console.log(ok ? 'OK : cotes, appels de dessin et triangles conformes' : 'ÉCHEC');
process.exit(ok ? 0 : 1);
