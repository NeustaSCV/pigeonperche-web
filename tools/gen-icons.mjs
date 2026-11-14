// Icônes de l'application (écran d'accueil) : rend public/icon.svg en PNG avec le Chromium de Playwright.
// Usage : PLAYWRIGHT_BROWSERS_PATH=0 node tools/gen-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const shot = async (file, size, pad) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // version « maskable » : le motif tient dans la zone sûre centrale (80 %)
  await page.setContent(`<body style="margin:0;background:#0b0c0b;display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg}</div></body>`);
  await page.screenshot({ path: `public/${file}` });
  await page.close();
};
await shot('icon-192.png', 192, 0);
await shot('icon-512.png', 512, 0);
await shot('icon-maskable-512.png', 512, 52);
await shot('apple-touch-icon.png', 180, 0);
await browser.close();
console.log('icônes écrites dans public/');
