// Banc d'essai des bâtiments de la banque (src/buildings) dans le vrai moteur du jeu.
// Pour chaque bâtiment (chaque carte, et chaque halte entière) :
//  - capture proche, capture « lunette ×12 à 800 m » (détail complet) et capture à l'œil nu à 800 m (détail lointain) ;
//  - triangles et appels de dessin en complet et en lointain : chiffres de l'adaptateur ET coût mesuré dans le moteur
//    (image avec le bâtiment moins image sans lui, ombres en cascade comprises) ;
//  - essai balistique avec les collisions du jeu (les tirs passent par les ouvertures, les murs arrêtent).
// Sorties : e2e/out/buildings/*.png, planche-*.png, resultats.json, resultats.md (resultats-partiel.* si des ids sont donnés).
//
// Usage : node e2e/buildings.mjs [id ...] [--cartes] [--quick] [--q=medium] [--w=1600 --h=900]
//   id ...     seulement ces bâtiments (sinon tous)
//   --cartes   toutes les cartes de chaque bâtiment (sinon la première ; les haltes sont toujours entières)
//   --quick    mesures seules, sans captures
// Serveur : HR_URL s'il est donné (ex. http://127.0.0.1:5173/) ; sinon un serveur Vite privé, sans rechargement à
// chaud, sur un port libre : le serveur de développement de l'utilisateur (5173) n'est ni utilisé ni arrêté.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const only = args.filter((a) => !a.startsWith('--'));
const W = +opt('w', 1600), H = +opt('h', 900), Q = opt('q', 'medium');
const OUT = 'e2e/out/buildings';
mkdirSync(OUT, { recursive: true });

let server = null;
let base = process.env.HR_URL;
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 5190, strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error', clearScreen: false });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
const url = `${base}src/buildings/bench.html?q=${Q}`;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 500)));
await page.goto(url);
await page.waitForFunction(() => window.bench && (window.bench.ready || window.bench.error), null, { timeout: 120000 });
const bootError = await page.evaluate(() => window.bench.error || '');
if (bootError) {
  console.error('Le banc ne démarre pas :\n' + bootError);
  await browser.close();
  await server?.close();
  process.exit(1);
}
const gpu = await page.evaluate(() => {
  const gl = window.bench.engine.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?';
});
const catalog = await page.evaluate(() => window.bench.CATALOG);
const jobs = [];
for (const e of catalog) {
  if (only.length && !only.includes(e.id)) continue;
  if (e.halte) jobs.push({ id: e.id, carte: '*', name: e.name, kb: e.sourceKb });
  else for (const c of flag('cartes') ? e.cartes : e.cartes.slice(0, 1)) jobs.push({ id: e.id, carte: c.id, name: e.name + (c.id ? ` (${c.id})` : ''), kb: e.sourceKb });
}

const results = [];
for (const j of jobs) {
  const tag = j.id + (j.carte && j.carte !== '*' ? '-' + j.carte : '');
  const errAt = errors.length;
  try {
    const r = await page.evaluate(async ([id, carte]) => {
      const b = window.bench;
      b.view('proche');
      const load = await b.show(id, carte);
      return load;
    }, [j.id, j.carte]);
    const shot = async (suffix) => { if (!flag('quick')) await page.screenshot({ path: `${OUT}/${tag}-${suffix}.png` }); };
    // proche, détail complet
    const proche = await page.evaluate(() => { const b = window.bench; b.view('proche'); return { full: b.measure('full'), far: b.measure('far'), ms: (b.lod('full'), b.timeFrames(30)) }; });
    await page.evaluate(() => { window.bench.lod('full'); });
    await shot('proche');
    // lunette ×12 à 800 m : la règle de bascule doit donner « complet »
    const lunette = await page.evaluate(() => { const b = window.bench; b.view('lunette', 12, 800); const auto = b.lod('auto'); return { auto, full: b.measure('full'), far: b.measure('far') }; });
    await page.evaluate(() => { window.bench.lod('full'); });
    await shot('lunette');
    await page.evaluate(() => { window.bench.lod('far'); });
    await shot('lunette-lointain');
    // œil nu à 800 m : la règle doit donner « lointain »
    const oeil = await page.evaluate(() => { const b = window.bench; b.view('oeil', 1, 800); const auto = b.lod('auto'); return { auto, far: b.measure('far'), full: b.measure('full') }; });
    await page.evaluate(() => { window.bench.lod('far'); });
    await shot('oeil-lointain');
    // scintillement à l'œil nu à 800 m : complet contre lointain, sous un déplacement d'un quart de pixel
    const stab = await page.evaluate(() => { const b = window.bench; return { full: b.stability('full'), far: b.stability('far') }; });
    const probe = await page.evaluate(() => window.bench.probe());
    const poi = await page.evaluate(() => window.bench.poiSummary());
    results.push({ ...j, tag, ...r, proche, lunette, oeil, stab, probe, poi, errors: errors.slice(errAt) });
    const f = r.full, g = r.far;
    console.log(`${tag.padEnd(34)} complet ${String(f.triangles).padStart(6)} tri / ${f.drawCalls} appel(s) (moteur ${lunette.full.calls} à la lunette) | lointain ${String(g.triangles).padStart(6)} tri / ${g.drawCalls} (moteur ${oeil.far.calls} à l'œil nu) | source ${r.source.meshes} maillages | collisions ${probe.triangles} tri, ouvertures ${probe.through} traversées + ${probe.masked} masquées + ${probe.plugged} bouchées / ${probe.openings}, murs ${probe.stopped}/${probe.walls} | ${r.loadMs} ms${errors.length > errAt ? ' | ERREURS ' + (errors.length - errAt) : ''}`);
  } catch (e) {
    results.push({ ...j, tag, failed: String(e).slice(0, 400), errors: errors.slice(errAt) });
    console.log(`${tag.padEnd(34)} ÉCHEC ${String(e).slice(0, 300)}`);
  }
}

// --- tableau ---
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' k' : String(n));
const lines = [
  `# Banc des bâtiments — ${new Date().toISOString().slice(0, 16)} — ${gpu} — ${W}×${H}, qualité ${Q}`,
  '',
  '« Moteur » = appels de dessin réellement ajoutés à l\'image par le bâtiment, ombres en cascade comprises (image avec − image sans). « Scintillement » = variation de l\'image pour un quart de pixel de déplacement, rapportée à celle d\'une image fixe (1 = stable).',
  '',
  '| Bâtiment | Source (maillages) | Complet tri / appels | Moteur lunette ×12 à 800 m (complet) | Lointain tri / appels | Moteur œil nu à 800 m (lointain) | Collisions tri | Ouvertures : traversées + masquées + bouchées / essayées | Murs : tirs à 1,05 m du sol arrêtés / segments pleins de la banque | Creusé (m) | Scintillement œil nu 800 m complet → lointain | Conversion (ms) | Source (ko) |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of results) {
  if (r.failed) { lines.push(`| ${r.tag} | ÉCHEC : ${r.failed.replace(/\|/g, '/')} |`); continue; }
  lines.push(`| ${r.tag} | ${r.source.meshes} | ${k(r.full.triangles)} / ${r.full.drawCalls} | ${r.lunette.full.calls} appels, ${k(r.lunette.full.tris)} tri | ${k(r.far.triangles)} / ${r.far.drawCalls} | ${r.oeil.far.calls} appels, ${k(r.oeil.far.tris)} tri | ${k(r.probe.triangles)} | ${r.probe.through} + ${r.probe.masked} + ${r.probe.plugged} / ${r.probe.openings} | ${r.probe.stopped}/${r.probe.walls} | ${r.footprint.dug ? r.footprint.dug.toFixed(1) : '–'} | ${r.stab.full.ratio} → ${r.stab.far.ratio} | ${r.loadMs} | ${r.kb} |`);
}
const allErrors = [...new Set(errors)];
if (allErrors.length) lines.push('', '## Messages de la console', '', ...allErrors.slice(0, 40).map((e) => '- ' + e.replace(/\n/g, ' ')));
// un essai partiel (quelques ids) n'écrase pas le tableau complet
const NAME = only.length ? 'resultats-partiel' : 'resultats';
writeFileSync(`${OUT}/${NAME}.md`, lines.join('\n') + '\n');
writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify({ gpu, W, H, Q, results }, null, 1));

// --- planches de contact (pour relire les captures d'un coup d'œil) ---
if (!flag('quick') && results.some((r) => !r.failed)) {
  const ok = results.filter((r) => !r.failed);
  const sheet = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const per = 6;
  for (let s = 0; s * per < ok.length; s++) {
    const rows = ok.slice(s * per, s * per + per);
    const html = `<body style="margin:0;background:#111;color:#ddd;font:13px ui-monospace,monospace"><div style="display:grid;grid-template-columns:repeat(4,480px);gap:0">${rows
      .map((r) => ['proche', 'lunette', 'lunette-lointain', 'oeil-lointain'].map((v) => `<div style="position:relative;height:180px;overflow:hidden"><img src="file://${process.cwd()}/${OUT}/${r.tag}-${v}.png" style="${v === 'oeil-lointain' ? 'width:1920px;margin:-450px 0 0 -720px' : 'width:480px;height:270px;margin-top:-45px'}"><span style="position:absolute;left:4px;top:2px;text-shadow:0 0 3px #000,0 0 3px #000">${r.tag} · ${v}</span></div>`).join(''))
      .join('')}</div></body>`;
    writeFileSync(`${OUT}/planche-${s + 1}.html`, html);
    await sheet.goto(`file://${process.cwd()}/${OUT}/planche-${s + 1}.html`);
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: `${OUT}/planche-${s + 1}.png` });
  }
}
console.log(`\n${results.filter((r) => !r.failed).length}/${results.length} bâtiments, ${allErrors.length} message(s) de console. Tableau : ${OUT}/${NAME}.md`);
await browser.close();
await server?.close();
process.exit(results.some((r) => r.failed) ? 1 : 0);
