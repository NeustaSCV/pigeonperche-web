// Ville nouvelle : ce qui trahit un tireur. Chaque coup de feu laisse une balle traçante le long de sa vraie
// trajectoire, une flamme à la bouche du canon et une détonation (src/ville/sons.js) qui arrive avec le retard du
// son, placée à gauche ou à droite selon l'endroit d'où elle vient ; une balle qui passe tout près s'entend aussi. Valable pour ses propres tirs, ceux des autres
// joueurs et ceux des robots.
import * as THREE from 'three';
import { weaponById, SIGHT_HEIGHT } from '../config/weapons';
import { makeFlight, stepFlight, firingSolution, zeroAngle, GAME_AIR } from '../ballistics';

const ARME = '375ct';
const SON = 340;                  // m/s
const UP = new THREE.Vector3(0, 1, 0);

export function installEffets({ scene, camera, state, EMP, meta, bendY, groundY, tir, sons = null }) {
  const W = weaponById(ARME), zero = zeroAngle(W, W.zero, SIGHT_HEIGHT, GAME_AIR);
  const actifs = [];              // traçantes et flammes en cours

  /** Bouche du canon d'un emplacement, dans le repère affiché (carte bombée). */
  const bouche = (nom, out = new THREE.Vector3()) => { const p = meta.postes[nom]; return out.set(p[0], p[1] + bendY(p[0], p[2]) - SIGHT_HEIGHT, p[2]); };
  const vent = () => { const v = state.vent; if (!v) return [0, 0]; const a = (v.de * Math.PI) / 180; return [-Math.sin(a) * v.vitesse, Math.cos(a) * v.vitesse]; };

  /** Vol d'une balle depuis `o` dans la direction du canon `dir` : points (repère affiché) tous les centièmes de seconde. */
  const vol = (o, dir, tofMax = 8) => {
    const f = makeFlight(W, undefined, { air: GAME_AIR, frame: 'world', y0: o.y }), [vx, vz] = vent();
    const s = { x: o.x, y: o.y, z: o.z, vx: dir.x * f.v0, vy: dir.y * f.v0, vz: dir.z * f.v0, t: 0 }, pts = [[o.x, o.y, o.z, 0]];
    for (let i = 1; s.t < tofMax; i++) {
      stepFlight(s, 1 / 400, f, vx, 0, vz);
      const arret = s.y < groundY(s.x, s.z) + bendY(s.x, s.z) || (s.t > 0.05 && tir.dansBatiment(s.x, s.y, s.z));
      if (i % 4 === 0 || arret) pts.push([s.x, s.y, s.z, s.t]);
      if (arret) break;
    }
    return pts;
  };
  /** Direction du canon pour une ligne de visée et des réglages de tourelles (mrad). */
  const canon = (los, elev, deriv, out = new THREE.Vector3()) => {
    const right = new THREE.Vector3().crossVectors(los, UP).normalize(), up = new THREE.Vector3().crossVectors(right, los).normalize();
    return out.copy(los).addScaledVector(up, Math.tan(zero + elev * 0.001)).addScaledVector(right, deriv * 0.001).normalize();
  };

  // ---------- balle traçante : une traînée qui suit la trajectoire puis s'efface (pas de bille au bout) ----------
  const matTete = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 1, depthTest: true, blending: THREE.AdditiveBlending });
  const geoTete = new THREE.SphereGeometry(1, 8, 6);
  /** `local` : sa propre balle ; on ne la dessine qu'à partir de 25 m, pour ne pas s'éblouir dans la lunette. */
  const tracante = (pts, local = false) => {
    if (pts.length < 2) return;
    let debut = 0; if (local) while (debut < pts.length - 2 && Math.hypot(pts[debut][0] - pts[0][0], pts[debut][1] - pts[0][1], pts[debut][2] - pts[0][2]) < 25) debut++;
    const pos = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1] - bendY(p[0], p[2]); pos[i * 3 + 2] = p[2]; });      // la scène est à plat
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setDrawRange(0, 0);
    const trainee = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    trainee.frustumCulled = false; const tete = new THREE.Mesh(geoTete, matTete); tete.frustumCulled = false; tete.visible = false;
    scene.add(trainee, tete);
    actifs.push({ genre: 'balle', pts, debut, trainee, tete, t0: performance.now(), fin: pts[pts.length - 1][3] });
  };

  // ---------- flamme à la bouche : un éclat orangé très bref, grossi avec la distance pour se voir de loin ----------
  const matFlamme = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 1, depthTest: false, blending: THREE.AdditiveBlending });
  const flamme = (o) => {
    const m = new THREE.Mesh(geoTete, matFlamme.clone()); m.frustumCulled = false; m.renderOrder = 12; m.position.set(o.x, o.y - bendY(o.x, o.z), o.z);
    scene.add(m); actifs.push({ genre: 'flamme', m, t0: performance.now() });
  };

  // ---------- sons (src/ville/sons.js) : détonation à sa distance, balle qui passe tout près ----------
  const droite = new THREE.Vector3();
  /** Détonation d'un tir parti de `o` : la sienne, ou celle d'un autre, retardée par la distance et placée à gauche ou à droite. */
  const detonation = (o, local) => {
    if (!sons) return;
    if (local) { sons.tirLocal(); return; }
    const d = o.distanceTo(camera.position), versTir = new THREE.Vector3().subVectors(o, camera.position).normalize();
    droite.set(1, 0, 0).applyQuaternion(camera.quaternion);
    sons.tirDistant(d, Math.max(-1, Math.min(1, versTir.dot(droite) * 1.2)));
  };
  /** Si la balle d'un autre passe à moins de 20 m sans nous toucher, on entend son souffle au moment où elle passe. */
  const frole = (pts) => {
    let best = 1e9, k = -1; const c = camera.position;
    for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - c.x, pts[i][1] - c.y, pts[i][2] - c.z); if (d < best) { best = d; k = i; } }
    if (k < 1 || best > 20 || best < 1.2) return;                 // trop loin, ou en plein sur nous : c'est une touche, la voix suffit
    droite.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const a = pts[k - 1], b = pts[Math.min(pts.length - 1, k + 1)];
    sons.ballePasse((b[0] - a[0]) * droite.x + (b[2] - a[2]) * droite.z, pts[k][3]);
  };
  const coup = (o, dir, tofMax, local = false) => { if (!local) flamme(o); detonation(o, local); const pts = vol(o, dir, tofMax); if (!local && sons) frole(pts); tracante(pts, local); };   // pas de flamme pour son propre tir : elle emplirait la lunette

  /** Son propre tir : appelé à l'instant du coup, avec la visée et les réglages en cours. Renvoie la direction du canon. */
  const tirLocal = (res) => {
    const los = camera.getWorldDirection(new THREE.Vector3()), dir = canon(los, tir.etat.elev, tir.etat.deriv);
    const o = camera.position.clone(); o.y -= SIGHT_HEIGHT;
    coup(o, dir, res?.touche ? res.tof : 8, true);     // la traçante s'arrête sur le tireur touché
    return [dir.x, dir.y, dir.z];
  };
  /** Tir d'un autre joueur depuis l'emplacement `emp`, dans la direction `dir` de son canon. */
  const tirDistant = (emp, dir) => { if (!meta.postes[emp] || emp === state.post) return; coup(bouche(emp), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()); };
  /** Tir d'un robot depuis `emp` vers l'emplacement `vers` : visée réglée pour la distance, déviée s'il manque. */
  const tirRobot = (emp, vers, touche) => {
    if (!meta.postes[emp] || !meta.postes[vers] || emp === state.post) return;
    const o = bouche(emp), c = bouche(vers); c.y -= 0.55;                                       // il vise le buste
    const range = o.distanceTo(c), sol = firingSolution(W, { range, heightDiff: c.y - o.y, air: GAME_AIR, sightHeight: SIGHT_HEIGHT });
    const los = c.sub(o).normalize(), ecart = touche ? 0 : 1.5 + Math.random() * 3;              // mrad
    const a = Math.random() * 6.283, dir = canon(los, (sol ? sol.elevMil : 0) + Math.sin(a) * ecart, Math.cos(a) * ecart);
    coup(o, dir, touche && sol ? sol.tof : 8);
  };

  const update = (now) => {
    for (let i = actifs.length - 1; i >= 0; i--) {
      const a = actifs[i], age = Math.max(0, (now - a.t0) / 1000);      // l'horloge de l'image peut précéder de peu celle du tir
      if (a.genre === 'flamme') {
        if (age > 0.14) { scene.remove(a.m); a.m.material.dispose(); actifs.splice(i, 1); continue; }
        const d = a.m.position.distanceTo(camera.position);
        // taille réglée sur le champ : une quinzaine de pixels à l'écran, à l'œil nu comme en lunette
        a.m.scale.setScalar(Math.max(0.12, d * Math.tan((camera.fov * Math.PI) / 360) * 0.016) * (1 - age / 0.14 * 0.5)); a.m.material.opacity = 1 - age / 0.14;
        continue;
      }
      const P = a.pts, DUREE_TRAINEE = 1.6;
      if (age > a.fin + DUREE_TRAINEE) { scene.remove(a.trainee, a.tete); a.trainee.geometry.dispose(); a.trainee.material.dispose(); actifs.splice(i, 1); continue; }
      // tête : interpolée entre les deux points qui encadrent l'instant présent
      let k = Math.min(P.length - 1, Math.floor(age * 100)); while (k < P.length - 1 && P[k + 1][3] <= age) k++;
      a.trainee.geometry.setDrawRange(a.debut, Math.max(0, Math.min(P.length, k + 1) - a.debut));
      if (age < a.fin) {
        const p = P[k], q = P[Math.min(P.length - 1, k + 1)], u = q[3] > p[3] ? (age - p[3]) / (q[3] - p[3]) : 0;
        const x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u, z = p[2] + (q[2] - p[2]) * u;
        a.tete.position.set(x, y - bendY(x, z), z);
        // tête de la traçante : un point de quelques pixels, quel que soit le grossissement (elle était énorme en lunette)
        a.tete.scale.setScalar(Math.max(0.006, a.tete.position.distanceTo(camera.position) * Math.tan((camera.fov * Math.PI) / 360) * 0.0055));
        a.tete.visible = false;               // pas de bille au bout : la traînée suffit
      } else a.tete.visible = false;
      a.trainee.material.opacity = 0.85 * (age < a.fin ? 1 : Math.max(0, 1 - (age - a.fin) / DUREE_TRAINEE));
    }
  };

  // chaque tir du joueur passe par ici ; la liaison réseau (reseau.js) vient s'y accrocher pour l'annoncer au serveur
  const api = { update, tirLocal, tirDistant, tirRobot, surTirReseau: null, actifs };
  tir.etat.surTir = (res) => { const dir = tirLocal(res); if (api.surTirReseau) api.surTirReseau(res, dir); };
  return api;
}
