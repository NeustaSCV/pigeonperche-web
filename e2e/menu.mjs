// Menu léger : il s'affiche sans charger la carte, sur un fond d'images ; la carte n'est chargée qu'au clic sur
// « Commencer » ; changer de niveau au menu ne construit aucun monde ; les fichiers lourds sont préchargés entre-temps.
//   HR_URL=http://127.0.0.1:5196/ PLAYWRIGHT_BROWSERS_PATH=0 node e2e/menu.mjs
import { chromium } from 'playwright';
const URL = process.env.HR_URL || 'http://127.0.0.1:5196/';
let ok = 0, ko = 0;
const check = (name, cond, detail = '') => { if (cond) ok++; else { ko++; console.log('ÉCHEC', name, detail); } };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];
const open = async (query, viewport = { width: 1600, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url().replace(URL, '')));
  const t0 = Date.now();
  await page.goto(URL + query);
  await page.waitForFunction(() => window.hr && document.querySelector('#menu.on'), null, { timeout: 60000 });
  return { page, ctx, reqs, menuMs: Date.now() - t0 };
};
const heavy = (reqs) => reqs.filter((u) => /terrain\/|assets\/(tex|models|sky)\//.test(u));
const st = (page) => page.evaluate(() => ({ ready: window.hr.game.ready, state: window.hr.game.state, backdrop: !!document.getElementById('backdrop'), on: [...document.querySelectorAll('.screen.on')].map((e) => e.id), bg: getComputedStyle(document.querySelector('#backdrop .bd.on') ?? document.body).backgroundImage.slice(0, 60) }));

// 1. sans préchargement : le menu arrive sans un seul fichier lourd, fond d'image affiché, aucune carte construite
{
  const { page, ctx, reqs, menuMs } = await open('?test=1&lazy=1&preload=0&level=standard');
  await page.waitForTimeout(1500);
  const s = await st(page);
  check('menu affiché sans carte', s.ready === false && s.state === 'menu' && s.on.join() === 'menu', JSON.stringify(s));
  check('fond d’images en place', s.backdrop && s.bg.includes('fond-1.jpg'), s.bg);
  check('aucun fichier lourd demandé avant le clic', heavy(reqs).length === 0, heavy(reqs).slice(0, 4).join(' '));
  check('menu en moins de 5 s', menuMs < 5000, menuMs + ' ms');
  console.log(`menu affiché en ${menuMs} ms, ${reqs.length} requêtes`);
  // classement et réglages utilisables sans carte
  check('classement présent', await page.evaluate(() => document.querySelectorAll('#menu .boards .board-col').length === 3));
  await page.evaluate(() => { const r = document.querySelector('#menu input[type=range]'); r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  check('volume réglable', Math.abs(Number(await page.evaluate(() => localStorage.getItem('hr.volume'))) - 0.3) < 0.02);
  // 2. « Commencer » : barre de progression, puis la mission démarre (briefing), fond retiré
  await page.click('#menu .m-start, #menu [data-act="start"]');
  await page.waitForTimeout(300);
  const mid = await st(page);
  check('écran de chargement après le clic', mid.on.includes('loading') && mid.ready === false, JSON.stringify(mid));
  await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 });
  await page.waitForTimeout(800);
  const end = await st(page);
  check('mission lancée après le chargement', end.ready && (end.state === 'brief' || end.state === 'play'), JSON.stringify(end));
  check('fond retiré une fois la carte prête', !end.backdrop);
  check('écran de chargement refermé', !end.on.includes('loading'), end.on.join());
  check('fichiers lourds chargés au clic', heavy(reqs).length > 20, String(heavy(reqs).length));
  // deux clics ne lancent pas deux chargements
  check('relief demandé une seule fois', reqs.filter((u) => u.includes('terrain/standard/height.bin')).length === 1);
  await ctx.close();
}

// 3. changer de niveau au menu : la page se recharge sur l'autre carte, toujours sans rien construire
{
  const { page, ctx, reqs } = await open('?test=1&lazy=1&preload=0&level=standard');
  const n0 = reqs.length;
  await Promise.all([page.waitForNavigation(), page.click('#menu button[data-k="avance"]')]);
  const t0 = Date.now();
  await page.waitForFunction(() => window.hr && document.querySelector('#menu.on') && window.hr.level.id === 'avance', null, { timeout: 60000 });
  const ms = Date.now() - t0;
  const s = await st(page);
  check('niveau changé sans construire de carte', s.ready === false && s.state === 'menu', JSON.stringify(s));
  check('aucun fichier lourd au changement de niveau', heavy(reqs.slice(n0)).length === 0, heavy(reqs.slice(n0)).slice(0, 3).join(' '));
  check('changement de niveau en moins de 3 s', ms < 3000, ms + ' ms');
  console.log(`changement de niveau en ${ms} ms`);
  await ctx.close();
}

// 4. préchargement : pendant le menu, le relief de la carte choisie, le ciel, les textures et les modèles arrivent
{
  const { page, ctx, reqs } = await open('?test=1&lazy=1&level=facile');
  await page.waitForFunction(() => window.hr.game.preloader && window.hr.game.preloader.total > 0 && window.hr.game.preloader.done === window.hr.game.preloader.total, null, { timeout: 120000 });
  const pre = heavy(reqs);
  const s = await st(page);
  check('préchargement sans construire la carte', s.ready === false && s.state === 'menu');
  check('relief de la carte choisie préchargé', pre.some((u) => u.includes('terrain/facile/height.bin')) && !pre.some((u) => u.includes('terrain/standard/')), pre.filter((u) => u.includes('terrain/')).join(' '));
  check('ciel préchargé', pre.some((u) => /sky_(1k|2k)\.hdr/.test(u)));
  const n0 = reqs.length;
  await page.click('#menu .m-start, #menu [data-act="start"]');
  await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 });
  // tout ce que la carte demande avait été préchargé (aucune adresse lourde nouvelle), et rien n'a été préchargé pour rien
  const asked = new Set(heavy(reqs.slice(n0))), had = new Set(pre);
  const missed = [...asked].filter((u) => !had.has(u)), unused = [...had].filter((u) => !asked.has(u));
  check('la carte ne demande rien qui n’ait été préchargé', missed.length === 0, missed.slice(0, 6).join(' '));
  check('rien n’est préchargé pour rien', unused.length === 0, unused.slice(0, 6).join(' '));
  console.log(`préchargés : ${had.size} fichiers ; demandés par la carte : ${asked.size} ; non préchargés : ${missed.length} ; préchargés sans usage sur cette carte : ${unused.length}${unused.length ? ' (' + unused.slice(0, 8).join(', ') + ')' : ''}`);
  await ctx.close();
}

// 5. téléphone en portrait : même parcours
{
  const { page, ctx, reqs } = await open('?test=1&lazy=1&preload=0&touch=1&level=facile', { width: 390, height: 844 });
  const s = await st(page);
  check('portrait : menu sans carte', s.ready === false && s.backdrop && heavy(reqs).length === 0, JSON.stringify(s));
  check('portrait : menu sans débordement', await page.evaluate(() => { const m = document.getElementById('menu'); return m.scrollHeight - m.clientHeight <= 1; }));
  await ctx.close();
}

// 6. les essais existants (?test sans lazy) et ?play chargent toujours la carte d'emblée
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(URL + '?test=1&q=low&level=facile');
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  check('mode essai : carte chargée d’emblée', await page.evaluate(() => window.hr.game.ready && !document.getElementById('backdrop')));
  await ctx.close();
}
await browser.close();
check('aucune erreur de page', errors.length === 0, errors.join(' | '));
console.log(`menu : ${ok} vérifications réussies sur ${ok + ko}`);
process.exit(ko ? 1 : 0);
