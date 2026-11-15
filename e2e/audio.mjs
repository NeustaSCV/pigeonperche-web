// Rend hors ligne le coup de feu de chaque arme EN SORTIE DE MIXAGE (compresseur, limiteur et volume compris), avec le
// moteur audio du jeu tel qu'il est livré, puis écrit les tampons en WAV flottant dans e2e/out/tir/audio/.
// Les mesures et les spectrogrammes sont faits ensuite par e2e/audio-mesures.py.
//   HR_URL=http://127.0.0.1:5196/ PLAYWRIGHT_BROWSERS_PATH=0 node e2e/audio.mjs [filtre]
// Rendus : <arme>_<carte> (hybride), <arme>_repli (sans fichier : synthèse), meca_enreg / meca_synth, silence,
// 308_ambiance (ambiance active : vérifie qu'elle n'est pas écrasée).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'out/tir/audio');
mkdirSync(out, { recursive: true });
const URL = process.env.HR_URL || 'http://127.0.0.1:5196/';
const filtre = process.argv[2] || '';
const SR = 48000;

function wavFloat(buf) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];
async function open(level) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[audio]'))) errors.push(m.text().slice(0, 300)); });
  await page.goto(URL + '?test=1&q=low&level=' + level);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  return page;
}

// fiches des dix-sept armes (râteliers des cartes standard et avancée) et reliefs des trois cartes
const weapons = new Map();
const echo = {};
let page = null;
for (const level of ['facile', 'avance', 'standard']) {
  if (page) await page.close();
  page = await open(level);
  const got = await page.evaluate(() => ({ w: window.hr.game.weapons.map((w) => JSON.parse(JSON.stringify(w))), echo: window.hr.level.echo ?? null }));
  for (const w of got.w) weapons.set(w.id, w);
  echo[level] = got.echo;
}

await page.evaluate(() => {
  const SR = 48000;
  const Offline = window.OfflineAudioContext;
  const Engine = window.hr.game.audio.constructor;
  const b64 = (l, r) => {
    const x = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { x[i * 2] = l[i]; x[i * 2 + 1] = r[i]; }
    const u = new Uint8Array(x.buffer);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  /** o : { sec, echo, samples (false = repli), ambience, volume, script(e, at) } */
  window.renderShot = async (o) => {
    let made = null;
    class Ctx extends Offline {
      constructor() { super(2, Math.ceil(o.sec * SR), SR); made = this; }
      get state() { return 'running'; }
      resume() { return Promise.resolve(); }
    }
    const real = window.AudioContext;
    window.AudioContext = Ctx;
    const e = new Engine();
    if (o.samples === false) e.samples.asked = true; // aucun fichier demandé : repli sur la synthèse
    e.setEcho(o.echo);
    await e.start();
    window.AudioContext = real;
    e.setMasterVolume(o.volume ?? 1);
    e.n.vol.gain.value = o.volume ?? 1;
    if (!o.ambience) e.n.ambBus.gain.value = 0;
    if (o.samples !== false) {
      const t0 = performance.now();
      while (!['small', 'intermediate', 'medium', 'magnum', 'suppressed', 'boltOpen', 'boltClose', 'casing'].every((k) => e.samples.get(k))) {
        if (performance.now() - t0 > 8000) throw new Error('enregistrements non chargés');
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    const at = (t, f) => { void made.suspend(t).then(() => { try { f(); } finally { void Offline.prototype.resume.call(made); } }); };
    const bake = { ms: 0, recorded: null };
    o.script(e, at, bake);
    const buf = await made.startRendering();
    return { pcm: b64(buf.getChannelData(0), buf.getChannelData(1)), bake };
  };
  window.renderWeapon = (w, echo, samples, ambience) => window.renderShot({
    sec: ambience ? 8 : 9, echo, samples, ambience,
    script: (e, at, bake) => {
      const t0 = performance.now();
      e.prepareShot(w);
      bake.ms = performance.now() - t0;
      bake.recorded = e.bakes.get(w.id).shot.recorded;
      if (ambience) {
        const st = { windSpeed: 3.5, gust: 0.2, treeProximity: 0.5, inScope: false, heartRate: 70, breath: 'normal', marketActivity: 0, alarm: false, timeScale: 1, menu: false };
        for (let t = 0.05; t < 7.9; t += 0.05) at(t, () => e.update(0.05, st));
        at(3.016, () => e.shot(w));
      } else at(0.016, () => e.shot(w));
    },
  });
  window.renderMeca = (samples) => window.renderShot({
    sec: 4, echo: null, samples,
    script: (e, at) => { at(0.1, () => e.boltOpen()); at(1.2, () => e.boltClose()); at(2.2, () => e.magOut()); at(3.1, () => e.magIn()); },
  });
  window.renderSilence = () => window.renderShot({ sec: 2, echo: null, samples: false, script: () => undefined });
});

const jobs = [];
for (const w of weapons.values()) {
  jobs.push([`${w.id}_standard`, (a) => window.renderWeapon(a.w, a.echo.standard, true, false), w]);
  jobs.push([`${w.id}_repli`, (a) => window.renderWeapon(a.w, a.echo.standard, false, false), w]);
}
for (const id of ['308', '338lm', '50bmg']) for (const lv of ['facile', 'avance']) jobs.push([`${id}_${lv}`, new Function('a', `return window.renderWeapon(a.w, a.echo.${lv}, true, false)`), weapons.get(id)]);
jobs.push(['308_ambiance', (a) => window.renderWeapon(a.w, a.echo.standard, true, true), weapons.get('308')]);
jobs.push(['50bmg_ambiance', (a) => window.renderWeapon(a.w, a.echo.standard, true, true), weapons.get('50bmg')]);
jobs.push(['meca_enreg', () => window.renderMeca(true), null], ['meca_synth', () => window.renderMeca(false), null], ['silence', () => window.renderSilence(), null]);

const info = { echo, bake: {}, armes: [...weapons.values()].map((w) => ({ id: w.id, caliber: w.caliber, name: w.name, bulletGr: w.bulletGr, v0: w.v0, chargeGr: w.chargeGr, muzzle: w.build?.muzzle, suppressed: w.suppressed })) };
for (const [name, fn, w] of jobs) {
  if (filtre && !name.includes(filtre)) continue;
  const r = await page.evaluate(fn, { w, echo });
  writeFileSync(resolve(out, name + '.wav'), wavFloat(Buffer.from(r.pcm, 'base64')));
  info.bake[name] = r.bake;
  console.log(name.padEnd(20), r.bake.recorded === null ? '' : (r.bake.recorded ? 'hybride' : 'synthèse') + `  cuisson ${r.bake.ms.toFixed(1)} ms`);
}
writeFileSync(resolve(out, 'rendus.json'), JSON.stringify(info, null, 1));
await browser.close();
if (errors.length) { console.log('ERREURS :\n' + errors.join('\n')); process.exit(1); }
console.log('rendus dans e2e/out/tir/audio/ — puis : python3 e2e/audio-mesures.py');
