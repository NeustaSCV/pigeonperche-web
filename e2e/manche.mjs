// Ville nouvelle : duel de contrôle entre deux navigateurs sur la manche du serveur, dans le moteur du solo
// (index.html?level=ville). Anna touche Bob au corps puis à la tête ; on contrôle la vie, les points, le compteur de
// tirs, la réapparition et la diversion.
//   node e2e/manche.mjs                    (serveur de développement lancé)
//   node e2e/manche.mjs --captures         en plus : captures en 1440 × 900 et 1280 × 720 dans .tmp/manche-solo/
//   node e2e/manche.mjs --salon            en plus : attend la fin de la manche, vote au salon, rentre dans la suivante
// Les robots de la salle tirent aussi : un essai peut être dérangé (Bob abattu par un robot) ; le script le dit.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const CAPTURES = process.argv.includes('--captures'), SALON = process.argv.includes('--salon');
const OUT = CAPTURES ? '.tmp/manche-solo' : 'e2e/out';
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.HR_URL || 'http://127.0.0.1:5173/') + '?level=ville&test&dr=0';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const echecs = [];
const controle = (nom, ok, detail = '') => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${nom}${detail ? ' : ' + detail : ''}`); if (!ok) echecs.push(nom); };

const ouvre = async (pseudo, [w, h], auto = true) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.log('ERREUR', pseudo, String(e).slice(0, 300)); echecs.push('erreur de page ' + pseudo); });
  await page.goto(BASE + (pseudo ? '&pseudo=' + pseudo : '') + (auto ? '&auto' : ''));
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  return page;
};
/** Attend que la page soit en manche, debout sur son emplacement (au pire : une minute de salon, puis le chargement). */
const enJeu = (page) => page.waitForFunction(() => window.hr.game.ready && window.hr.game.state === 'play' && window.hr.game.online.session.self?.vivant, null, { timeout: 260000 });
const etat = (p) => p.evaluate(() => {
  const g = window.hr.game, o = g.online, s = o.session, m = s.self;
  return { etat: g.state, emp: o.place, vie: s.life, points: m?.points, touches: m?.touches, tirs: m?.tirs, subies: m?.subies, voile: o.panel.veiled, salle: s.players.size, robots: [...s.players.values()].filter((j) => j.robot).length, cibles: o.shooters.size, annonce: s.announce };
});
const cap = async (page, nom, taille) => { if (CAPTURES) { await page.screenshot({ path: `${OUT}/${nom}-${taille[0]}x${taille[1]}.png` }); console.log('capture', `${OUT}/${nom}-${taille[0]}x${taille[1]}.png`); } };

/** Dans la page d'Anna : vise le tireur `pseudo` (lunette, G, visée parfaite), décale de `haut` mètres, et tire si `tirer`. */
const vise = (page, pseudo, haut, tirer) => page.evaluate(async ([pseudo, haut, tirer]) => {
  const g = window.hr.game, o = g.online, s = o.session;
  const j = [...s.players.values()].find((q) => q.pseudo === pseudo), t = j && o.shooters.get(j.id);
  if (!t || t.down) return { absent: true };
  const id = 'tireur' + j.id;
  if (!g.canSee(id)) return { masque: true };
  const image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const eye = g.player.eye(g.engine.camera.position.clone()), a = t.aimPoint(eye.clone());
  const dist = a.distanceTo(eye), yaw = Math.atan2(a.x - eye.x, -(a.z - eye.z)), pitch = Math.asin((a.y - eye.y) / dist);
  // droit sur le tireur, tourelles à zéro : il est « dans la lunette » ; la touche G règle alors les deux tourelles
  g.rifle.elevClicks = 0; g.rifle.windClicks = 0; g.rifle.zoom = 25;
  g.scope.enter(yaw, pitch); g.player.yaw = yaw; g.player.pitch = pitch;
  for (let i = 0; i < 12; i++) await image();
  g.scope.yaw = yaw; g.scope.pitch = pitch; await image(); await image();
  const observateur = document.getElementById('ol-vue').textContent;
  g.input.press('KeyG'); await image(); await image();
  const tourelles = { elev: g.rifle.elevMil, deriv: g.rifle.windMil };
  // visée parfaite avec ces réglages : ce qui reste à tenir au réticule dit si le réglage de G était le bon
  g.autoAim(id);
  const reste = { haut: (g.scope.pitch - pitch) * 1000, droite: (g.scope.yaw - yaw) * 1000 * Math.cos(pitch) };
  g.scope.pitch += haut / dist;
  await image(); await image();
  const nomVu = [...document.querySelectorAll('#ol-noms div')].filter((d) => d.style.display !== 'none').map((d) => d.textContent);
  const r = { cible: j.emp, dist: Math.round(dist), observateur, tourelles, reste, nomVu, encart: document.getElementById('ol-tourelles').style.display !== 'none' };
  if (!tirer) return r;
  // le tremblement du tireur debout n'est pas l'objet du contrôle
  const pret = g.rifle.ready; g.scope.swayX = g.scope.swayY = g.scope.kickX = g.scope.kickY = 0;
  const avant = g.shots.bullets.length; g.fire();
  return { ...r, pret, parti: g.shots.bullets.length > avant || g.rifle.boltT > 0 };
}, [pseudo, haut, tirer]);

async function duel(taille) {
  console.log(`\n=== duel en ${taille[0]} × ${taille[1]} ===`);
  // --- salon, avant d'entrer ---
  const anna = await ouvre('Anna', taille, false);
  await anna.waitForFunction(() => document.querySelector('#ol-salon [data-s="phase"]')?.textContent !== 'Connexion au serveur…', null, { timeout: 30000 });
  await anna.waitForFunction(() => window.hr.game.ready, null, { timeout: 180000 });      // carte chargée : le plan du salon est le sien
  await anna.waitForTimeout(800);
  const salon = await anna.evaluate(() => ({ vu: document.getElementById('ol-salon').style.display !== 'none', etat: window.hr.game.state, pseudo: document.querySelector('#ol-salon [data-s="pseudo"]').value, jouer: !document.querySelector('#ol-salon [data-s="jouer"]').disabled, hud: document.getElementById('hud').className }));
  controle('salon ouvert par ?level=ville, pseudo proposé, bouton prêt', salon.vu && salon.etat === 'lobby' && salon.pseudo === 'Anna' && salon.jouer && salon.hud.includes('online'), JSON.stringify(salon));
  await cap(anna, 'salon', taille);
  await anna.click('#ol-salon [data-s="jouer"]');
  await enJeu(anna);
  let bob = await ouvre('Bob', taille); await enJeu(bob);
  await anna.waitForTimeout(1200);
  const e0 = await etat(anna);
  console.log('entrée, côté Anna', JSON.stringify(e0));
  controle('les autres tireurs sont des cibles du jeu (humain et robots)', e0.cibles === e0.salle - 1 && e0.salle >= 2 && e0.vie === 2, `${e0.cibles} cibles pour ${e0.salle} tireurs dont ${e0.robots} robots`);
  // --- œil nu : arme à la première personne, ni pseudo ni bloc de l'observateur ---
  const nu = await anna.evaluate(() => { const o = window.hr.game.online, vu = (id) => document.getElementById(id).style.display !== 'none'; return { arme: o.rifle.visible, vue: vu('ol-vue'), tourelles: vu('ol-tourelles'), noms: vu('ol-noms'), vie: vu('ol-vie'), corps: window.hr.game.player.char.group.visible, pouls: getComputedStyle(document.querySelector('#hud .r-pulse')).display, elev: getComputedStyle(document.querySelector('#hud .r-elev')).display, chargeur: document.querySelector('#hud [data-id="wMag"]').textContent }; });
  controle('œil nu : arme visible, jauge de vie, rien de l’observateur ni des tourelles, pas de pouls, chargeur de 3', nu.arme && nu.vie && !nu.vue && !nu.tourelles && !nu.noms && !nu.corps && nu.pouls === 'none' && nu.elev === 'none' && nu.chargeur === '1 + 2', JSON.stringify(nu));
  await cap(anna, 'oeil-nu', taille);

  // --- Bob doit être en vue d'Anna : sinon il reparaît ailleurs ---
  let v = null;
  for (let essai = 1; essai <= 10; essai++) {
    v = await vise(anna, 'Bob', 0, false);
    if (!v.masque && !v.absent) break;
    console.log(`essai ${essai} : Bob ${v.absent ? 'absent ou abattu' : 'masqué'}, il reparaît ailleurs`);
    await anna.evaluate(() => window.hr.game.scope.exit());
    await bob.close(); bob = await ouvre('Bob', taille); await enJeu(bob); await anna.waitForTimeout(1500);
  }
  if (!v || v.masque || v.absent) { controle('Bob en vue d’Anna', false, 'dix essais sans ligne de visée'); await anna.close(); await bob.close(); return; }
  console.log('visée', JSON.stringify(v));
  controle('lunette : bloc de l’observateur (poste, distance, correction), encart des tourelles, pseudo au-dessus de la tête', v.observateur.includes(v.cible) && /Correction/.test(v.observateur) && v.encart && v.nomVu.length === 1 && v.nomVu[0] === 'Bob', `« ${v.observateur} » · pseudos ${JSON.stringify(v.nomVu)}`);
  controle('G règle les tourelles sur la cible (reste à tenir sous 0,15 mrad, hors contre-visée)', Math.abs(v.reste.droite) < 0.15 && (Math.abs(v.reste.haut) < 0.15 || /contre-visée/.test(v.observateur)), `élévation ${v.tourelles.elev.toFixed(1)}, dérive ${v.tourelles.deriv.toFixed(1)}, reste ${v.reste.haut.toFixed(2)} / ${v.reste.droite.toFixed(2)} mrad`);
  const interdit = await anna.evaluate(() => document.getElementById('ol-tourelles').textContent);
  controle('encart des tourelles : ni correction, ni écart, ni sens, ni « reste »', !/correction|écart|reste|tournez|trop|manque/i.test(interdit), interdit.replace(/\s+/g, ' ').slice(0, 160));
  await anna.waitForTimeout(400);
  await cap(anna, 'lunette', taille);
  if (CAPTURES) {
    // le tireur distant vu par une caméra de test : à 300 m dans le champ d'une lunette × 25, puis de près, de trois quarts et de profil
    const vue = (d, fov, biais, haut = 0) => anna.evaluate(([d, fov, biais, haut]) => {
      const g = window.hr.game, t = [...g.online.shooters.values()].find((q) => q.label === 'Bob'), y = t.yaw + biais;
      g.scope.exit(); g.online.rifle.scale.setScalar(0);      // la caméra de test n'est pas l'œil du joueur : sa propre arme est retirée de l'image
      g.testCam = { pos: [t.feet.x + Math.sin(y) * d, t.feet.y + 1.3 + haut, t.feet.z - Math.cos(y) * d], look: [t.feet.x, t.feet.y + 1.2, t.feet.z], fov: fov || g.engine.scopeFov(25) };
    }, [d, fov, biais, haut]);
    await vue(300, 0, 0.5, 8); await anna.waitForTimeout(700); await cap(anna, 'tireur-300m', taille);
    await vue(90, 0, 0.5, 3); await anna.waitForTimeout(700); await cap(anna, 'tireur-90m', taille);
    await vue(3.2, 40, 0.7); await anna.waitForTimeout(700); await cap(anna, 'tireur-de-pres', taille);
    await vue(3.2, 40, 1.57); await anna.waitForTimeout(700); await cap(anna, 'tireur-de-profil', taille);
    await anna.evaluate(() => { window.hr.game.testCam = null; window.hr.game.online.rifle.scale.setScalar(1); });
    await anna.waitForTimeout(300);
    await vise(anna, 'Bob', 0, false);      // lunette à l'œil de nouveau, pour la suite
  }

  // --- Maj + flèche : 1 mrad sur les deux tourelles ; un seul cran sonne (celui du mode) ---
  const maj = await anna.evaluate(async () => {
    const g = window.hr.game, image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let mode = 0, solo = 0; const a = g.online.sounds.turretClick.bind(g.online.sounds), b = g.audio.turretClick.bind(g.audio);
    g.online.sounds.turretClick = () => { mode++; return a(); }; g.audio.turretClick = () => { solo++; return b(); };
    const e0 = g.rifle.elevClicks, w0 = g.rifle.windClicks;
    g.input.keys.add('ShiftLeft'); g.input.press('ArrowUp'); await image(); g.input.press('ArrowRight'); await image(); g.input.keys.delete('ShiftLeft');
    g.input.press('ArrowDown'); await image();
    const r = { elev: g.rifle.elevClicks - e0, deriv: g.rifle.windClicks - w0, mode, solo };
    g.rifle.elevClicks = e0; g.rifle.windClicks = w0; g.online.sounds.turretClick = a; g.audio.turretClick = b;
    return r;
  });
  controle('Maj + flèche : 1 mrad sur chaque tourelle ; cran du mode seul', maj.elev === 9 && maj.deriv === 10 && maj.mode === 3 && maj.solo === 0, JSON.stringify(maj));

  // --- balle dans le corps ---
  const b0 = await etat(bob), a0 = await etat(anna);
  let t = await vise(anna, 'Bob', 0, true);
  console.log('tir au corps', JSON.stringify(t));
  await anna.waitForTimeout(350);
  const a1 = await etat(anna);
  controle('le compteur de tirs d’Anna monte dès le tir', a1.tirs === a0.tirs + 1, `${a0.tirs} → ${a1.tirs}`);
  await bob.waitForFunction((vie) => window.hr.game.online.session.life < vie || !window.hr.game.online.session.self?.vivant, b0.vie, { timeout: 15000 }).catch(() => {});
  const b1 = await etat(bob);
  await cap(bob, 'touche', taille);
  await cap(anna, 'touche-vue-du-tireur', taille);
  await anna.waitForTimeout(250);
  const a2 = await etat(anna), pts = Math.max(1, Math.round(t.dist / 10));
  console.log('après le corps, Anna', JSON.stringify(a2)); console.log('après le corps, Bob ', JSON.stringify(b1));
  controle('corps : Bob perd un point de vie, reste debout, voile « touché »', b1.vie === b0.vie - 1 && b1.etat === 'play' && b1.voile === 'flash' && b1.subies === b0.subies + 1, `vie ${b0.vie} → ${b1.vie}, voile ${b1.voile}`);
  controle('corps : un point par tranche de 10 m pour Anna', a2.touches === a0.touches + 1 && Math.abs(a2.points - a0.points - pts) <= 4, `+${a2.points - a0.points} points à ${t.dist} m`);

  // --- balle dans la tête (la culasse d'abord) ---
  await anna.waitForFunction(() => window.hr.game.rifle.ready, null, { timeout: 8000 });
  t = await vise(anna, 'Bob', 0.62, true);
  console.log('tir à la tête', JSON.stringify(t));
  await bob.waitForFunction(() => window.hr.game.state === 'down', null, { timeout: 15000 }).catch(() => {});
  await bob.waitForTimeout(300);
  await cap(bob, 'abattu', taille);
  const b2 = await etat(bob), a3 = await etat(anna);
  console.log('après la tête, Anna', JSON.stringify(a3)); console.log('après la tête, Bob ', JSON.stringify(b2));
  controle('tête : Bob abattu, voile « abattu », lunette quittée', b2.vie === 0 && b2.etat === 'down' && b2.voile === 'down', `état ${b2.etat}, vie ${b2.vie}`);
  controle('tête : 150 % des points', a3.touches === a2.touches + 1 && Math.abs(a3.points - a2.points - Math.round(pts * 1.5)) <= 6, `+${a3.points - a2.points} points · « ${a3.annonce} »`);
  // --- retour cinq secondes plus tard, ailleurs, avec toute sa vie ---
  await bob.waitForFunction(() => window.hr.game.state === 'play' && window.hr.game.online.session.life === 2, null, { timeout: 12000 }).catch(() => {});
  const b3 = await etat(bob);
  controle('réapparition : Bob de retour ailleurs, deux points de vie, voile levé', b3.etat === 'play' && b3.vie === 2 && b3.emp !== b2.emp && b3.voile === null, `${b2.emp} → ${b3.emp}`);

  // --- diversion : Bob la fait (touche V), Anna l'entend au loin, Bob de près ; dix secondes entre deux ---
  const espion = (p) => p.evaluate(() => { const s = window.hr.game.online.sounds; window.__div = []; for (const k of ['diversionSelf', 'diversionFar']) { const f = s[k].bind(s); s[k] = (...a) => { const r = f(...a); window.__div.push([k, ...a.map((x) => Math.round(x * 100) / 100), r]); return r; }; } });
  await espion(anna); await espion(bob);
  await bob.mouse.click(400, 300); await anna.mouse.click(400, 300);      // un geste : le son démarre
  await bob.keyboard.press('KeyV'); await bob.waitForTimeout(250); await bob.keyboard.press('KeyV');      // la seconde, trop tôt, est refusée par le serveur
  await anna.waitForTimeout(900);
  const da = await anna.evaluate(() => window.__div), db = await bob.evaluate(() => window.__div);
  console.log('diversion, côté Anna', JSON.stringify(da), '· côté Bob', JSON.stringify(db));
  controle('diversion : une seule passe, Anna l’entend au loin (retard, côté), Bob de près, même son', da.length === 1 && db.length === 1 && da[0][0] === 'diversionFar' && db[0][0] === 'diversionSelf' && da[0][1] === db[0][1] && da[0][2] > 30, `son n° ${db[0]?.[1]}, à ${da[0]?.[2]} m, côté ${da[0]?.[3]}, joué : ${da[0]?.[4]} / ${db[0]?.[2]}`);

  // --- pause : la manche continue ; « Quitter la manche » ramène au salon ---
  const pause = await bob.evaluate(async () => {
    const g = window.hr.game; g.setState('pause'); const t0 = g.online.session.remaining();
    await new Promise((r) => setTimeout(r, 700));
    const r = { ecran: document.getElementById('pause').classList.contains('on'), bouton: document.querySelector('#pause [data-act="restart"]').textContent, avance: t0 - g.online.session.remaining() > 500, temps: g.wind.time };
    await new Promise((r2) => setTimeout(r2, 300)); r.monde = g.wind.time > r.temps;
    document.querySelector('#pause [data-act="restart"]').click(); await new Promise((r2) => setTimeout(r2, 500));
    return { ...r, apres: g.state, role: g.online.session.role, salon: document.getElementById('ol-salon').style.display !== 'none', pauseFermee: !document.getElementById('pause').classList.contains('on') };
  });
  controle('pause : la manche continue, « Quitter la manche » ramène au salon', pause.ecran && pause.bouton === 'Quitter la manche' && pause.avance && pause.monde && pause.apres === 'lobby' && pause.role === null && pause.salon && pause.pauseFermee, JSON.stringify(pause));
  await anna.waitForTimeout(800);
  const a4 = await etat(anna);
  controle('Bob parti : sa cible disparaît chez Anna', a4.cibles === a4.salle - 1 && !(await anna.evaluate(() => [...window.hr.game.online.session.players.values()].some((j) => j.pseudo === 'Bob'))), `${a4.cibles} cibles`);
  await bob.close();

  if (SALON) {
    // --- fin de manche : salon pour une minute, vote, puis la manche suivante avec le vent voté ---
    console.log('attente de la fin de la manche (quatre minutes au plus)…');
    await anna.waitForFunction(() => window.hr.game.state === 'lobby' && window.hr.game.online.session.phase === 'pause', null, { timeout: 250000 });
    await anna.waitForTimeout(600);
    const fin = await anna.evaluate(() => ({ salon: document.getElementById('ol-salon').style.display !== 'none', vote: document.querySelector('#ol-salon [data-s="vote"]').style.display, hud: document.getElementById('ol-vie').style.display }));
    controle('fin de manche : salon, vote offert, affichage du jeu retiré', fin.salon && fin.vote === 'flex' && fin.hud === 'none', JSON.stringify(fin));
    await anna.click('#ol-salon [data-s="vVent"] [data-v="oui"]');
    await cap(anna, 'salon-vote', taille);
    await enJeu(anna); await anna.waitForTimeout(500);
    const suite = await anna.evaluate(() => { const g = window.hr.game, v = g.online.session.settings.vent; return { vent: v, moteur: [g.wind.baseSpeed, g.wind.fromBearing, g.wind.gusts, g.wind.wander], points: g.online.session.self.points, texte: g.online.session.announce }; });
    controle('manche suivante : vent voté appliqué au moteur, régulier ; points remis à zéro', !!suite.vent && suite.moteur[0] === suite.vent.vitesse && suite.moteur[1] === suite.vent.de && suite.moteur[2] === 0 && suite.moteur[3] === 0 && suite.points === 0, JSON.stringify(suite));
  }
  await anna.close();
}

await duel([1280, 720]);
if (CAPTURES) await duel([1440, 900]);
await browser.close();
console.log(echecs.length ? `\n${echecs.length} contrôle(s) en échec : ${echecs.join(' ; ')}` : '\nTous les contrôles passent.');
process.exit(echecs.length ? 1 : 0);
