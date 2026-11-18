// Ville nouvelle : perchoirs des emplacements (échafaudage, nacelle, mât, arbre, château d'eau, clocher, petit
// échafaudage de toit-terrasse) et repères propres à quelques lieux. Formes et cotes de la page d'origine : plancher
// à 1,6 m sous l'œil du tireur debout, garde-corps bas (0,6 m) en tube fin. Rien ici n'entre dans les collisions des
// balles : un garde-corps n'arrête ni la balle du tireur ni celle qui lui est destinée, et ne gêne pas le plan proche
// de la lunette. Les pièces d'un perchoir sont fusionnées en un maillage (shade.ts).
import { BoxGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3, type Material, type Object3D } from 'three';
import type { Engine } from '../../core/engine';
import { EYE, hash, type Emplacement, type VilleWorld } from './data';
import { bake, flat, lit } from './shade';

const UP = new Vector3(0, 1, 0);
const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const L = flat;
const M = { acier: L(0x8f969c), sombre: L(0x2c3035), bois: L(0x9a7a52), blanc: L(0xecebe6), beton: L(0xd6d2c8), tronc: L(0x4a3c30), rouge: L(0xb3221f), jaune: L(0xe0b020), verre: L(0x1d2a33), pneu: L(0x17181a) };
const MT = { tapis: L(0x3a4a3a), lant: L(0xdfe8ee), gal: L(0xa9afb4), solaire: L(0x1c2c4a), dalle: L(0xc9c6bd), dalle2: L(0xb4b1a8) };
const box = (g: Object3D, w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, ry = 0): Mesh => { const m = new Mesh(new BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
const cyl = (g: Object3D, r0: number, r1: number, h: number, mat: Material, x: number, y: number, z: number, seg = 12, open = false): Mesh => { const m = new Mesh(new CylinderGeometry(r1, r0, h, seg, 1, open), mat); m.position.set(x, y + h / 2, z); g.add(m); return m; };
const rod = (g: Object3D, a: Vector3, b: Vector3, r = 0.06, mat: Material = M.acier): Mesh => { const d = new Vector3().subVectors(b, a); const m = new Mesh(new CylinderGeometry(r, r, d.length(), 6), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); g.add(m); return m; };
/** Hauteur de la lisse des garde-corps. Basse (0,6 m) pour qu'elle ne barre pas la vue du tireur debout, œil à 1,6 m. */
export const GARDE_H = 0.6;
/** garde-corps d'une plateforme rectangulaire : lisse basse, sous-lisse, montants */
function garde(g: Object3D, w: number, d: number, y: number): void {
  for (const [a, b] of [[V(-w / 2, 0, -d / 2), V(w / 2, 0, -d / 2)], [V(w / 2, 0, -d / 2), V(w / 2, 0, d / 2)], [V(w / 2, 0, d / 2), V(-w / 2, 0, d / 2)], [V(-w / 2, 0, d / 2), V(-w / 2, 0, -d / 2)]]) {
    for (const h of [GARDE_H, GARDE_H / 2]) rod(g, a.clone().setY(y + h), b.clone().setY(y + h), 0.03);
    rod(g, a.clone().setY(y), a.clone().setY(y + GARDE_H), 0.035);
  }
}
/** garde-corps d'une plateforme ronde */
function anneau(g: Object3D, r: number, y: number, mat: Material = M.acier): void {
  for (const h of [GARDE_H, GARDE_H / 2]) { const t = new Mesh(new TorusGeometry(r, 0.035, 5, 28), mat); t.rotation.x = Math.PI / 2; t.position.y = y + h; g.add(t); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; rod(g, V(Math.cos(a) * r, y, Math.sin(a) * r), V(Math.cos(a) * r, y + GARDE_H, Math.sin(a) * r), 0.03, mat); }
}

/** panneaux à texte : numéro de l'emplacement → [fond, lettres, largeur en mètres, genre]. Le texte est le nom de l'emplacement. */
const SIGNS: Record<number, [string, string, number, 'plaque' | 'totem']> = {
  15: ['#1f4f9c', '#ffffff', 7, 'plaque'], 22: ['#1f3f8f', '#ffffff', 5, 'plaque'], 25: ['#f4f4f0', '#1b4f9a', 8, 'plaque'], 36: ['#1f3f8f', '#ffffff', 5, 'plaque'],
  38: ['#1f3f8f', '#ffffff', 5, 'plaque'], 2: ['#1f3f8f', '#ffffff', 5, 'plaque'], 12: ['#1f3f8f', '#ffffff', 5, 'plaque'], 28: ['#c8201e', '#ffc72c', 5, 'totem'],
};

export function buildPerches(engine: Engine, w: VilleWorld): Group {
  const { groundY, bendY, raw } = w;
  const out = new Group();
  // cap vers la rue la plus proche (à 12 m au moins, 120 m au plus) : enseignes et devantures regardent la rue
  const versRue = (x: number, z: number): number => {
    let best: [number, number] | null = null, bd = 120;
    for (const r of raw.voirie) for (const p of r.p) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd && d > 12) { bd = d; best = p; } }
    return best ? Math.atan2(best[0] - x, best[1] - z) : Math.atan2(w.BCX - x, w.BCZ - z);
  };
  // treillis d'échafaudage (tubes galvanisés en croix)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  { const x = cv.getContext('2d')!; x.strokeStyle = '#a9afb4'; x.lineWidth = 6; x.strokeRect(3, 3, 58, 58); x.lineWidth = 4; x.beginPath(); x.moveTo(4, 4); x.lineTo(60, 60); x.moveTo(60, 4); x.lineTo(4, 60); x.stroke(); }
  const treillis = (ru: number, rv: number): Material => { const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 8; return lit(engine, { map: t, alphaTest: 0.4, side: DoubleSide }, 'treillis'); };
  // panneau à texte, en lettres simples, sans logo
  const panneau = (texte: string, fond: string, lettres: string, pw: number, ph: number, italique = false): Material => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = Math.max(64, Math.round((1024 * ph) / pw));
    const x = c.getContext('2d')!;
    x.fillStyle = fond; x.fillRect(0, 0, c.width, c.height);
    let px = c.height * 0.62;
    x.font = `${italique ? 'italic ' : ''}bold ${px}px Helvetica, Arial, sans-serif`;
    const tw = x.measureText(texte).width;
    if (tw > c.width * 0.9) { px *= (c.width * 0.9) / tw; x.font = `${italique ? 'italic ' : ''}bold ${px}px Helvetica, Arial, sans-serif`; }
    x.fillStyle = lettres; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(texte, c.width / 2, c.height / 2 + px * 0.04);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
    return lit(engine, { map: t }, 'panneau');
  };
  // enseigne lisible des deux côtés
  const enseigne = (g: Object3D, mat: Material, pw: number, ph: number, x: number, yBas: number, z: number, ry: number): Group => {
    const grp = new Group();
    grp.position.set(x, yBas, z); grp.rotation.y = ry; g.add(grp);
    for (const s of [1, -1]) { const m = new Mesh(new PlaneGeometry(pw, ph), mat); m.position.set(0, ph / 2, s * 0.09); if (s < 0) m.rotation.y = Math.PI; grp.add(m); }
    box(grp, pw + 0.16, ph + 0.16, 0.14, M.sombre, 0, ph / 2, 0);
    return grp;
  };
  const feuillage = [L(0x4c6b34), L(0x5f7d3a), L(0x3f5f33), L(0x56733a)];
  const houppier = new IcosahedronGeometry(1, 1);
  // toit du modèle à cet endroit ; −1e9 hors toit ou à moins de 90 cm d'un bord
  const toit1 = (x: number, z: number): number => w.roofAt(x, z);
  const toitA = (x: number, z: number): number => { const t = toit1(x, z); for (const [a, b] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) if (Math.abs(toit1(x + a, z + b) - t) > 0.3) return -1e9; return t; };

  const groups = new Map<number, Group>();
  for (const e of w.emp) {
    if (e.grue) continue;   // plateforme et garde-corps au sommet de la grue : landmarks.ts
    const g = new Group();
    g.position.set(e.x, 0, e.z);
    groups.set(e.n, g);
    const sol = groundY(e.x, e.z), toit = e.sol + e.toit, pl = e.y - EYE;          // sol, dessus du toit, plancher où se tient le tireur
    const dc = Math.atan2(w.BCX - e.x, w.BCZ - e.z);                                // cap vers le centre de la carte
    if (e.type === 'echaf') {
      const H = Math.max(0.5, pl - toit);
      box(g, 2.5, H - 0.3, 2.5, treillis(1, Math.max(1, Math.round(H / 2))), 0, toit + (H - 0.3) / 2, 0);        // s'arrête sous le plancher
      for (let y = toit + 2; y < pl - 0.5; y += 2) box(g, 2.5, 0.06, 2.5, M.bois, 0, y, 0);                // planchers intermédiaires
      for (let y = toit; y < pl; y += 2) rod(g, V(1.32, y, -0.9), V(1.32, Math.min(pl, y + 2), 0.9), 0.03);   // échelles en biais
      box(g, 3.4, 0.14, 3.4, M.bois, 0, pl - 0.07, 0); garde(g, 3.4, 3.4, pl);
      box(g, 3.4, 0.9, 0.04, L(0x2f6e4a, { side: DoubleSide }), 0, pl + 0.45, -1.7);                        // filet de chantier sur un côté
    } else if (e.type === 'nacelle') {
      const t = new Group(); t.rotation.y = dc + Math.PI / 2; g.add(t);                                    // camion le long de la rue
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
      for (const sd of [1, -1]) {
        box(g, 4.6, 2.4, 0.2, M.sombre, Math.sin(dc) * sd * 1.2, pl - 2.4, Math.cos(dc) * sd * 1.2, dc);
        for (let i = 0; i < 8; i++) box(g, 0.9, 0.9, 0.12, L(0xe8ecf0), Math.sin(dc) * sd * 1.36 + Math.cos(dc) * ((i % 4) - 1.5) * 1.1, pl - 2.95 + Math.floor(i / 4) * 1.1, Math.cos(dc) * sd * 1.36 - Math.sin(dc) * ((i % 4) - 1.5) * 1.1, dc);
      }
    } else if (e.type === 'arbre') {
      cyl(g, 1.15, 0.5, pl + 6 - sol, M.tronc, 0, sol - 0.3, 0, 9);
      cyl(g, 2.3, 2.3, 0.16, M.bois, 0, pl - 0.16, 0, 6); anneau(g, 2.2, pl, M.bois);
      for (let y = sol + 1; y < pl; y += 0.45) box(g, 0.6, 0.06, 0.1, M.bois, 0, y, 1.0 - (y - sol) * 0.012);
      const blob = (r: number, x: number, y: number, z: number, k: number): void => { const m = new Mesh(houppier, feuillage[k % 4]); m.scale.set(r, r * 0.8, r); m.position.set(x, y, z); m.rotation.y = k; g.add(m); };
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
      // toit-terrasse : petit échafaudage de 1,5 m posé au point haut, pour voir par-dessus le premier plan
      const rv0 = toit1(e.x, e.z), rv = rv0 > -1e8 ? Math.min(rv0, pl - 1.2) : pl - 1.5, hp = pl - rv;
      const s = new Group(); s.rotation.y = dc; g.add(s);
      box(s, 2.6, hp - 0.1, 2.6, treillis(1, 1), 0, rv + (hp - 0.1) / 2, 0); box(s, 2.8, 0.1, 2.8, M.bois, 0, pl - 0.05, 0); garde(s, 2.8, 2.8, pl);
      box(s, 1.3, 0.05, 2.1, MT.tapis, 0, pl + 0.03, 0.2);                                                    // tapis de tir
      for (let y = rv + 0.35; y < pl; y += 0.35) box(s, 0.5, 0.04, 0.04, M.acier, 0, y, -1.45);               // échelle d'accès, à l'arrière
      // premier plan du toit : lanterneaux, groupes de ventilation, gaines, panneaux solaires, dalles de cheminement.
      // Chaque objet n'est posé que si le toit du modèle existe à cet endroit, au même niveau.
      const d = new Group(); d.rotation.y = dc; g.add(d);
      const monde = (lx: number, lz: number): [number, number] => [e.x + lx * Math.cos(dc) + lz * Math.sin(dc), e.z - lx * Math.sin(dc) + lz * Math.cos(dc)];
      // niveau du toit à cet endroit : celui du tireur ou un toit voisin jusqu'à 5 m plus bas ; les objets se posent à leur propre niveau
      let nv = rv;
      const pose = (lx: number, lz: number, ref?: number): boolean => { const [wx, wz] = monde(lx, lz), t = toitA(wx, wz); if (ref !== undefined) return Math.abs(t - ref) < 0.3; if (t > rv + 0.4 || t < rv - 5) return false; nv = t; return true; };
      for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) {
        const lx = a * 4.2, lz = b * 4.2;
        if (Math.abs(a) < 2 && Math.abs(b) < 2) continue;
        if (!pose(lx, lz)) continue;
        const r = nv;
        const [wx, wz] = monde(lx, lz), h = hash(Math.round(wx), Math.round(wz), 3), k = hash(Math.round(wx), Math.round(wz), 7);
        if (h < 0.2) { box(d, 1.5, 0.22, 1.5, M.beton, lx, r + 0.11, lz); box(d, 1.25, 0.28, 1.25, MT.lant, lx, r + 0.36, lz); }                    // lanterneau
        else if (h < 0.33 && pose(lx + 1.2, lz, r) && pose(lx - 1.2, lz, r)) { box(d, 2.2, 1.0, 1.3, MT.gal, lx, r + 0.62, lz); box(d, 2.0, 0.06, 1.1, M.sombre, lx, r + 1.15, lz); box(d, 2.3, 0.12, 0.2, M.acier, lx, r + 0.06, lz + 0.5); box(d, 2.3, 0.12, 0.2, M.acier, lx, r + 0.06, lz - 0.5); }   // groupe de ventilation sur ses longrines
        else if (h < 0.45) { cyl(d, 0.16, 0.16, 0.7, MT.gal, lx, r, lz, 8); cyl(d, 0.32, 0.1, 0.18, MT.gal, lx, r + 0.7, lz, 8); }                 // sortie de ventilation
        else if (h < 0.57 && pose(lx + 1.8, lz + 1.4, r) && pose(lx - 1.8, lz - 1.4, r)) { for (let q = -1; q <= 1; q++) { box(d, 1.7, 0.05, 1.0, MT.solaire, lx + q * 1.75, r + 0.42, lz).rotation.x = -0.32; box(d, 1.6, 0.3, 0.06, M.acier, lx + q * 1.75, r + 0.15, lz - 0.3); } }   // panneaux solaires
        else if (h < 0.67 && pose(lx, lz + 2, r) && pose(lx, lz - 2, r)) { box(d, 0.45, 0.32, 4.2, MT.gal, lx, r + 0.42, lz); for (const q of [-1.5, 0, 1.5]) box(d, 0.6, 0.26, 0.12, M.acier, lx, r + 0.13, lz + q); }   // gaine sur ses supports
        else if (h < 0.8) for (let q = 0; q < 4; q++) box(d, 0.55, 0.04, 0.55, k > 0.5 ? MT.dalle : MT.dalle2, lx + (q - 1.5) * 0.62, r + 0.03, lz);          // dalles sur plots
      }
      for (let q = 1; q <= 9; q++) if (pose(0, -1.6 - q * 0.62, rv)) box(d, 0.55, 0.04, 0.55, MT.dalle, 0, rv + 0.03, -1.6 - q * 0.62);                // cheminement jusqu'à l'échelle
      if (pose(-3.2, -8, rv) && pose(-3.2, -11, rv)) { box(d, 2.6, 2.3, 3.0, M.beton, -3.2, rv + 1.15, -9.5); box(d, 0.9, 1.9, 0.06, M.sombre, -3.2, rv + 0.95, -7.98); cyl(d, 0.05, 0.03, 5, M.acier, -4.2, rv + 2.3, -10.5, 6); }   // édicule d'accès et antenne, derrière le tireur
    }
    // totem ou plaque de rue au nom de l'emplacement (aucun panneau sur les bâtiments)
    const sg = SIGNS[e.n];
    if (sg) {
      const dr = versRue(e.x, e.z), ux = Math.sin(dr), uz = Math.cos(dr);
      const [fond, lettres, sw, genre] = sg, sh = genre === 'plaque' ? 0.9 : Math.max(1.3, sw * 0.2);
      const texte = genre === 'plaque' ? e.nom.toUpperCase() : e.nom;
      const mat = panneau(texte, fond, lettres, sw, sh);
      if (genre === 'totem') { cyl(g, 0.35, 0.3, 13, M.rouge, ux * 9, sol, uz * 9, 8); enseigne(g, mat, sw, 2.2, ux * 9, sol + 13, uz * 9, dr + Math.PI / 2); }
      else { cyl(g, 0.05, 0.05, 3.2, M.acier, ux * 5, sol, uz * 5, 6); enseigne(g, panneau(texte, fond, lettres, 2.4, 0.5), 2.4, 0.5, ux * 5, sol + 2.7, uz * 5, dr + Math.PI / 2); enseigne(g, mat, sw * 1.6, sh * 1.6, -ux * 1.0, pl - 3.2, -uz * 1.0, dr); }
    }
  }

  // ---------- repères propres à certains lieux ----------
  const E = (n: number): Emplacement | undefined => w.emp.find((e) => e.n === n);
  const loose = new Group();
  { // n° 19 : bandeau publicitaire bas sur le toit, store blanc et enseigne au rez-de-chaussée
    const e = E(19), g = e && groups.get(19);
    if (e && g) {
      const pl = e.y - EYE, dc = versRue(e.x, e.z), ux = Math.sin(dc), uz = Math.cos(dc), sol = groundY(e.x, e.z);
      // le sommet du bandeau (1,35 m) reste sous le plancher du tireur (1,5 m) : il ne le masque pas aux autres et ne lui bouche pas la vue
      const p = enseigne(g, panneau('TAXI', '#f2c300', '#111111', 7, 1.3), 7, 1.3, -ux * 8 + uz * 3, pl - 1.5 + 0.05, -uz * 8 - ux * 3, dc + 0.5);
      for (const sx of [-3.3, 3.3]) rod(p, V(sx, 0, 0), V(sx, 1.3, 0), 0.05);
      enseigne(g, panneau(e.nom, '#fbfaf6', '#1f4a36', 8, 1.3, true), 8, 1.3, ux * 12, sol + 3.4, uz * 12, dc);
      box(g, 9, 0.12, 2.6, L(0xfbfaf6), ux * 13.2, sol + 3.2, uz * 13.2, dc);                                 // store-banne
      for (let i = -1; i <= 1; i++) box(g, 0.5, 2.6, 0.04, L(0x1f7a4a, { side: DoubleSide }), ux * 12 + uz * i * 3.2, sol + 5.6, uz * 12 - ux * i * 3.2, dc);   // oriflammes vertes
    }
  }
  { // grande arche bleue au-dessus d'un bassin rond
    const a = new Mesh(new TorusGeometry(13, 0.55, 10, 56, Math.PI), L(0x2a63c8));
    a.position.set(-442, groundY(-442, -726) - 0.5, -726); a.rotation.y = 0.6; loose.add(a);
  }
  { // mobile noir sur son mât
    const g = new Group(); g.position.set(788, groundY(788, -11), -11); loose.add(g);
    cyl(g, 0.18, 0.1, 11, M.sombre, 0, 0, 0, 8);
    const noir = L(0x15161a, { side: DoubleSide });
    rod(g, V(-4.5, 10.6, 0), V(4.5, 11.6, 0), 0.07, M.sombre);
    for (const [x, y, r, sx] of [[-4.5, 10.6, 1.5, 1], [4.5, 11.6, 1.0, 1.6], [0.5, 12.6, 0.7, 1]]) { const m = new Mesh(new CircleGeometry(r, 20), noir); m.position.set(x, y, 0); m.scale.x = sx; g.add(m); }
    rod(g, V(0.5, 11.1, 0), V(0.5, 12.6, 0), 0.05, M.sombre);
  }
  { // n° 24 : trois mâts et leurs drapeaux tricolores devant la mairie
    const e = E(24);
    if (e) {
      const dc = versRue(e.x, e.z), x = e.x + Math.sin(dc) * 14, z = e.z + Math.cos(dc) * 14;
      const grp = new Group(); grp.position.set(x, groundY(x, z), z); grp.rotation.y = dc + Math.PI / 2; loose.add(grp);
      for (let i = -1; i <= 1; i++) { cyl(grp, 0.06, 0.04, 9, M.blanc, i * 2.2, 0, 0, 6); [0x1f3f8f, 0xf2f2f2, 0xc8201e].forEach((c, k) => box(grp, 0.6, 1.3, 0.03, L(c, { side: DoubleSide }), i * 2.2 + 0.36 + k * 0.6, 8.2, 0)); }
    }
  }
  { // n° 21 : portes de remise rouges
    const e = E(21), g = e && groups.get(21);
    if (e && g) { const dc = versRue(e.x, e.z), sol = groundY(e.x, e.z); for (let i = -2; i <= 2; i++) box(g, 3.6, 4.2, 0.2, M.rouge, Math.sin(dc) * 12 + Math.cos(dc) * i * 4.2, sol + 2.1, Math.cos(dc) * 12 - Math.sin(dc) * i * 4.2, dc); }
  }
  // un maillage fusionné par perchoir : chacun a sa sphère englobante
  for (const g of groups.values()) { const holder = new Group(); holder.add(g); out.add(bake(engine, holder, bendY)); }
  out.add(bake(engine, loose, bendY));
  return out;
}
