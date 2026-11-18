// Menu d'accueil et salon d'attente du multijoueur : captures et contrôles. node e2e/salon.mjs   (serveur de développement lancé)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/out', { recursive: true });
const BASE = process.env.HR_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = async (w = 1440, h = 900) => { const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); p.on('pageerror', (e) => console.log('ERREUR', String(e).slice(0, 300))); return p; };
// 1. accueil du jeu : cadres solo et multijoueur
const menu = await page();
await menu.goto(BASE + '?dr=0');
await menu.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
await menu.waitForTimeout(1500);
await menu.screenshot({ path: 'e2e/out/accueil.png' });
console.log('accueil', JSON.stringify(await menu.evaluate(() => ({ volume: !!document.querySelector('#menu [data-id="vol"]'), cadres: document.querySelectorAll('#menu .m-cadre').length, compteur: document.querySelector('[data-id="mjN"]').textContent, lien: document.querySelector('.m-ville').getAttribute('href') }))));
// 2. salon : arrivée, spectateur refusé sans joueur
const a = await page();
await a.goto(BASE + 'ville.html');
await a.waitForFunction(() => window.ville, null, { timeout: 120000 });
await a.waitForTimeout(3500);
const boutons = () => a.evaluate(() => ({ jouer: document.querySelector('[data-s="jouer"]').disabled, voir: document.querySelector('[data-s="voir"]').disabled, note: document.querySelector('[data-s="note"]').textContent, etat: document.querySelector('[data-s="etat"]').textContent }));
console.log('salon vide      ', JSON.stringify(await boutons()));
await a.fill('[data-s="pseudo"]', 'Anna');
console.log('pseudo saisi    ', JSON.stringify(await boutons()));
await a.screenshot({ path: 'e2e/out/salon.png' });
// 3. un joueur entre : le spectateur devient possible pour un autre visiteur
await a.click('[data-s="jouer"]');
await a.waitForFunction(() => window.ville.reseau.role() === 'joueur' && window.ville.state.enLigne, null, { timeout: 20000 });
console.log('Anna inscrite   ', JSON.stringify(await a.evaluate(() => ({ phase: window.ville.reseau.phase(), salon: !!window.ville.state.salon, poste: window.ville.state.post }))));
const b = await page();
await b.goto(BASE + 'ville.html');
await b.waitForFunction(() => window.ville, null, { timeout: 120000 });
await b.waitForFunction(() => !document.querySelector('[data-s="voir"]').disabled, null, { timeout: 15000 });
await b.click('[data-s="voir"]');
await b.waitForFunction(() => window.ville.reseau.role() === 'spectateur' && window.ville.state.spectateur, null, { timeout: 20000 });
await b.waitForTimeout(1200);
console.log('spectateur      ', JSON.stringify(await b.evaluate(() => ({ occupes: [...window.ville.state.occupes], liste: !document.querySelector('select').disabled, tir: window.ville.tir.tirer() }))));
await b.screenshot({ path: 'e2e/out/spectateur.png' });
await menu.waitForTimeout(9500);
console.log('compteur accueil', await menu.evaluate(() => document.querySelector('[data-id="mjN"]').textContent));
await browser.close();
