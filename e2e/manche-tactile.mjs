// Ville nouvelle au doigt : la manche jouée sur téléphone en portrait (index.html?level=ville), par les commandes
// tactiles du solo (src/ui/touch.ts). « Tact » joue au doigt (vrais événements tactiles, protocole CDP) ; « Bob », sur
// ordinateur, lui sert de cible puis le touche et l'abat. Contrôles : rejoindre au doigt, viser en glissant, épauler,
// régler une tourelle, « Régler sur la cible », tirer, diversion et son délai, tableau déplié et replié, spectateur,
// et la géométrie (chevauchements, zone sûre, cibles de 44 px) à chaque étape.
//   PLAYWRIGHT_BROWSERS_PATH=0 node e2e/manche-tactile.mjs      (serveur de développement lancé)
// Captures dans .tmp/tactile-ligne/. Les robots de la salle tirent aussi : un essai peut être dérangé ; le script le dit.
import { mkdirSync } from 'node:fs';
import { Fingers, NONE, NOTCH, center, launch, setNotch, tb, visibleButtons } from './touchlib.mjs';

const OUT = '.tmp/tactile-ligne';
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.HR_URL || 'http://127.0.0.1:5173/') + '?level=ville&test&dr=0';
const browser = await launch();
const echecs = [], remarques = [];
const controle = (nom, ok, detail = '') => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${nom}${detail ? ' : ' + detail : ''}`); if (!ok) echecs.push(nom); };

const pret = (page) => page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
const enJeu = (page) => page.waitForFunction(() => window.hr.game.ready && window.hr.game.state === 'play' && window.hr.game.online.session.self?.vivant, null, { timeout: 260000 });
const images = (page, n = 3) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);

async function mobile(taille, notch, requete) {
  const ctx = await browser.newContext({ viewport: { width: taille[0], height: taille[1] }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.stack || e).slice(0, 300)));
  await page.goto(BASE + requete);
  await pret(page);
  if (notch !== NONE) await setNotch(page, notch);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, erreurs, doigts: new Fingers(cdp) };
}
async function ordinateur(pseudo) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}&pseudo=${pseudo}&auto`);
  await pret(page);
  return page;
}

/**
 * Géométrie de la manche à l'écran : boutons tactiles, valeurs et lignes des tourelles, blocs du mode (observateur,
 * tableau, jauge de vie, liste du spectateur) et du solo (vent, arme, souffle). Chevauchements, sorties de la zone
 * sûre, boutons de moins de 44 px, éléments posés sur le champ de la lunette.
 */
const geometrie = (page, notch) => page.evaluate((n) => {
  const W = window.innerWidth, H = window.innerHeight, safe = { l: n.left, t: n.top, r: W - n.right, b: H - n.bottom };
  const vu = (e) => {
    if (!e) return false;
    const b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return false;
    for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false; }
    return true;
  };
  const items = [];
  const boite = (nom, e, genre) => { if (vu(e)) { const b = e.getBoundingClientRect(); items.push({ nom, genre, l: b.left, t: b.top, r: b.right, b: b.bottom }); } };
  const texte = (nom, e) => { if (!vu(e) || !e.textContent.trim()) return; const rg = document.createRange(); rg.selectNodeContents(e); const b = rg.getBoundingClientRect(); if (b.width > 0) items.push({ nom, genre: 'texte', l: b.left, t: b.top, r: b.right, b: b.bottom }); };
  document.querySelectorAll('#touch [data-tb]').forEach((e) => boite('bouton ' + e.dataset.tb, e, 'bouton'));
  document.querySelectorAll('#touch output').forEach((e) => texte('valeur ' + e.dataset.o, e));
  document.querySelectorAll('#touch .tl-row small').forEach((e, i) => texte('libellé tourelle ' + i, e));
  document.querySelectorAll('#touch .tur-x').forEach((e, i) => texte('explication tourelle ' + i, e));
  boite('tableau de la manche', document.getElementById('ol-manche'), 'bloc');
  boite('jauge de vie', document.getElementById('ol-vie'), 'bloc');
  boite('bloc de l’observateur', document.getElementById('ol-vue'), 'bloc');
  boite('liste du spectateur', document.getElementById('ol-postes'), 'bouton');
  const hud = document.getElementById('hud');
  if (hud.classList.contains('on')) for (const [nom, sel] of [['vent (solo)', '.tr'], ['arme (solo)', '.bl'], ['souffle (solo)', '.br'], ['objectif (solo)', '.tl']]) texte(nom, hud.querySelector(sel));
  const v = window.hr.engine.view, lunette = document.getElementById('touch').classList.contains('scope');
  const chevauchements = [], horsZone = [], petits = [], surChamp = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (lunette) { const dx = Math.max(a.l - v.cx, 0, v.cx - a.r), dy = Math.max(a.t - v.cy, 0, v.cy - a.b); if (Math.hypot(dx, dy) < v.R - 1) surChamp.push(`${a.nom} (à ${Math.round(Math.hypot(dx, dy))} px du centre, rayon ${Math.round(v.R)})`); }
    if (a.l < safe.l - 0.5 || a.r > safe.r + 0.5 || a.t < safe.t - 0.5 || a.b > safe.b + 0.5) horsZone.push(`${a.nom} [${Math.round(a.l)},${Math.round(a.t)} → ${Math.round(a.r)},${Math.round(a.b)}]`);
    if (a.genre === 'bouton' && (a.r - a.l < 43.5 || a.b - a.t < 43.5)) petits.push(`${a.nom} ${Math.round(a.r - a.l)}×${Math.round(a.b - a.t)}`);
    for (let j = i + 1; j < items.length; j++) {
      const c = items[j], ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (ox > 1.5 && oy > 1.5) chevauchements.push(`${a.nom} × ${c.nom} (${Math.round(ox)}×${Math.round(oy)} px)`);
    }
  }
  return { noms: items.map((i) => i.nom), chevauchements, horsZone, petits, surChamp, champ: { haut: Math.round(v.cy - v.R), bas: Math.round(v.cy + v.R), diametre: Math.round(2 * v.R), part: Math.round((200 * v.R) / W) } };
}, notch);
const propre = (g) => g.chevauchements.length === 0 && g.horsZone.length === 0 && g.petits.length === 0 && g.surChamp.length === 0;
const dit = (g) => JSON.stringify({ chevauchements: g.chevauchements, horsZone: g.horsZone, petits: g.petits, surChamp: g.surChamp });

/** Dans la page `page` : lunette à l'œil, droit sur le tireur `pseudo` (tourelles à zéro). Dit s'il est en vue. */
const pointe = (page, pseudo) => page.evaluate(async (pseudo) => {
  const g = window.hr.game, o = g.online, s = o.session;
  const j = [...s.players.values()].find((q) => q.pseudo === pseudo), t = j && o.shooters.get(j.id);
  if (!t || t.down) return { absent: true };
  const id = 'tireur' + j.id;
  if (!g.canSee(id)) return { masque: true };
  const image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const eye = g.player.eye(g.engine.camera.position.clone()), a = t.aimPoint(eye.clone());
  const dist = a.distanceTo(eye), yaw = Math.atan2(a.x - eye.x, -(a.z - eye.z)), pitch = Math.asin((a.y - eye.y) / dist);
  g.rifle.elevClicks = 0; g.rifle.windClicks = 0; g.rifle.zoom = 25;
  if (!g.scope.active) g.scope.enter(yaw, pitch);
  g.player.yaw = yaw; g.player.pitch = pitch;
  for (let i = 0; i < 12; i++) await image();
  g.scope.yaw = yaw; g.scope.pitch = pitch; await image(); await image();
  return { id, cible: j.emp, dist: Math.round(dist), yaw, pitch };
}, pseudo);
/** Bob (ordinateur) tire sur `pseudo` : au corps (`haut` = 0) ou à la tête (0,62 m plus haut). */
const tireSur = async (page, pseudo, haut) => {
  await page.waitForFunction(() => window.hr.game.rifle.ready, null, { timeout: 10000 }).catch(() => {});
  const p = await pointe(page, pseudo);
  if (p.absent || p.masque) return p;
  return page.evaluate(async ([id, haut, dist]) => {
    const g = window.hr.game, image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    g.input.press('KeyG'); await image(); await image();
    g.autoAim(id); g.scope.pitch += haut / dist; await image(); await image();
    g.scope.swayX = g.scope.swayY = g.scope.kickX = g.scope.kickY = 0;
    const avant = g.shots.bullets.length; g.fire();
    return { parti: g.shots.bullets.length > avant || g.rifle.boltT > 0 };
  }, [p.id, haut, p.dist]);
};

async function manche(taille, notch) {
  const nom = `${taille[0]}x${taille[1]}`, cap = async (page, quoi) => { await page.screenshot({ path: `${OUT}/${quoi}-${nom}.png` }); console.log('capture', `${OUT}/${quoi}-${nom}.png`); };
  console.log(`\n=== manche au doigt en ${taille[0]} × ${taille[1]}${notch === NOTCH ? ' (encoche et barre d’accueil)' : ''} ===`);
  const { page, doigts, erreurs, ctx } = await mobile(taille, notch, '&pseudo=Tact');
  const tap = async (sel) => { const c = await center(page, sel); await doigts.tap(c.x, c.y); await page.waitForTimeout(160); return c; };

  // --- salon : rejoindre au doigt ---
  await page.waitForFunction(() => document.querySelector('#ol-salon [data-s="phase"]')?.textContent !== 'Connexion au serveur…', null, { timeout: 30000 });
  await page.waitForFunction(() => window.hr.game.ready, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  const salon = await page.evaluate(() => ({ tactile: window.hr.touch, classes: document.documentElement.className, etat: window.hr.game.state, jouer: (() => { const b = document.querySelector('#ol-salon [data-s="jouer"]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })() }));
  controle('salon : appareil tactile en portrait, bouton « Rejoindre » d’au moins 44 px', salon.tactile && /\bportrait\b/.test(salon.classes) && salon.etat === 'lobby' && salon.jouer[1] >= 44, JSON.stringify(salon));
  await cap(page, 'salon');
  await tap('#ol-salon [data-s="jouer"]');
  await enJeu(page);
  const bobOuvre = async () => { const b = await ordinateur('Bob'); await enJeu(b); return b; };
  let bob = await bobOuvre();
  await page.waitForTimeout(1500);
  controle('rejoint au doigt : en manche, debout sur un emplacement', await page.evaluate(() => window.hr.game.state === 'play' && !!window.hr.game.online.place));

  // --- œil nu ---
  let g = await geometrie(page, notch), b = await visibleButtons(page);
  const nu = await page.evaluate(() => { const vu = (id) => document.getElementById(id).style.display !== 'none'; return { vue: vu('ol-vue'), encart: vu('ol-tourelles'), noms: vu('ol-noms'), vie: vu('ol-vie'), explications: [...document.querySelectorAll('#touch .tur-x')].some((e) => e.getBoundingClientRect().width > 0), arme: document.querySelector('#hud .bl').textContent.replace(/\s+/g, ' ').trim() }; });
  controle('œil nu : seuls Pause, Épauler et Diversion (et Recharger s’il y a lieu)', b.filter((x) => x !== 'reload').sort().join() === 'aim,divert,pause', b.join());
  controle('œil nu : ni observateur, ni tourelles, ni pseudo ; jauge de vie, arme et calibre', !nu.vue && !nu.encart && !nu.noms && !nu.explications && nu.vie && /CHEYTAC|\d/.test(nu.arme), JSON.stringify(nu));
  controle('œil nu : rien ne se chevauche, tout dans la zone sûre, cibles ≥ 44 px', propre(g), dit(g));
  await cap(page, 'oeil-nu');

  // --- viser en glissant : toute la surface regarde, la manette est désarmée (tireur fixe) ---
  const avant = await page.evaluate(() => ({ yaw: window.hr.game.player.yaw, x: window.hr.game.player.pos.x, z: window.hr.game.player.pos.z }));
  await doigts.down(1, taille[0] * 0.25, taille[1] * 0.62); await doigts.slide(1, taille[0] * 0.25 + 70, taille[1] * 0.62 - 10, 8); await images(page);
  const pendant = await page.evaluate(() => ({ manette: window.hr.game.touchCtl.stickActive, axe: Math.hypot(window.hr.game.input.axisX, window.hr.game.input.axisY) }));
  await doigts.up(1); await images(page);
  const apres = await page.evaluate(() => ({ yaw: window.hr.game.player.yaw, x: window.hr.game.player.pos.x, z: window.hr.game.player.pos.z }));
  controle('glisser dans le bas gauche regarde, sans manette ni déplacement', Math.abs(apres.yaw - avant.yaw) > 0.05 && !pendant.manette && pendant.axe === 0 && Math.hypot(apres.x - avant.x, apres.z - avant.z) < 0.01, `cap ${avant.yaw.toFixed(2)} → ${apres.yaw.toFixed(2)}`);

  // --- épauler au doigt ---
  await tap(tb('aim')); await page.waitForTimeout(900);
  controle('Épauler : lunette à l’œil, debout', await page.evaluate(() => window.hr.game.scope.active && window.hr.game.player.stance === 'stand'));
  b = await visibleButtons(page);
  const attendus = ['aim', 'breath', 'divert', 'e+1', 'e+10', 'e-1', 'e-10', 'fire', 'pause', 'target', 'w+1', 'w+10', 'w-1', 'w-10', 'zin', 'zout'];
  controle('lunette : Tirer, Quitter, Souffle, tourelles, grossissement, Pause, « Régler sur la cible », Diversion ; rien d’autre', b.filter((x) => x !== 'reload').sort().join() === attendus.join(), b.join());
  const s0 = await page.evaluate(() => window.hr.game.scope.yaw);
  await doigts.down(1, taille[0] * 0.5, taille[1] * 0.3); await doigts.slide(1, taille[0] * 0.5 + 40, taille[1] * 0.3 + 12, 8); await doigts.up(1); await images(page);
  const s1 = await page.evaluate(() => window.hr.game.scope.yaw);
  controle('lunette : glisser sur le champ déplace la visée', Math.abs(s1 - s0) > 0.002, `${s0.toFixed(4)} → ${s1.toFixed(4)}`);

  // --- régler une tourelle au doigt ---
  await page.evaluate(() => { window.hr.game.rifle.elevClicks = 0; window.hr.game.rifle.windClicks = 0; });
  await tap(tb('e+1')); await tap(tb('e+1')); await tap(tb('e+10')); await tap(tb('w-1'));
  const tur = await page.evaluate(() => ({ elev: window.hr.game.rifle.elevMil, deriv: window.hr.game.rifle.windMil, lu: [...document.querySelectorAll('#touch .tg-turret output')].map((e) => e.textContent), aide: [...document.querySelectorAll('#touch .tur-x')].map((e) => e.textContent) }));
  controle('tourelles : + + +1 puis G = 1,2 et G 0,1, lus près des boutons, avec une ligne d’explication chacune', Math.abs(tur.elev - 1.2) < 1e-6 && Math.abs(tur.deriv + 0.1) < 1e-6 && tur.lu[0] === '1,2' && tur.lu[1] === 'G 0,1' && tur.aide.length === 2 && tur.aide.every((t) => t.length > 20), JSON.stringify(tur));
  g = await geometrie(page, notch);
  controle('lunette, personne en vue : rien ne se chevauche, rien sur le champ, zone sûre, cibles ≥ 44 px', propre(g), dit(g));
  console.log(`champ de la lunette : ${g.champ.diametre} px de diamètre (${g.champ.part} % de la largeur), de y = ${g.champ.haut} à ${g.champ.bas}`);
  await cap(page, 'lunette-vide');

  // --- Bob dans la lunette (visée posée par le script : le balayage au doigt est contrôlé plus haut) ---
  let v = null;
  for (let essai = 1; essai <= 8; essai++) {
    v = await pointe(page, 'Bob');
    if (!v.masque && !v.absent) break;
    console.log(`essai ${essai} : Bob ${v.absent ? 'absent ou abattu' : 'masqué'}, il reparaît ailleurs`);
    await bob.close(); bob = await bobOuvre(); await page.waitForTimeout(1500);
  }
  if (!v || v.masque || v.absent) { controle('Bob en vue de Tact', false, 'huit essais sans ligne de visée'); await bob.close(); await ctx.close(); return; }
  await page.waitForTimeout(300);
  const vue = await page.evaluate(() => ({ observateur: document.getElementById('ol-vue').textContent, vu: document.getElementById('ol-vue').style.display !== 'none', noms: [...document.querySelectorAll('#ol-noms div')].filter((d) => d.style.display !== 'none').map((d) => d.textContent), fond: getComputedStyle(document.querySelector('#ol-noms div')).backgroundColor, tourelles: document.querySelector('#touch .tg-turret').textContent.replace(/\s+/g, ' '), cible: document.querySelector('#touch [data-tb="target"]').textContent }));
  controle('lunette sur Bob : bloc de l’observateur (poste, distance, correction) en haut, pseudo seul et sans fond', vue.vu && vue.observateur.includes(v.cible) && /Correction/.test(vue.observateur) && vue.noms.length === 1 && vue.noms[0] === 'Bob' && /rgba\(0, 0, 0, 0\)|transparent/.test(vue.fond), `« ${vue.observateur} » · ${JSON.stringify(vue.noms)}`);
  controle('zone des tourelles : l’état du réglage et son explication, ni correction, ni écart, ni sens, ni « reste »', !/correction|écart|reste|tournez|trop|manque|contre|↑|→|←/i.test(vue.tourelles), vue.tourelles.slice(0, 200));
  g = await geometrie(page, notch);
  controle('lunette sur Bob : rien ne se chevauche, rien sur le champ, zone sûre, cibles ≥ 44 px', propre(g), dit(g));
  await cap(page, 'lunette-tireur');

  // --- « Régler sur la cible » au doigt ---
  await tap(tb('target')); await images(page, 4);
  const regle = await page.evaluate(async (id) => {
    const gm = window.hr.game, yaw = gm.scope.yaw, pitch = gm.scope.pitch, r = { elev: gm.rifle.elevMil, deriv: gm.rifle.windMil, lu: [...document.querySelectorAll('#touch .tg-turret output')].map((e) => e.textContent), observateur: document.getElementById('ol-vue').textContent };
    gm.autoAim(id);
    return { ...r, reste: { haut: (gm.scope.pitch - pitch) * 1000, droite: (gm.scope.yaw - yaw) * 1000 * Math.cos(pitch) } };
  }, v.id);
  controle('« Régler sur la cible » règle les deux tourelles (reste à tenir sous 0,15 mrad, hors contre-visée)', regle.elev > 0 && Math.abs(regle.reste.droite) < 0.15 && (Math.abs(regle.reste.haut) < 0.15 || /contre-visée/.test(regle.observateur)), `élévation ${regle.elev.toFixed(1)}, dérive ${regle.deriv.toFixed(1)}, lu ${JSON.stringify(regle.lu)}, reste ${regle.reste.haut.toFixed(2)} / ${regle.reste.droite.toFixed(2)} mrad`);

  // --- tirer au doigt : la touche revient du serveur, bandeau doré du solo ---
  await page.evaluate(() => { const s = window.hr.game.scope; s.swayX = s.swayY = s.kickX = s.kickY = 0; });
  const t0 = await page.evaluate(() => ({ tirs: window.hr.game.online.session.self.tirs, touches: window.hr.game.online.session.self.touches, mag: window.hr.game.rifle.mag }));
  await tap(tb('fire'));
  await page.waitForTimeout(350);
  const t1 = await page.evaluate(() => ({ tirs: window.hr.game.online.session.self.tirs, mag: window.hr.game.rifle.mag, chambre: window.hr.game.rifle.chambered }));
  controle('Tirer au doigt : le coup part, le compteur de tirs monte', t1.tirs === t0.tirs + 1, `${t0.tirs} → ${t1.tirs}`);
  const bandeau = await page.waitForFunction(() => { const p = document.querySelector('.praise.on'); return p && Number(getComputedStyle(p).opacity) > 0.9 ? p.textContent : false; }, null, { timeout: 12000, polling: 50 }).then((h) => h.jsonValue()).catch(() => null);
  if (bandeau) {
    const pb = await page.evaluate(() => { const p = document.querySelector('.praise'), bx = p.getBoundingClientRect(); return { l: Math.round(bx.left), r: Math.round(bx.right), t: Math.round(bx.top), b: Math.round(bx.bottom), w: window.innerWidth }; });
    await cap(page, 'touche-reussie');
    controle('touche réussie : bandeau doré du solo, entier à l’écran', /Touché|Abattu/.test(bandeau) && pb.l >= 0 && pb.r <= pb.w, `« ${bandeau} » [${pb.l},${pb.t} → ${pb.r},${pb.b}]`);
  } else { remarques.push(`${nom} : pas de touche après le tir (Bob a pu bouger ou être abattu par un robot) : bandeau non capturé`); controle('touche réussie : bandeau doré', false, 'aucune touche annoncée'); }

  // --- diversion au doigt : une passe, puis bouton éteint pendant le délai ---
  await page.waitForTimeout(600);
  const d0 = await page.evaluate(() => window.hr.game.online.diversions);
  await tap(tb('divert')); await page.waitForTimeout(700);
  const d1 = await page.evaluate(() => { const e = document.querySelector('#touch [data-tb="divert"]'); return { n: window.hr.game.online.diversions, attente: e.classList.contains('wait'), texte: e.textContent.trim() }; });
  await tap(tb('divert')); await page.waitForTimeout(500);
  const d2 = await page.evaluate(() => window.hr.game.online.diversions);
  controle('Diversion au doigt : elle part, le bouton s’éteint et compte les secondes, un second appui ne fait rien', d1.n === d0 + 1 && d1.attente && /^\d+ s$/.test(d1.texte) && d2 === d1.n, `${d0} → ${d1.n} → ${d2}, bouton « ${d1.texte} »`);
  await cap(page, 'diversion-attente');

  // --- tableau de la manche : déplié puis replié au doigt ---
  await tap('#ol-manche .ol-resume'); await page.waitForTimeout(300);
  const ouvert = await page.evaluate(() => { const m = document.getElementById('ol-manche'), bx = m.getBoundingClientRect(); return { ouvert: window.hr.game.online.board.open, corps: !!m.querySelector('.ol-corps'), lignes: m.querySelectorAll('.ol-corps > div').length, l: Math.round(bx.left), b: Math.round(bx.bottom), h: window.innerHeight }; });
  await cap(page, 'tableau-deplie');
  await tap('#ol-manche .ol-resume'); await page.waitForTimeout(300);
  const ferme = await page.evaluate(() => ({ ouvert: window.hr.game.online.board.open, corps: !!document.querySelector('#ol-manche .ol-corps'), lunette: window.hr.game.scope.active }));
  controle('tableau : un toucher le déplie (classement), un autre le replie, sans quitter la lunette ni tirer', ouvert.ouvert && ouvert.corps && ouvert.lignes >= 2 && ouvert.l >= 0 && ouvert.b <= ouvert.h && !ferme.ouvert && !ferme.corps && ferme.lunette, JSON.stringify(ouvert));

  // --- Recharger au doigt (chargeur entamé : le bouton est là) ---
  const rech = await visibleButtons(page);
  if (rech.includes('reload')) {
    g = await geometrie(page, notch);
    controle('lunette, bouton Recharger affiché : rien ne se chevauche, rien sur le champ', propre(g), dit(g));
    await tap(tb('reload')); await page.waitForTimeout(200);
    controle('Recharger au doigt : le rechargement commence', await page.evaluate(() => window.hr.game.rifle.reloadT > 0 || window.hr.game.rifle.mag === window.hr.game.rifle.def.magazine || window.hr.game.rifle.chambered));
  } else remarques.push(`${nom} : bouton Recharger absent après un tir (${JSON.stringify(t1)})`);

  // --- touché, puis abattu : Bob tire sur Tact ---
  const vie0 = await page.evaluate(() => window.hr.game.online.session.life);
  let r = await tireSur(bob, 'Tact', 0);
  if (r.parti) {
    const flash = await page.waitForFunction(() => window.hr.game.online.panel.veiled === 'flash', null, { timeout: 15000, polling: 50 }).then(() => true).catch(() => false);
    if (flash) { await cap(page, 'touche'); const vie1 = await page.evaluate(() => window.hr.game.online.session.life); controle('touché au corps : voile « touché », un point de vie en moins, toujours en jeu', vie1 === vie0 - 1 && await page.evaluate(() => window.hr.game.state === 'play'), `vie ${vie0} → ${vie1}`); }
    else remarques.push(`${nom} : le tir de Bob au corps n'a pas donné de voile « touché » (état ${await page.evaluate(() => window.hr.game.state)})`);
  } else remarques.push(`${nom} : Bob n'a pas pu tirer sur Tact (${JSON.stringify(r)})`);
  for (let essai = 0; essai < 3 && await page.evaluate(() => window.hr.game.state !== 'down'); essai++) {
    r = await tireSur(bob, 'Tact', 0.62);
    await page.waitForFunction(() => window.hr.game.state === 'down', null, { timeout: 9000, polling: 50 }).catch(() => {});
  }
  const bas = await page.evaluate(() => ({ etat: window.hr.game.state, voile: window.hr.game.online.panel.veiled, commandes: document.getElementById('touch').classList.contains('on'), texte: document.getElementById('ol-voile').textContent }));
  if (bas.etat === 'down') { await page.waitForTimeout(250); await cap(page, 'abattu'); }
  controle('abattu : voile « abattu », commandes tactiles retirées', bas.etat === 'down' && bas.voile === 'down' && !bas.commandes && /Abattu par/.test(bas.texte), JSON.stringify(bas));
  await page.waitForFunction(() => window.hr.game.state === 'play' && window.hr.game.online.session.life === 2, null, { timeout: 12000 }).catch(() => {});
  const retour = await page.evaluate(() => ({ etat: window.hr.game.state, voile: window.hr.game.online.panel.veiled, commandes: document.getElementById('touch').classList.contains('on'), enfonces: window.hr.game.touchCtl.pressed }));
  controle('retour : en jeu, voile levé, commandes revenues, rien d’enfoncé', retour.etat === 'play' && retour.voile === null && retour.commandes && retour.enfonces.length === 0, JSON.stringify(retour));
  controle('aucune erreur de page (joueur)', erreurs.length === 0, erreurs.join(' | '));
  await ctx.close();

  // --- spectateur au doigt (Bob reste : la salle n'accepte un spectateur que s'il y a un joueur) ---
  const sp = await mobile(taille, notch, '&auto=spectateur');
  await sp.page.waitForFunction(() => window.hr.game.ready && window.hr.game.state === 'play' && window.hr.game.online.session.role === 'spectateur', null, { timeout: 260000 });
  await sp.page.waitForTimeout(1500);
  g = await geometrie(sp.page, notch); b = await visibleButtons(sp.page);
  const liste = await sp.page.evaluate(() => { const e = document.getElementById('ol-postes'), bx = e.getBoundingClientRect(), dessus = document.elementFromPoint(bx.left + bx.width / 2, bx.top + bx.height / 2); return { vu: e.style.display !== 'none', w: Math.round(bx.width), h: Math.round(bx.height), atteignable: dessus === e, n: e.options.length, place: window.hr.game.online.place, corps: parseFloat(getComputedStyle(e).fontSize) }; });
  controle('spectateur : seuls Pause et Épauler ; ni tir, ni diversion, ni jauge de vie', b.sort().join() === 'aim,pause' && !g.noms.includes('jauge de vie'), b.join());
  controle('spectateur : liste des emplacements au doigt (≥ 44 px, rien devant, texte de 16 px)', liste.vu && liste.h >= 44 && liste.w >= 120 && liste.atteignable && liste.n > 1 && liste.corps >= 16, JSON.stringify(liste));
  controle('spectateur, œil nu : rien ne se chevauche, zone sûre', propre(g), dit(g));
  // le sélecteur natif du téléphone ne se pilote pas ici : le choix est posé par l'API, comme le ferait la roue du système
  const autre = await sp.page.evaluate(() => { const e = document.getElementById('ol-postes'); return [...e.options].map((o) => o.value).find((x) => x !== window.hr.game.online.place && !window.hr.game.online.session.occupied().has(x)); });
  await sp.page.selectOption('#ol-postes', autre); await sp.page.waitForTimeout(1800);
  // (capture après le changement d'emplacement : à l'arrivée d'un spectateur, l'image peut rester noire quelques
  // secondes, sur ordinateur aussi ; ce défaut n'est pas du ressort des commandes tactiles)
  await cap(sp.page, 'spectateur');
  controle('spectateur : choisir un emplacement y transporte', await sp.page.evaluate((a) => window.hr.game.online.place === a, autre), `${liste.place} → ${autre}`);
  await tap2(sp, tb('aim')); await sp.page.waitForTimeout(900);
  b = await visibleButtons(sp.page); g = await geometrie(sp.page, notch);
  controle('spectateur en lunette : Quitter, grossissement, Pause ; liste retirée', b.sort().join() === 'aim,pause,zin,zout' && !g.noms.includes('liste du spectateur'), b.join());
  controle('spectateur en lunette : rien ne se chevauche, rien sur le champ', propre(g), dit(g));
  await cap(sp.page, 'spectateur-lunette');
  controle('aucune erreur de page (spectateur)', sp.erreurs.length === 0, sp.erreurs.join(' | '));
  await sp.ctx.close(); await bob.close();
}
async function tap2(m, sel) { const c = await center(m.page, sel); await m.doigts.tap(c.x, c.y); await m.page.waitForTimeout(160); }

const seule = process.argv.includes('--petit') ? [[375, 667]] : process.argv.includes('--grand') ? [[390, 844]] : [[375, 667], [390, 844]];
for (const taille of seule) await manche(taille, taille[1] > 700 ? NOTCH : NONE);
await browser.close();
for (const r of remarques) console.log('remarque :', r);
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S) : ${echecs.join(' ; ')}` : '\nTous les contrôles passent.');
process.exit(echecs.length ? 1 : 0);
