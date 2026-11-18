// Emplacements du mode multijoueur : perchoirs (échafaudage, nacelle, mât, arbre, clocher, château d'eau), enseignes et repères
// propres à chaque lieu. Les couleurs et les formes viennent d'un relevé à l'œil sur des photos publiées (aucune image copiée).
import * as THREE from 'three';

// couleur des façades autour de certains emplacements : [nom, rayon, style, couleur, hauteur minimale] (styles de proto.js)
export const FACADES = [
  ['Restaurant La Fontaine', 34, 2, 0x8f4a38, 5],        // immeuble en brique rouge-brun, store blanc au rez-de-chaussée
  ['Lycée hôtelier', 70, 6, 0xeceeee, 8],                // volumes blancs, bardage métallique gris clair, bandeaux vitrés
  ['Mairie de Mongnigny', 48, 2, 0xa5503a, 4],            // brique rouge, grands vitrages sombres, auvent en béton
  ['La Tour Decauville', 45, 7, 0xe6dcc4, 3],            // ancienne ferme : murs enduits clairs, tour ronde
  ['Église Saint-Martin', 26, 8, 0xb7a684, 4],           // meulière, clocher carré à toit en bâtière
  ['Église Saint-Pierre-du-Lac', 30, 8, 0xd9cdb4, 4],    // église basse moderne, pignon vitré sous charpente de bois
  ['La Batterie', 48, 8, 0xb3a487, 3],                   // ancienne batterie militaire en meulière, arcades
  ['Lycée Émilie de Breteuil', 42, 1, null, 5],          // brique rose et béton clair
  ["Lycée Saint-François d'Assise", 60, 6, 0x565a61, 6], // bardage anthracite et murs blancs
  ['Ferme du Manet', 65, 7, 0xece4d2, 3],                // corps de ferme enduit clair
  ['Caserne des pompiers', 48, 4, 0xd9cdb8, 4],
  ['Gymnase Maurice Baquet', 50, 6, 0x2e3136, 5],         // grande boîte anthracite, à côté de la piste bleue
  ['Gymnase des Pyramides', 55, 6, 0xb8c0c6, 4],          // bardage métallique clair, verrières en pyramide
  ["Gymnase des Droits de l'Homme", 50, 6, 0xc4c9cd, 4],  // peau métallique perforée gris argent
  ['Gymnase Roger Rivière', 45, 6, 0xcfd3d6, 5],
  ['Bâtiment Vauban', 70, 2, 0xa9553f, 8],                // brique rouge, menuiseries blanches
  ['Sky Ouest', 62, 11, 0x7fb0aa, 8],                     // grands pans de verre turquoise sur pierre claire
  ['Aldi', 36, 6, 0x4a4d52, 3],                           // boîte gris anthracite, totem bleu au bord de la rue
  ['Grand Frais', 46, 6, 0x3c3f42, 3],                    // halle basse sombre, auvent vert, grand parc de stationnement
  ["McDonald's", 26, 5, 0x8a4b32, 2],                     // bandeaux terre cuite, bandeau vert sombre à lettres blanches
  ['École Alexandre Dumas', 40, 1, 0xb5654d, 3],          // école basse : soubassement de brique, grand toit gris
  ['CASC Alfred de Vigny', 45, 5, 0xe2dccb, 3],
];

// enseignes : texte, fond, lettres, largeur en mètres ; 'totem' = sur un mât, 'plaque' = plaque de rue
const ENS = {
  'La base nautique': ['BASE NAUTIQUE', '#f4f4f0', '#1b4f8a', 9],
  'Les Canardières': ['LES CANARDIÈRES', '#f4f1e6', '#3a3a3a', 9],
  'Le Vélodrome': ['VÉLODROME', '#b46a35', '#ffffff', 10],
  'Gymnase Roger Rivière': ['GYMNASE ROGER RIVIÈRE', '#f4f4f0', '#1b3f7a', 12],
  'La Gare': ['GARE', '#20242c', '#ffffff', 6],
  'Stade Maurice Leluc': ['STADE MAURICE LELUC', '#f4f4f0', '#1b3f7a', 11],
  'La Médiathèque': ['MÉDIATHÈQUE', '#dcd6c8', '#2a2a2a', 7],
  'Sky Ouest': ['SKY OUEST', '#15171c', '#ffffff', 9],
  "L'Espace St Q": ["L'ESPACE St Q", '#9a4636', '#f6ead2', 10],
  'Immeuble Édison': ['ÉDISON', '#e8e6e0', '#2a2a2a', 6],
  'Lycée Émilie de Breteuil': ['LYCÉE ÉMILIE DE BRETEUIL', '#f4f4f0', '#8a2f2f', 13],
  'Lycée hôtelier': ["LYCÉE D'HÔTELLERIE ET DE TOURISME", '#f4f4f0', '#30343a', 10],
  'La Batterie': ['LA BATTERIE', '#1c1c1c', '#f0c23a', 8],
  "Gymnase des Droits de l'Homme": ["GYMNASE DES DROITS DE L'HOMME", '#f4f4f0', '#1b3f7a', 15],
  'Avenue Eugène Freyssinet': ['AV. EUGÈNE FREYSSINET', '#1f4f9c', '#ffffff', 7, 'plaque'],
  'Bâtiment Vauban': ['UNIVERSITÉ · VAUBAN', '#f4f4f0', '#30343a', 10],
  'Immeuble des Prés': ['LES PRÉS', '#cdb5a6', '#3a2a22', 6],
  "Lycée Saint-François d'Assise": ["SAINT-FRANÇOIS D'ASSISE", '#f4f4f0', '#1d3c6e', 12],
  'Tennis des Quatre Pavés': ['TENNIS DES QUATRE PAVÉS', '#f4f4f0', '#2b6a3a', 12],
  'Caserne des pompiers': ['SAPEURS-POMPIERS', '#b3221f', '#ffffff', 11],
  'Étang des Roussières': ['ÉTANG DES ROUSSIÈRES', '#1f3f8f', '#ffffff', 5, 'plaque'],
  'Mairie de Mongnigny': ['HÔTEL DE VILLE', '#f4f4f0', '#30343a', 9],
  'Le Carrepoint': ['Le Carrepoint', '#f4f4f0', '#1b4f9a', 8, 'plaque'],
  'La Tour Decauville': ['ESPACE DECAUVILLE', '#f4f1e6', '#3a3a3a', 9],
  'École Alexandre Dumas': ['ÉCOLE ALEXANDRE DUMAS', '#f4f4f0', '#8a2f2f', 12],
  "McDonald's": ["McDonald's", '#c8201e', '#ffc72c', 5, 'totem'],
  'Gymnase Maurice Baquet': ['GYMNASE MAURICE BAQUET', '#f4f4f0', '#1b3f7a', 13],
  'Ferme du Manet': ['LA FERME DU MANET', '#25282c', '#f2ead8', 10],
  'Gymnase des Pyramides': ['GYMNASE DES PYRAMIDES', '#f4f4f0', '#1b3f7a', 12],
  'Aldi': ['ALDI', '#00205c', '#ffffff', 6],
  'Grand Frais': ['Grand Frais', '#2f7d32', '#ffffff', 9],
  'Place Jules Carpentier': ['PLACE JULES CARPENTIER', '#1f3f8f', '#ffffff', 5, 'plaque'],
  'CASC Alfred de Vigny': ['CASC ALFRED DE VIGNY', '#f4f4f0', '#30343a', 11],
  'Bassin des Graviers': ['BASSIN DES GRAVIERS', '#1f3f8f', '#ffffff', 5, 'plaque'],
  'Mairie de Voisins': ['MAIRIE', '#f4f4f0', '#30343a', 6],
  'Lidl': ['Lidl', '#0050aa', '#fff000', 6],
  'Place Henri Matisse': ['PLACE HENRI MATISSE', '#1f3f8f', '#ffffff', 5, 'plaque'],
  'La Paix Céleste': ['PLACE DE LA PAIX CÉLESTE', '#1f3f8f', '#ffffff', 5, 'plaque'],
  'La Grande Girouette': ['ESPLANADE BOULINGRIN', '#1f3f8f', '#ffffff', 5, 'plaque'],
};

export function buildPostes({ scene, EMP, groundY, bats, hash, centre, voirie = [] }) {
  // cap vers la rue la plus proche (à 12 m au moins, 120 m au plus) : les enseignes et les devantures regardent la rue
  const versRue = (x, z) => { let best = null, bd = 120; for (const r of voirie) for (const p of r.p) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd && d > 12) { bd = d; best = p; } } return best ? Math.atan2(best[0] - x, best[1] - z) : Math.atan2(centre[0] - x, centre[1] - z); };
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const M = { acier: L(0x8f969c), sombre: L(0x2c3035), bois: L(0x9a7a52), blanc: L(0xecebe6), beton: L(0xd6d2c8), tronc: L(0x4a3c30), rouge: L(0xb3221f), jaune: L(0xe0b020), verre: L(0x1d2a33), pneu: L(0x17181a) };
  const box = (g, w, h, d, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
  const cyl = (g, r0, r1, h, mat, x, y, z, seg = 12, open = false) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg, 1, open), mat); m.position.set(x, y + h / 2, z); g.add(m); return m; };
  const rod = (g, a, b, r = 0.06, mat = M.acier) => { const d = new THREE.Vector3().subVectors(b, a); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.normalize()); g.add(m); return m; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // treillis d'échafaudage (tubes galvanisés en croix)
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; { const x = cv.getContext('2d'); x.strokeStyle = '#a9afb4'; x.lineWidth = 6; x.strokeRect(3, 3, 58, 58); x.lineWidth = 4; x.beginPath(); x.moveTo(4, 4); x.lineTo(60, 60); x.moveTo(60, 4); x.lineTo(4, 60); x.stroke(); }
  const treillis = (ru, rv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 8; return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }); };
  // panneau à texte (les noms d'enseignes sont écrits en lettres simples, sans logo)
  const panneau = (texte, fond, lettres, w, h, italique = false) => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(64, Math.round((1024 * h) / w));
    const x = c.getContext('2d'); x.fillStyle = fond; x.fillRect(0, 0, c.width, c.height);
    let px = c.height * 0.62; x.font = `${italique ? 'italic ' : ''}bold ${px}px Helvetica, Arial, sans-serif`;
    const tw = x.measureText(texte).width; if (tw > c.width * 0.9) { px *= (c.width * 0.9) / tw; x.font = `${italique ? 'italic ' : ''}bold ${px}px Helvetica, Arial, sans-serif`; }
    x.fillStyle = lettres; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(texte, c.width / 2, c.height / 2 + px * 0.04);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshLambertMaterial({ map: t });
  };
  // enseigne lisible des deux côtés, sur deux poteaux
  const enseigne = (g, mat, w, h, x, yBas, z, ry, pieds = true) => {
    const grp = new THREE.Group(); grp.position.set(x, yBas, z); grp.rotation.y = ry; g.add(grp);
    for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(0, h / 2, s * 0.09); if (s < 0) m.rotation.y = Math.PI; grp.add(m); }
    box(grp, w + 0.16, h + 0.16, 0.14, M.sombre, 0, h / 2, 0);
    if (pieds) for (const s of [1, -1]) box(grp, 0.14, 1.6, 0.14, M.acier, s * w * 0.38, -0.8, 0);
    return grp;
  };
  const garde = (g, w, d, y) => {            // garde-corps d'une plateforme rectangulaire : lisse à 1,05 m, sous-lisse, montants
    for (const [a, b] of [[V(-w / 2, 0, -d / 2), V(w / 2, 0, -d / 2)], [V(w / 2, 0, -d / 2), V(w / 2, 0, d / 2)], [V(w / 2, 0, d / 2), V(-w / 2, 0, d / 2)], [V(-w / 2, 0, d / 2), V(-w / 2, 0, -d / 2)]]) {
      for (const h of [1.05, 0.55]) rod(g, a.clone().setY(y + h), b.clone().setY(y + h), 0.03);
      rod(g, a.clone().setY(y), a.clone().setY(y + 1.05), 0.035);
    }
  };
  const anneau = (g, r, y, mat = M.acier) => { for (const h of [1.05, 0.55]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 5, 28), mat); t.rotation.x = Math.PI / 2; t.position.y = y + h; g.add(t); } for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; rod(g, V(Math.cos(a) * r, y, Math.sin(a) * r), V(Math.cos(a) * r, y + 1.05, Math.sin(a) * r), 0.03, mat); } };
  const feuillage = [L(0x4c6b34), L(0x5f7d3a), L(0x3f5f33), L(0x56733a)];
  const houppier = new THREE.IcosahedronGeometry(1, 1);
  const drapeaux = (g, x, y, z, ry) => {      // trois mâts et leurs drapeaux tricolores devant une mairie
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = ry; g.add(grp);
    for (let i = -1; i <= 1; i++) { cyl(grp, 0.06, 0.04, 9, M.blanc, i * 2.2, 0, 0, 6); [0x1f3f8f, 0xf2f2f2, 0xc8201e].forEach((c, k) => box(grp, 0.6, 1.3, 0.03, L(c, { side: THREE.DoubleSide }), i * 2.2 + 0.36 + k * 0.6, 8.2, 0)); }
  };

  const MT = { tapis: L(0x3a4a3a), lant: L(0xdfe8ee), gal: L(0xa9afb4), solaire: L(0x1c2c4a), dalle: L(0xc9c6bd), dalle2: L(0xb4b1a8) };
  // altitude du toit du modèle à cet endroit (−∞ s'il n'y a pas de volume)
  const dans = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  const toit1 = (x, z) => { let best = -1e9; for (const b of bats) { if (Math.abs(b.x - x) > 200 || Math.abs(b.z - z) > 200) continue;
    for (const rings of b.p || []) if (dans(x, z, rings[0]) && !rings.slice(1).some((h) => dans(x, z, h))) best = Math.max(best, b.r);
    for (const k of b.k) { const dx = x - k[0], dz = z - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]); if (Math.abs(dx * ct + dz * st) <= k[2] / 2 && Math.abs(-dx * st + dz * ct) <= k[3] / 2) best = Math.max(best, k[5]); } } return best; };
  const toitA = (x, z) => { const t = toit1(x, z); for (const [a, b] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) if (Math.abs(toit1(x + a, z + b) - t) > 0.3) return -1e9; return t; };   // −∞ hors toit ou à moins de 90 cm d'un bord
  const racine = new THREE.Group(); scene.add(racine);
  const figures = [];
  for (const e of EMP) {
    const g = new THREE.Group(); g.position.set(e.x, 0, e.z); racine.add(g);
    const sol = groundY(e.x, e.z), toit = e.sol + e.toit, pl = e.y - 1.6;          // sol, dessus du toit, plancher où se tient le tireur
    const dc = Math.atan2(centre[0] - e.x, centre[1] - e.z);                        // cap vers le centre de la carte
    const ux = Math.sin(dc), uz = Math.cos(dc);
    if (e.type === 'echaf') {
      const H = Math.max(0.5, pl - toit);
      box(g, 2.5, H - 0.3, 2.5, treillis(1, Math.max(1, Math.round(H / 2))), 0, toit + (H - 0.3) / 2, 0);        // s'arrête sous le plancher
      for (let y = toit + 2; y < pl - 0.5; y += 2) box(g, 2.5, 0.06, 2.5, M.bois, 0, y, 0);                // planchers intermédiaires
      for (let y = toit; y < pl; y += 2) rod(g, V(1.32, y, -0.9), V(1.32, Math.min(pl, y + 2), 0.9), 0.03);   // échelles en biais
      box(g, 3.4, 0.14, 3.4, M.bois, 0, pl - 0.07, 0); garde(g, 3.4, 3.4, pl);
      box(g, 3.4, 0.9, 0.04, L(0x2f6e4a, { side: THREE.DoubleSide }), 0, pl + 0.45, -1.7);                  // filet de chantier sur un côté
    } else if (e.type === 'nacelle') {
      const t = new THREE.Group(); t.rotation.y = dc + Math.PI / 2; g.add(t);                              // camion le long de la rue
      box(t, 7.0, 1.0, 2.4, M.blanc, -3.2, sol + 1.25, 0); box(t, 2.0, 1.9, 2.3, M.blanc, -7.4, sol + 1.6, 0); box(t, 0.1, 0.8, 2.0, M.verre, -8.42, sol + 2.0, 0);
      box(t, 6.6, 0.7, 2.44, M.pneu, -3.9, sol + 0.4, 0); box(t, 6.0, 0.25, 2.5, M.jaune, -3.2, sol + 1.86, 0);
      for (const s of [1, -1]) for (const px of [-0.6, -5.6]) { box(t, 0.2, 0.2, 1.6, M.acier, px, sol + 0.7, s * 1.9); box(t, 0.5, 0.7, 0.5, M.acier, px, sol + 0.35, s * 2.6); }
      cyl(t, 0.7, 0.7, 0.8, M.acier, -1.2, sol + 1.9, 0);
      const coude = V(-6.5, sol + (pl - sol) * 0.62, 0);
      rod(t, V(-1.2, sol + 2.6, 0), coude, 0.22, M.blanc); rod(t, coude, V(-0.4, pl - 0.3, 0), 0.17, M.blanc);
      box(g, 1.9, 0.1, 1.2, M.acier, 0, pl - 0.05, 0); garde(g, 1.9, 1.2, pl);
      for (const s of [1, -1]) box(g, 1.9, 0.5, 0.03, M.blanc, 0, pl + 0.3, s * 0.6);
    } else if (e.type === 'mat') {
      // plateforme en tête de mât : le fût s'arrête sous le plancher, les projecteurs sont accrochés en dessous
      cyl(g, 0.55, 0.3, pl - 0.12 - sol, M.acier, 0, sol, 0, 10);
      cyl(g, 1.7, 1.7, 0.12, M.acier, 0, pl - 0.12, 0, 16); anneau(g, 1.65, pl);
      for (let y = sol + 1; y < pl - 0.5; y += 0.4) box(g, 0.5, 0.04, 0.04, M.sombre, 0.55, y, 0);            // échelons
      for (const sd of [1, -1]) { box(g, 4.6, 2.4, 0.2, M.sombre, Math.sin(dc) * sd * 1.2, pl - 2.4, Math.cos(dc) * sd * 1.2, dc);
        for (let i = 0; i < 8; i++) box(g, 0.9, 0.9, 0.12, L(0xe8ecf0), Math.sin(dc) * sd * 1.36 + Math.cos(dc) * ((i % 4) - 1.5) * 1.1, pl - 2.95 + Math.floor(i / 4) * 1.1, Math.cos(dc) * sd * 1.36 - Math.sin(dc) * ((i % 4) - 1.5) * 1.1, dc); }
    } else if (e.type === 'arbre') {
      cyl(g, 1.15, 0.5, pl + 6 - sol, M.tronc, 0, sol - 0.3, 0, 9);
      cyl(g, 2.3, 2.3, 0.16, M.bois, 0, pl - 0.16, 0, 6); anneau(g, 2.2, pl, M.bois);
      for (let y = sol + 1; y < pl; y += 0.45) box(g, 0.6, 0.06, 0.1, M.bois, 0, y, 1.0 - (y - sol) * 0.012);
      const blob = (r, x, y, z, k) => { const m = new THREE.Mesh(houppier, feuillage[k % 4]); m.scale.set(r, r * 0.8, r); m.position.set(x, y, z); m.rotation.y = k; g.add(m); };
      for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283 + 0.4; blob(5.2 + (i % 3), Math.cos(a) * 4.5, pl - 5.5 - (i % 2) * 2, Math.sin(a) * 4.5, i); }   // sous la cabane
      for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; blob(5.5 + (i % 2) * 1.5, Math.cos(a) * 3.5, pl + 9.5 + (i % 3), Math.sin(a) * 3.5, i + 2); }   // au-dessus de la tête, sans boucher l'horizon
      for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 + 0.9; blob(3.2, Math.cos(a) * 9.5, pl + 6.2 + (i % 2) * 1.5, Math.sin(a) * 9.5, i + 1); rod(g, V(0, pl + 3.6 + i * 0.3, 0), V(Math.cos(a) * 8, pl + 5.8, Math.sin(a) * 8), 0.16, M.tronc); }   // branches et feuillage au-dessus du regard
    } else if (e.type === 'chateau') {
      cyl(g, 4.6, 4.0, pl - 9 - sol, M.beton, 0, sol, 0, 20); cyl(g, 4.0, 11.5, 7.6, M.beton, 0, pl - 9, 0, 28); cyl(g, 11.5, 11.5, 1.4, L(0xe2ded4), 0, pl - 1.4, 0, 28);
      anneau(g, 11.2, pl);
      for (const [x, z, h] of [[6, 5, 7], [-7, 3, 5], [2, -8, 9]]) { cyl(g, 0.09, 0.05, h, M.acier, x, pl, z, 6); box(g, 0.25, 1.6, 0.4, M.blanc, x, pl + h - 1.2, z + 0.3); }
    } else if (e.type === 'clocher') {
      box(g, 2.6, 3, 2.6, treillis(1, 2), 0, pl - 1.8, 0); box(g, 3.0, 0.12, 3.0, M.bois, 0, pl - 0.06, 0); garde(g, 3.0, 3.0, pl);
    } else if (e.type === 'toit') {
      // toit-terrasse : le tireur est sur un petit échafaudage de 1,5 m posé au point haut, pour voir par-dessus le premier plan
      const rv0 = toit1(e.x, e.z), rv = rv0 > -1e8 ? Math.min(rv0, pl - 1.2) : pl - 1.5, hp = pl - rv;
      const s = new THREE.Group(); s.rotation.y = dc; g.add(s);
      box(s, 2.6, hp - 0.1, 2.6, treillis(1, 1), 0, rv + (hp - 0.1) / 2, 0); box(s, 2.8, 0.1, 2.8, M.bois, 0, pl - 0.05, 0); garde(s, 2.8, 2.8, pl);
      box(s, 1.3, 0.05, 2.1, MT.tapis, 0, pl + 0.03, 0.2);                                                    // tapis de tir
      for (let y = rv + 0.35; y < pl; y += 0.35) box(s, 0.5, 0.04, 0.04, M.acier, 0, y, -1.45);               // échelle d'accès, à l'arrière
      // premier plan du toit : lanterneaux, groupes de ventilation, gaines, panneaux solaires, dalles de cheminement.
      // Chaque objet n'est posé que si le toit du modèle existe à cet endroit, au même niveau.
      const d = new THREE.Group(); d.rotation.y = dc; g.add(d); e.detail = d; d.visible = false;
      const monde = (lx, lz) => [e.x + lx * Math.cos(dc) + lz * Math.sin(dc), e.z - lx * Math.sin(dc) + lz * Math.cos(dc)];
      // niveau du toit à cet endroit : le toit du tireur ou un toit voisin jusqu'à 5 m plus bas ; les objets se posent à leur propre niveau
      let nv = rv; const pose = (lx, lz, ref) => { const [wx, wz] = monde(lx, lz), t = toitA(wx, wz); if (ref !== undefined) return Math.abs(t - ref) < 0.3; if (t > rv + 0.4 || t < rv - 5) return false; nv = t; return true; };
      for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) {
        const lx = a * 4.2, lz = b * 4.2; if (Math.abs(a) < 2 && Math.abs(b) < 2) continue; if (!pose(lx, lz)) continue; const rv = nv;
        const [wx, wz] = monde(lx, lz), h = hash(Math.round(wx), Math.round(wz), 3), k = hash(Math.round(wx), Math.round(wz), 7);
        if (h < 0.2) { box(d, 1.5, 0.22, 1.5, M.beton, lx, rv + 0.11, lz); box(d, 1.25, 0.28, 1.25, MT.lant, lx, rv + 0.36, lz); }                    // lanterneau
        else if (h < 0.33 && pose(lx + 1.2, lz, rv) && pose(lx - 1.2, lz, rv)) { box(d, 2.2, 1.0, 1.3, MT.gal, lx, rv + 0.62, lz); box(d, 2.0, 0.06, 1.1, M.sombre, lx, rv + 1.15, lz); box(d, 2.3, 0.12, 0.2, M.acier, lx, rv + 0.06, lz + 0.5); box(d, 2.3, 0.12, 0.2, M.acier, lx, rv + 0.06, lz - 0.5); }   // groupe de ventilation sur ses longrines
        else if (h < 0.45) { cyl(d, 0.16, 0.16, 0.7, MT.gal, lx, rv, lz, 8); cyl(d, 0.32, 0.1, 0.18, MT.gal, lx, rv + 0.7, lz, 8); }                 // sortie de ventilation
        else if (h < 0.57 && pose(lx + 1.8, lz + 1.4, rv) && pose(lx - 1.8, lz - 1.4, rv)) { for (let q = -1; q <= 1; q++) { const m = box(d, 1.7, 0.05, 1.0, MT.solaire, lx + q * 1.75, rv + 0.42, lz); m.rotation.x = -0.32; box(d, 1.6, 0.3, 0.06, M.acier, lx + q * 1.75, rv + 0.15, lz - 0.3); } }   // panneaux solaires
        else if (h < 0.67 && pose(lx, lz + 2, rv) && pose(lx, lz - 2, rv)) { box(d, 0.45, 0.32, 4.2, MT.gal, lx, rv + 0.42, lz); for (const q of [-1.5, 0, 1.5]) box(d, 0.6, 0.26, 0.12, M.acier, lx, rv + 0.13, lz + q); }   // gaine sur ses supports
        else if (h < 0.8) for (let q = 0; q < 4; q++) box(d, 0.55, 0.04, 0.55, k > 0.5 ? MT.dalle : MT.dalle2, lx + (q - 1.5) * 0.62, rv + 0.03, lz);          // dalles sur plots
      }
      for (let q = 1; q <= 9; q++) if (pose(0, -1.6 - q * 0.62, rv)) box(d, 0.55, 0.04, 0.55, MT.dalle, 0, rv + 0.03, -1.6 - q * 0.62);                // cheminement jusqu'à l'échelle
      if (pose(-3.2, -8, rv) && pose(-3.2, -11, rv)) { box(d, 2.6, 2.3, 3.0, M.beton, -3.2, rv + 1.15, -9.5); box(d, 0.9, 1.9, 0.06, M.sombre, -3.2, rv + 0.95, -7.98); cyl(d, 0.05, 0.03, 5, M.acier, -4.2, rv + 2.3, -10.5, 6); }   // édicule d'accès et antenne, derrière le tireur
    }
    // enseigne du lieu
    const s = ENS[e.nom];
    if (s) {
      const dr = versRue(e.x, e.z), ux = Math.sin(dr), uz = Math.cos(dr), dc = dr;   // (masque le cap vers le centre : ici tout regarde la rue)
      const [texte, fond, lettres, w, genre] = s, h = genre === 'plaque' ? 0.9 : Math.max(1.3, w * 0.2);
      const mat = panneau(texte, fond, lettres, w, h);
      if (genre === 'totem') { cyl(g, 0.35, 0.3, 13, M.rouge, ux * 9, sol, uz * 9, 8); enseigne(g, mat, w, 2.2, ux * 9, sol + 13, uz * 9, dc + Math.PI / 2, false); }
      else if (genre === 'plaque') { cyl(g, 0.05, 0.05, 3.2, M.acier, ux * 5, sol, uz * 5, 6); enseigne(g, panneau(texte, fond, lettres, 2.4, 0.5), 2.4, 0.5, ux * 5, sol + 2.7, uz * 5, dc + Math.PI / 2, false); enseigne(g, mat, w * 1.6, h * 1.6, -ux * 1.0, pl - 3.2, -uz * 1.0, dc, false); }
      // (pas de panneau au nom du lieu sur les bâtiments : ils gâchaient la vue ; restent les totems et les plaques de rue)
    }
    // silhouette du tireur (cible de démonstration), masquée quand on occupe le poste
    if (e.type === 'arbre') { e.ox = ux * 1.45; e.oz = uz * 1.45; }
    if (e.type === 'chateau') { e.ox = ux * 9.6; e.oz = uz * 9.6; }               // au bord de la cuve, face à la ville                 // dans l'arbre, on se tient sur la cabane, à côté du tronc
    const f = new THREE.Group(); f.position.set(e.ox || 0, pl, e.oz || 0); f.rotation.y = dc; g.add(f);
    box(f, 0.5, 0.75, 0.28, L(0x3f4a3a), 0, 1.1, 0); box(f, 0.44, 0.75, 0.26, L(0x2e3338), 0, 0.38, 0); const tete = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), L(0xd9b08c)); tete.position.set(0, 1.62, 0); f.add(tete);
    box(f, 0.06, 0.06, 1.0, M.sombre, 0.18, 1.35, 0.45);
    figures.push(f); e.figure = f; e.groupe = g;
  }

  // ---------- repères propres à certains lieux ----------
  const E = (nom) => EMP.find((e) => e.nom === nom);
  { // restaurant La Fontaine : grand panneau publicitaire « TAXI » sur le toit, store blanc et enseigne au rez-de-chaussée
    const e = E('Restaurant La Fontaine'), g = e.groupe, pl = e.y - 1.6, dc = versRue(e.x, e.z), ux = Math.sin(dc), uz = Math.cos(dc), sol = groundY(e.x, e.z);
    const p = enseigne(g, panneau('TAXI', '#f2c300', '#111111', 7, 3.2), 7, 3.2, -ux * 8 + uz * 3, pl - 1.5 + 1.8, -uz * 8 - ux * 3, dc + 0.5);
    for (const sx of [-2.6, 0, 2.6]) rod(p, V(sx, 0, 0), V(sx, -1.8, -1.6), 0.05);
    box(p, 7.2, 0.3, 0.3, L(0x111111), 0, 3.5, 0);
    enseigne(g, panneau('La Fontaine', '#fbfaf6', '#1f4a36', 8, 1.3, true), 8, 1.3, ux * 12, sol + 3.4, uz * 12, dc, false);
    box(g, 9, 0.12, 2.6, L(0xfbfaf6), ux * 13.2, sol + 3.2, uz * 13.2, dc);                                 // store-banne
    for (let i = -1; i <= 1; i++) box(g, 0.5, 2.6, 0.04, L(0x1f7a4a, { side: THREE.DoubleSide }), ux * 12 + uz * i * 3.2, sol + 5.6, uz * 12 - ux * i * 3.2, dc);   // oriflammes vertes
  }
  { // place de la Paix Céleste : la grande arche bleue au-dessus du bassin rond
    const e = E('La Paix Céleste'), y = groundY(-442, -726);
    const a = new THREE.Mesh(new THREE.TorusGeometry(13, 0.55, 10, 56, Math.PI), L(0x2a63c8)); a.position.set(-442, y - 0.5, -726); a.rotation.y = 0.6; scene.add(a);
    if (e) e.arche = a;
  }
  { // esplanade Boulingrin : la Grande Girouette, mobile noir sur son mât
    const g = new THREE.Group(); g.position.set(788, groundY(788, -11), -11); scene.add(g);
    cyl(g, 0.18, 0.1, 11, M.sombre, 0, 0, 0, 8);
    const noir = L(0x15161a, { side: THREE.DoubleSide });
    rod(g, V(-4.5, 10.6, 0), V(4.5, 11.6, 0), 0.07, M.sombre);
    for (const [x, y, r, sx] of [[-4.5, 10.6, 1.5, 1], [4.5, 11.6, 1.0, 1.6], [0.5, 12.6, 0.7, 1]]) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), noir); m.position.set(x, y, 0); m.scale.x = sx; g.add(m); }
    rod(g, V(0.5, 11.1, 0), V(0.5, 12.6, 0), 0.05, M.sombre);
  }
  for (const [nom, d] of [['Mairie de Mongnigny', 14]]) { const e = E(nom); if (!e) continue; const dc = versRue(e.x, e.z); drapeaux(scene, e.x + Math.sin(dc) * d, groundY(e.x + Math.sin(dc) * d, e.z + Math.cos(dc) * d), e.z + Math.cos(dc) * d, dc + Math.PI / 2); }
  { // caserne : portes de remise rouges
    const e = E('Caserne des pompiers'), dc = versRue(e.x, e.z), sol = groundY(e.x, e.z);
    for (let i = -2; i <= 2; i++) box(e.groupe, 3.6, 4.2, 0.2, M.rouge, Math.sin(dc) * 12 + Math.cos(dc) * i * 4.2, sol + 2.1, Math.cos(dc) * 12 - Math.sin(dc) * i * 4.2, dc);
  }
  return { figures };
}
