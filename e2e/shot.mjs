// Capture d'écran paramétrable : node e2e/shot.mjs nom "query" [largeur hauteur attente_ms]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [name = 'shot', query = '', w = '1600', h = '900', wait = '1500', js = ''] = process.argv.slice(2);
mkdirSync('e2e/out', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.type() === 'info') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&' + query + (/(^|&)level=/.test(query) ? '' : '&level=standard'));
try {
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 90000 });
} catch (e) { errors.push('TIMEOUT ready'); }
if (js) { try { const r = await page.evaluate(js); if (r !== undefined) console.log('JS:', JSON.stringify(r)); } catch (e) { errors.push('JS ' + e); } }
await page.waitForTimeout(+wait);
const info = await page.evaluate(() => {
  const e = window.hr?.engine; if (!e) return null;
  const gl = e.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?', ms: +e.frameMs.toFixed(2), calls: e.stats.calls, tris: e.stats.tris, pr: e.pixelRatio };
});
await page.screenshot({ path: `e2e/out/${name}.png` });
console.log(JSON.stringify(info));
if (errors.length) console.log([...new Set(errors)].slice(0, 12).join('\n'));
await browser.close();
