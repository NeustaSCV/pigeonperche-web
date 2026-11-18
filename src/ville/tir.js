// Ville nouvelle, mode visite : tir sur les silhouettes fixes des autres emplacements, avec la balistique du jeu.
// Une seule arme pour tous. La balle vole dans le repère affiché (carte bombée) ; elle s'arrête au sol et sur les
// bâtiments (pas sur les arbres ni sur les perchoirs). Une touche déclenche une gerbe rouge volontairement exagérée, grossie avec la distance pour
// se voir de loin (demande de l'auteur pour cette carte) ; la silhouette se couche, puis se relève.
import * as THREE from 'three';
import { weaponById, SIGHT_HEIGHT, CLICK_MIL } from '../config/weapons';
import { makeFlight, stepFlight, firingSolution, zeroAngle, splitElevation, GAME_AIR } from '../ballistics';

const ARME = '375ct';
const DEMI_HAUT = 1.0, RAYON = 0.5;          // zone de touche : un cylindre de 2 m de haut et 1 m de large autour du tireur
const fr = (v, n = 1) => v.toFixed(n).replace('.', ',');

export function installTir({ scene, camera, view, state, EMP, meta, bendY, groundY, bats = [], inPoly }) {
  const W = weaponById(ARME);
  const zero = zeroAngle(W, W.zero, SIGHT_HEIGHT, GAME_AIR);
  const t = { elev: 0, deriv: 0, tirs: 0, touches: 0, pret: 0, msg: 'Épaulez (E ou clic droit), visez une silhouette, réglez la tourelle, tirez.', dernier: null };

  // silhouettes : celles des perchoirs, plus une pour les emplacements qui n'en ont pas (grues)
  const gris = new THREE.MeshLambertMaterial({ color: 0x3f4a3a }), sombre = new THREE.MeshLambertMaterial({ color: 0x2e3338 }), peau = new THREE.MeshLambertMaterial({ color: 0xd9b08c });
  for (const e of EMP) {
    if (e.figure) continue;
    const p = meta.postes[e.nom], f = new THREE.Group(); f.position.set(p[0], p[1] - 1.6, p[2]);
    const b = (w, h, d, m, y) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.y = y; f.add(o); };
    b(0.5, 0.75, 0.28, gris, 1.1); b(0.44, 0.75, 0.26, sombre, 0.38);
    const tete = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), peau); tete.position.y = 1.62; f.add(tete);
    scene.add(f); e.figure = f;
  }
  const centre = (e, out) => { const p = meta.postes[e.nom]; return out.set(p[0], p[1] - 1.6 + DEMI_HAUT + bendY(p[0], p[2]), p[2]); };
  // bâtiments rangés dans une grille de 64 m : emprises (contour et cours intérieures) et volumes de toiture
  const CASE = 64, grille = new Map();
  const ranger = (x0, x1, z0, z1, o) => { for (let i = Math.floor(x0 / CASE); i <= Math.floor(x1 / CASE); i++) for (let j = Math.floor(z0 / CASE); j <= Math.floor(z1 / CASE); j++) { const k = i + ',' + j; let l = grille.get(k); if (!l) grille.set(k, (l = [])); l.push(o); } };
  for (const b of bats) {
    for (const rings of b.p || []) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of rings[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } ranger(x0, x1, z0, z1, { rings, bas: b.b - 2, haut: b.r }); }
    for (const k of b.k || []) { const r = Math.hypot(k[2], k[3]) / 2; ranger(k[0] - r, k[0] + r, k[1] - r, k[1] + r, { k, bas: b.b - 2, haut: k[5] }); }
  }
  /** Vrai si le point (repère affiché) est dans un bâtiment. */
  const dansBatiment = (x, y, z) => {
    const l = grille.get(Math.floor(x / CASE) + ',' + Math.floor(z / CASE)); if (!l) return false;
    const yp = y - bendY(x, z);
    for (const o of l) {
      if (yp > o.haut || yp < o.bas) continue;
      if (o.rings) { if (inPoly(x, z, o.rings[0]) && !o.rings.slice(1).some((h) => inPoly(x, z, h))) return true; }
      else { const k = o.k, dx = x - k[0], dz = z - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]); if (Math.abs(dx * ct + dz * st) <= k[2] / 2 && Math.abs(-dx * st + dz * ct) <= k[3] / 2) return true; }
    }
    return false;
  };
  const couches = new Map();                  // emplacement touché → instant du relèvement

  // pastille d'impact
  const impact = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, depthTest: false }));
  impact.visible = false; impact.frustumCulled = false; impact.renderOrder = 10; scene.add(impact);
  let impactFin = 0;

  // gerbe rouge d'une touche : un nuage qui gonfle et des éclats projetés, grossis avec la distance du tireur
  const eclat = new THREE.IcosahedronGeometry(1, 0), boule = new THREE.SphereGeometry(1, 12, 8), gerbes = [];
  const gerbe = (x, y, z, dist) => {
    const k = Math.max(0.14, dist * 0.0011), g = new THREE.Group(); g.position.set(x, y - bendY(x, z), z);
    const mat = new THREE.MeshBasicMaterial({ color: 0xc40d0d, transparent: true, opacity: 0.95, depthWrite: false });
    const voile = new THREE.MeshBasicMaterial({ color: 0xe01616, transparent: true, opacity: 0.6, depthWrite: false });
    const nuage = new THREE.Mesh(boule, voile); nuage.frustumCulled = false; g.add(nuage);
    const parts = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(eclat, mat); m.frustumCulled = false; m.scale.setScalar(k * (0.35 + Math.random() * 0.9)); g.add(m);
      const a = Math.random() * 6.283, h = Math.random() * 1.3 - 0.25, v = k * (5 + Math.random() * 11);
      parts.push({ m, vx: Math.cos(a) * v, vy: (0.6 + h) * v, vz: Math.sin(a) * v });
    }
    scene.add(g); gerbes.push({ g, mat, voile, nuage, parts, k, t0: performance.now() });
  };

  // reflets de lunette : un éclat clair à l'emplacement de chaque tireur qui nous tient dans sa lunette
  const reflets = new Map(), matReflet = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.95, depthTest: false, blending: THREE.AdditiveBlending });
  const geoReflet = new THREE.SphereGeometry(1, 10, 8);
  /** Allume ou éteint le reflet de l'emplacement `nom`. */
  const reflet = (nom, actif) => {
    let m = reflets.get(nom);
    if (!actif) { if (m) { scene.remove(m); reflets.delete(nom); } return; }
    const e = EMP.find((q) => q.nom === nom); if (!e || m) return;
    m = new THREE.Mesh(geoReflet, matReflet); m.frustumCulled = false; m.renderOrder = 11;
    const p = meta.postes[nom]; m.position.set(p[0], p[1], p[2]);          // à hauteur d'œil (la scène est à plat)
    scene.add(m); reflets.set(nom, m);
  };
  const eteindreReflets = () => { for (const nom of [...reflets.keys()]) reflet(nom, false); };

  // encart du tir
  const box = document.createElement('div'); box.id = 'tir'; document.body.appendChild(box);

  const los = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  /** Emplacement le plus proche de la ligne de visée (à moins de `seuil` radians), ou null. */
  const vise = (seuil = state.scope ? 0.03 : 0.12) => {
    camera.getWorldDirection(los); let best = null, ba = seuil;
    for (const e of EMP) {
      if (e.nom === state.post || (state.occupes && !state.occupes.has(e.nom))) continue;   // en manche : seuls les emplacements tenus par un joueur
      centre(e, c).sub(camera.position); const d = c.length(); if (d < 30) continue;
      const a = Math.acos(Math.min(1, c.dot(los) / d)); if (a < ba) { ba = a; best = e; }
    }
    return best;
  };

  /** Vent de la manche en vecteur monde (nord = −Z) : un vent qui vient de l'azimut `de` souffle vers l'opposé. */
  const ventMonde = () => { const v = state.vent; if (!v) return [0, 0]; const a = (v.de * Math.PI) / 180; return [-Math.sin(a) * v.vitesse, Math.cos(a) * v.vitesse]; };
  /** Correction à afficher au télémètre pour un emplacement : distance, dénivelé, élévation en mrad. */
  const cache = new Map();
  const solution = (e) => {
    const k = state.post + '>' + e.nom + '>' + (state.vent ? state.vent.vitesse + '@' + state.vent.de : ''); let s = cache.get(k);
    if (s === undefined) {
      centre(e, c); const range = c.distanceTo(camera.position), heightDiff = c.y - camera.position.y;
      const azimuthDeg = ((Math.atan2(c.x - camera.position.x, -(c.z - camera.position.z)) * 180) / Math.PI + 360) % 360;
      const sol = firingSolution(W, { range, heightDiff, air: GAME_AIR, sightHeight: SIGHT_HEIGHT, azimuthDeg, ...(state.vent ? { windSpeed: state.vent.vitesse, windFromDeg: state.vent.de } : {}) });
      s = sol ? { range, heightDiff, elev: sol.elevMil, deriv: Math.round(sol.windMil * 10) / 10, tof: sol.tof, ...splitElevation(sol.elevMil, W.turretMaxMil, CLICK_MIL) } : null;
      cache.set(k, s);
    }
    return s;
  };
  const texteCorrection = (e) => {
    const s = solution(e); if (!s) return 'hors de portée';
    const d = Math.abs(s.deriv) >= 0.1 ? ` · ${s.deriv > 0 ? '→' : '←'} ${fr(Math.abs(s.deriv))}` : '';
    return (s.holdMil > 0.05 ? `tourelle ${fr(s.dialMil)} + contre-visée ${fr(s.holdMil)}` : `↑ ${fr(s.elev)}`) + d + ' mrad';
  };

  const tirer = (now = performance.now()) => {
    if (!state.scope || state.fly || state.quad || state.couche || state.pause || state.spectateur || state.salon || now < t.pret) return null;
    t.pret = now + W.boltTime * 1000; t.tirs++;
    const eye = camera.position; camera.getWorldDirection(los);
    right.crossVectors(los, UP).normalize(); up.crossVectors(right, los).normalize();
    dir.copy(los).addScaledVector(up, Math.tan(zero + t.elev * 0.001)).addScaledVector(right, t.deriv * 0.001).normalize();   // dérive à droite : impact à droite
    const [vx, vz] = ventMonde();
    const f = makeFlight(W, undefined, { air: GAME_AIR, frame: 'world', y0: eye.y - SIGHT_HEIGHT });
    const s = { x: eye.x, y: eye.y - SIGHT_HEIGHT, z: eye.z, vx: dir.x * f.v0, vy: dir.y * f.v0, vz: dir.z * f.v0, t: 0 };
    const cibles = EMP.filter((e) => e.nom !== state.post && !couches.has(e.nom) && (!state.occupes || state.occupes.has(e.nom))).map((e) => ({ e, c: centre(e, new THREE.Vector3()) }));
    const visee = vise(0.06); let ecart = null, res = null;
    while (s.t < 10 && !res) {
      const px = s.x, py = s.y, pz = s.z;
      stepFlight(s, 1 / 400, f, vx, 0, vz);
      const dx = s.x - px, dy = s.y - py, dz = s.z - pz, l2 = dx * dx + dy * dy + dz * dz;
      for (const k of cibles) {
        if (Math.abs(k.c.x - s.x) > 40 || Math.abs(k.c.z - s.z) > 40) continue;
        const u = Math.max(0, Math.min(1, ((k.c.x - px) * dx + (k.c.y - py) * dy + (k.c.z - pz) * dz) / l2));
        q.set(px + dx * u - k.c.x, py + dy * u - k.c.y, pz + dz * u - k.c.z);
        const rad = Math.hypot(q.x, q.z);
        if (rad < RAYON && Math.abs(q.y) < DEMI_HAUT) { res = { touche: k.e, x: k.c.x + q.x, y: k.c.y + q.y, z: k.c.z + q.z, tof: s.t, dist: k.c.distanceTo(eye) }; break; }
        if (k.e === visee && u > 0 && u < 1) ecart = { haut: q.y, droite: q.x * right.x + q.z * right.z, dist: k.c.distanceTo(eye), tof: s.t, nom: k.e.nom };
      }
      if (!res && dansBatiment(s.x, s.y, s.z)) {
        // on recule au point d'entrée dans le mur (à 10 cm près)
        let a = 0, b = 1; for (let i = 0; i < 5; i++) { const m = (a + b) / 2; if (dansBatiment(px + dx * m, py + dy * m, pz + dz * m)) b = m; else a = m; }
        res = { mur: true, x: px + dx * a, y: py + dy * a, z: pz + dz * a, tof: s.t, dist: Math.hypot(px - eye.x, pz - eye.z) };
      }
      if (!res && s.y < groundY(s.x, s.z) + bendY(s.x, s.z)) res = { sol: true, x: s.x, y: s.y, z: s.z, tof: s.t, dist: Math.hypot(s.x - eye.x, s.z - eye.z) };
    }
    if (!res) res = { perdu: true, tof: s.t };
    res.ecart = ecart; res.elev = t.elev; t.dernier = res;
    if (t.surTir) t.surTir(res);                 // en manche : le serveur arbitre et annonce la touche à tous
    // le résultat n'apparaît qu'à l'arrivée de la balle
    setTimeout(() => {
      if (res.touche && state.enLigne) {
        t.touches++; t.msg = 'Touche annoncée au serveur…';
      } else if (res.touche) {
        t.touches++; couches.set(res.touche.nom, performance.now() + 5000); gerbe(res.x, res.y, res.z, res.dist);
        t.msg = `Touché · ${res.touche.nom} · ${Math.round(res.dist)} m · vol ${fr(res.tof)} s`;
      } else if (ecart) {
        const v = Math.abs(ecart.haut) < 0.05 ? '' : `${fr(Math.abs(ecart.haut))} m trop ${ecart.haut > 0 ? 'haut' : 'bas'}`;
        const h = Math.abs(ecart.droite) < 0.05 ? '' : `${fr(Math.abs(ecart.droite))} m à ${ecart.droite > 0 ? 'droite' : 'gauche'}`;
        t.msg = `Manqué · ${ecart.nom} · ${[v, h].filter(Boolean).join(', ') || 'de très peu'}`;
      } else if (res.mur && visee) {
        t.msg = `Manqué · ${visee.nom} · la balle s'est arrêtée sur un bâtiment à ${Math.round(res.dist)} m`;
      } else t.msg = res.mur ? `Manqué · impact sur un bâtiment à ${Math.round(res.dist)} m` : res.sol ? `Manqué · impact au sol à ${Math.round(res.dist)} m` : 'Manqué · balle perdue';
      // pastille d'impact : la scène est à plat, la courbure est appliquée à l'affichage
      if (!res.perdu && !res.touche) { impact.position.set(res.x, res.y - bendY(res.x, res.z), res.z); impact.scale.setScalar(Math.max(0.12, (res.dist || 500) * 0.0004)); impact.visible = true; impactFin = performance.now() + 2500; }
    }, Math.min(res.tof, 10) * 1000);
    return res;
  };

  // commandes : tourelle (R/F, Maj = 1 mrad), réglage automatique sur la cible visée (G), tir (espace ou clic sans glisser)
  const regler = (d) => { t.elev = Math.max(0, Math.min(W.turretMaxMil, Math.round((t.elev + d) * 10) / 10)); };
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyR') regler(ev.shiftKey ? 1 : CLICK_MIL);
    else if (ev.code === 'KeyF') regler(ev.shiftKey ? -1 : -CLICK_MIL);
    else if (ev.code === 'KeyD' && !state.fly) t.deriv = Math.max(-10, Math.min(10, Math.round((t.deriv + (ev.shiftKey ? 1 : CLICK_MIL)) * 10) / 10));
    else if (ev.code === 'KeyS' && !state.fly) t.deriv = Math.max(-10, Math.min(10, Math.round((t.deriv - (ev.shiftKey ? 1 : CLICK_MIL)) * 10) / 10));
    else if (ev.code === 'KeyG') { const e = vise(0.06), s = e && solution(e); if (s) { t.elev = Math.round(s.dialMil * 10) / 10; t.deriv = s.deriv; } }
    else if (ev.code === 'Space' && !state.fly) { ev.preventDefault(); tirer(); }
  });
  let bas = null;
  view.addEventListener('mousedown', (ev) => { if (ev.button === 0) bas = [ev.clientX, ev.clientY]; });
  view.addEventListener('mouseup', (ev) => { if (ev.button === 0 && bas && Math.hypot(ev.clientX - bas[0], ev.clientY - bas[1]) < 4) tirer(); bas = null; });

  const update = (now) => {
    for (const [nom, fin] of couches) {
      const e = EMP.find((q) => q.nom === nom), f = e.figure;
      if (now >= fin) { f.rotation.x = 0; couches.delete(nom); } else f.rotation.x = Math.min(Math.PI / 2, f.rotation.x + 0.12);   // se couche, sans plus
    }
    if (impact.visible && now > impactFin) impact.visible = false;
    // l'éclat scintille et garde une taille apparente à peu près constante, pour rester « léger » à toute distance
    for (const m of reflets.values()) { const d = m.position.distanceTo(camera.position); m.scale.setScalar(d * (state.scope ? 0.0009 : 0.0022) * (0.75 + 0.35 * Math.sin(now * 0.019) + 0.2 * Math.sin(now * 0.047))); }
    for (let i = gerbes.length - 1; i >= 0; i--) {
      const b = gerbes[i], age = (now - b.t0) / 1000, DUREE = 2.2;
      if (age > DUREE) { scene.remove(b.g); b.mat.dispose(); b.voile.dispose(); gerbes.splice(i, 1); continue; }
      const f = age * (1 - 0.18 * age);
      for (const q of b.parts) q.m.position.set(q.vx * f, q.vy * f - 5 * b.k * age * age, q.vz * f);
      b.nuage.scale.setScalar(b.k * (2.5 + 9 * Math.sqrt(age)));
      b.voile.opacity = 0.6 * Math.max(0, 1 - age / 1.2); b.mat.opacity = 0.95 * Math.max(0, 1 - Math.max(0, age - 1.2) / (DUREE - 1.2));
    }
    const e = state.scope ? vise() : null, s = e && solution(e);
    const attente = now < t.pret ? ' · culasse…' : '';
    box.innerHTML = `<b>${W.name}</b> · ${W.caliber}<br>Élévation <b>${fr(t.elev)}</b> mrad · dérive <b>${t.deriv ? (t.deriv > 0 ? 'D ' : 'G ') + fr(Math.abs(t.deriv)) : '0'}</b>${attente}` +
      (s ? `<br>Télémètre : ${e.nom} · ${Math.round(s.range)} m · ${texteCorrection(e)}` : '') +
      `<br>${t.touches} touche${t.touches > 1 ? 's' : ''} sur ${t.tirs} tir${t.tirs > 1 ? 's' : ''}<br><i>${t.msg}</i>` +
      `<br><small>R / F : élévation · S / D : dérive (Maj : 1 mrad) · G : régler sur la cible visée · espace ou clic : tirer</small>`;
  };

  /** Effet d'une touche confirmée par le serveur sur l'emplacement `nom` : gerbe, silhouette couchée 5 s. */
  const effetTouche = (nom, dist) => {
    const e = EMP.find((q) => q.nom === nom); if (!e || nom === state.post) return;
    centre(e, c); const d = c.distanceTo(camera.position); gerbe(c.x, c.y, c.z, d); couches.set(nom, performance.now() + 5000);
  };
  const changerPoste = () => { t.elev = 0; t.deriv = 0; eteindreReflets(); for (const [nom] of couches) { EMP.find((q) => q.nom === nom).figure.rotation.x = 0; } couches.clear(); };
  return { update, tirer, vise, solution, texteCorrection, changerPoste, effetTouche, reflet, eteindreReflets, reflets, dansBatiment, centre, etat: t, arme: W };
}
