// Ville nouvelle, mode visite : tir sur les silhouettes fixes des autres emplacements, avec la balistique du jeu.
// Une seule arme pour tous. La balle vole dans le repère affiché (carte bombée) ; elle s'arrête au sol et sur les
// bâtiments (pas sur les arbres ni sur les perchoirs). Une touche déclenche une gerbe rouge volontairement exagérée, grossie avec la distance pour
// se voir de loin (demande de l'auteur pour cette carte) ; la silhouette se couche, puis se relève.
import * as THREE from 'three';
import { weaponById, SIGHT_HEIGHT, CLICK_MIL } from '../config/weapons';
import { makeFlight, stepFlight, firingSolution, zeroAngle, splitElevation, GAME_AIR } from '../ballistics';

const ARME = '375ct';
const DERIVE_MAX = 10;                       // course de la tourelle de dérive, de part et d'autre du zéro (mrad)
const DEMI_HAUT = 1.0, RAYON = 0.5;          // zone de touche : un cylindre de 2 m de haut et 1 m de large autour du tireur
const fr = (v, n = 1) => v.toFixed(n).replace('.', ',');

export function installTir({ scene, camera, view, state, EMP, meta, bendY, groundY, bats = [], inPoly }) {
  const W = weaponById(ARME);
  const zero = zeroAngle(W, W.zero, SIGHT_HEIGHT, GAME_AIR);
  const t = { elev: 0, deriv: 0, tirs: 0, touches: 0, pret: 0, msg: 'Épaulez, visez un tireur, réglez la lunette, tirez.', dernier: null };

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
  // en haut à gauche : la cible visée (poste, distance, correction)
  const viseur = document.createElement('div'); viseur.id = 'viseur'; document.body.appendChild(viseur);
  // lunette à l'œil, contre le bord gauche de la lunette : les deux tourelles (où elles sont, ce qu'elles déplacent, leur réglage)
  const tourelles = document.createElement('div'); tourelles.id = 'tourelles'; document.body.appendChild(tourelles);

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

  // commandes, comme dans le jeu solo : lunette à l'œil, ↑ ↓ tournent la tourelle d'élévation et ← → celle de dérive (un cran de 0,1 mrad,
  // 1 mrad avec Maj ; un appui maintenu les enchaîne). G règle les deux sur la cible visée. Tir : espace ou clic sans glisser.
  const borne = (v, a, b) => Math.max(a, Math.min(b, Math.round(v * 10) / 10));
  const CRANS = { ArrowUp: ['elev', 1], ArrowDown: ['elev', -1], ArrowRight: ['deriv', 1], ArrowLeft: ['deriv', -1] };
  /** Tourne une tourelle d'un cran (ou de 1 mrad) ; `code` est celui de la flèche, pour éclairer la touche à l'écran. */
  const cran = (code, gros) => {
    const [axe, sens] = CRANS[code], d = sens * (gros ? 1 : CLICK_MIL);
    if (axe === 'elev') t.elev = borne(t.elev + d, 0, W.turretMaxMil); else t.deriv = borne(t.deriv + d, -DERIVE_MAX, DERIVE_MAX);
    t.appui = { code, fin: performance.now() + 130 };
  };
  const reglerSurCible = () => { const e = vise(0.06), s = e && solution(e); if (s) { t.elev = borne(s.dialMil, 0, W.turretMaxMil); t.deriv = borne(s.deriv, -DERIVE_MAX, DERIVE_MAX); t.appui = { code: 'KeyG', fin: performance.now() + 130 }; } };
  window.addEventListener('keydown', (ev) => {
    if (CRANS[ev.code]) { if (state.scope && !state.salon) { ev.preventDefault(); cran(ev.code, ev.shiftKey); } }
    else if (ev.code === 'KeyG') reglerSurCible();
    else if (ev.code === 'Space' && !state.fly) { ev.preventDefault(); tirer(); }
  });
  // les touches dessinées dans l'encart se cliquent aussi (Maj + clic : 1 mrad)
  tourelles.addEventListener('mousedown', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-t]'); if (!b || ev.button !== 0) return;
    ev.preventDefault(); if (b.dataset.t === 'KeyG') reglerSurCible(); else cran(b.dataset.t, ev.shiftKey);
  });
  let bas = null;
  view.addEventListener('mousedown', (ev) => { if (ev.button === 0) bas = [ev.clientX, ev.clientY]; });
  view.addEventListener('mouseup', (ev) => { if (ev.button === 0 && bas && Math.hypot(ev.clientX - bas[0], ev.clientY - bas[1]) < 4) tirer(); bas = null; });

  // --- encart des tourelles ---
  // Ruban gradué d'une tourelle, vu comme le tambour déroulé : il défile sous un repère fixe, la valeur réglée. Un cran = PAS pixels ;
  // le ruban s'arrête aux butées de la tourelle. Il ne porte que le réglage : jamais de repère d'une valeur demandée.
  const PAS = 6;
  const ruban = (val, min, max, vert) => {
    const L = vert ? 132 : 300, E = vert ? 54 : 42, m = L / 2, n = Math.floor(m / PAS), v10 = Math.round(val * 10);
    let fin = '', fort = '', txt = '';
    for (let i = Math.max(Math.round(min * 10), v10 - n); i <= Math.min(Math.round(max * 10), v10 + n); i++) {
      const p = (i - v10) * PAS, l = i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 4, d = vert ? `M42 ${m - p}h${-l}` : `M${m + p} 10v${l}`;
      if (i % 10 === 0) fort += d; else fin += d;
      if (i % 10 === 0) { const n1 = Math.abs(i / 10); txt += vert ? `<text x="26" y="${m - p + 3.5}" text-anchor="end">${n1}</text>` : `<text x="${m + p}" y="33" text-anchor="middle">${i ? (i > 0 ? 'D ' : 'G ') + n1 : '0'}</text>`; }
    }
    const repere = vert ? `<path class="r-trait" d="M28 ${m}h26"/><path class="r-idx" d="M8 ${m}l-8 -4.5v9z"/>` : `<path class="r-trait" d="M${m} 0v24"/><path class="r-idx" d="M${m} 34l-4.5 8h9z"/>`;
    return `<svg class="ruban ${vert ? 'vert' : 'horiz'}" width="${vert ? E : L}" height="${vert ? L : E}" viewBox="0 0 ${vert ? E : L} ${vert ? L : E}" aria-hidden="true"><path class="r-fin" d="${fin}"/><path class="r-fort" d="${fort}"/>${txt}${repere}</svg>`;
  };
  // La lunette vue de l'arrière, comme le tireur la voit : la tourelle du dessus et celle du côté droit, à leur vraie place.
  // La tourelle dont parle le bloc est pleine ; dans l'oculaire, une double flèche donne l'axe sur lequel elle déplace l'impact.
  const picto = (axe) => `<svg class="tr-picto" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="27" cy="39" r="18.5"/><circle class="p-fin" cx="27" cy="39" r="14"/><rect${axe === 'elev' ? ' class="p-or"' : ''} x="19.5" y="6.5" width="15" height="14"/><rect${axe === 'deriv' ? ' class="p-or"' : ''} x="45.5" y="31.5" width="14" height="15"/><path class="p-fl" d="${axe === 'elev' ? 'M27 30v18M23 34l4 -4l4 4M23 44l4 4l4 -4' : 'M18 39h18M22 35l-4 4l4 4M32 35l4 4l-4 4'}"/></svg>`;
  const fleche = (v, pos, neg) => (Math.abs(v) < 0.05 ? '' : (v > 0 ? pos : neg) + ' ');
  /** Une tourelle, vue du tireur : où elle est sur la lunette, ce qu'elle déplace, ses deux touches, la valeur réglée et son ruban. Rien d'autre. */
  const blocTourelle = (axe, titre, lieu, effet, valeur, touches, bande, now) => {
    const touche = (c) => `<kbd data-t="${c[0]}"${t.appui && t.appui.code === c[0] && now < t.appui.fin ? ' class="appui"' : ''}>${c[1]}</kbd>`;
    return `<div class="tr-bloc tr-${axe}"><div class="tr-tete">${picto(axe)}<div><span>${titre}</span><em>${lieu}</em><em>${effet}</em></div></div>`
      + `<div class="tr-regl"><div class="regle"><b>${valeur}</b><span>mrad</span></div><i>${touches.map(touche).join('')}</i></div>${bande}</div>`;
  };
  let htmlAffiche = null;
  // Petit écran : l'encart rétrécit pour tenir dans la bande noire à gauche de la lunette, et descend s'il le faut pour
  // ne jamais recouvrir le bloc de l'observateur, en haut à gauche.
  const caleTourelles = () => {
    const W0 = 336, H0 = tourelles.offsetHeight || 420, vw = window.innerWidth, vh = window.innerHeight;
    const k = Math.max(0.68, Math.min(1, (vw / 2 - vh * 0.47 - 22) / W0));
    const bas = viseur.getBoundingClientRect().bottom, haut = Math.max((vh - H0 * k) / 2, Math.max(bas, 190) + 14);
    tourelles.style.transformOrigin = 'top right'; tourelles.style.transform = `scale(${k.toFixed(3)})`; tourelles.style.top = `${Math.round(haut)}px`;
    tourelles.style.right = `${Math.round(Math.min(vw / 2 + vh * 0.47 + 12, vw - W0 * k - 6))}px`;      // bord droit contre la lunette, sans sortir de l'écran
  };
  window.addEventListener('resize', () => { if (htmlAffiche) caleTourelles(); });
  // L'encart ne montre que la lunette et son réglage (la vue du tireur) : il explique les tourelles, il ne dit jamais quoi afficher.
  // La correction à apporter est ailleurs, en haut à gauche avec le poste visé et sa distance (la vue de l'observateur) :
  // on ne la rappelle pas ici, ni l'écart qui reste, ni le sens dans lequel tourner.
  const AIDE_CRAN = `Un cran = ${fr(CLICK_MIL)}&nbsp;mrad, soit ${fr(CLICK_MIL * 10, 0)}&nbsp;cm à 100&nbsp;m`;
  const htmlTourelles = (now) => {
    const appuiG = t.appui && t.appui.code === 'KeyG' && now < t.appui.fin ? ' class="appui"' : '';
    return blocTourelle('elev', 'Élévation', 'Tourelle du dessus', 'Monte ou descend l’impact', fr(t.elev), [['ArrowUp', '↑'], ['ArrowDown', '↓']], ruban(t.elev, 0, W.turretMaxMil, true), now)
      + blocTourelle('deriv', 'Dérive', 'Tourelle de droite', 'Décale l’impact à gauche ou à droite', fleche(t.deriv, '→', '←') + fr(Math.abs(t.deriv)), [['ArrowLeft', '←'], ['ArrowRight', '→']], ruban(t.deriv, -DERIVE_MAX, DERIVE_MAX, false), now)
      + `<div class="tr-aide"><p>${AIDE_CRAN}</p><p><kbd>Maj</kbd> + flèche : 1&nbsp;mrad d’un coup</p><p><kbd data-t="KeyG"${appuiG}>G</kbd> régler sur la cible visée</p></div>`;
  };

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
    const e = vise(), s = e && solution(e);
    const attente = now < t.pret ? 'Culasse…' : '';
    viseur.innerHTML = s ? `<div class="v-cible"><div class="v-lieu">${e.nom}</div><div class="v-ligne"><b>${Math.round(s.range)}</b><span>m</span></div><div class="v-ligne v-corr"><span>Correction</span>${texteCorrection(e)}</div></div>` : '';
    const h = state.scope ? htmlTourelles(now) : '';
    if (h !== htmlAffiche) { tourelles.innerHTML = htmlAffiche = h; tourelles.style.display = h ? '' : 'none'; if (h) caleTourelles(); }
    // en bas à droite : un simple rappel de l'arme à l'œil nu ; lunette à l'œil, le dernier résultat et la culasse
    box.className = state.scope ? 'epaule' : '';
    box.innerHTML = state.scope
      ? `<div class="t-msg">${t.msg}</div><div class="t-aide">${attente || '<kbd>Espace</kbd> tirer'}</div>`
      : `<div class="t-arme">${W.name}<span>${W.caliber}</span></div>`;
  };

  /** Effet d'une touche confirmée par le serveur sur l'emplacement `nom` : gerbe, silhouette couchée 5 s. */
  const effetTouche = (nom, dist) => {
    const e = EMP.find((q) => q.nom === nom); if (!e || nom === state.post) return;
    centre(e, c); const d = c.distanceTo(camera.position); gerbe(c.x, c.y, c.z, d); couches.set(nom, performance.now() + 5000);
  };
  const changerPoste = () => { t.elev = 0; t.deriv = 0; eteindreReflets(); for (const [nom] of couches) { EMP.find((q) => q.nom === nom).figure.rotation.x = 0; } couches.clear(); };
  return { update, tirer, vise, solution, texteCorrection, changerPoste, effetTouche, reflet, eteindreReflets, reflets, dansBatiment, centre, etat: t, arme: W };
}
