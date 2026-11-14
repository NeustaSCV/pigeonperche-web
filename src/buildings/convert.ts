// Conversion d'un bâtiment de la banque (un THREE.Group de quelques dizaines de maillages, un par matière)
// en « soupe » de triangles triée en deux lots (opaque, transparent), d'où l'on tire :
//  - la géométrie complète (une par lot, textures rangées dans les tableaux de materials.ts) ;
//  - la géométrie lointaine (silhouette sans texture, petits éléments retirés) ;
//  - les maillages de collision par nature de surface.
import {
  AdditiveBlending,
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix3,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { config, type BuildingMaterials } from './materials';

/** Nature de surface d'un triangle (les quatre premières sont celles des collisions du jeu). */
export type BuildingSurface = 'stone' | 'wood' | 'metal' | 'dirt' | 'glass';
export const SURFACES: BuildingSurface[] = ['stone', 'wood', 'metal', 'dirt', 'glass'];
const T_STONE = 0, T_WOOD = 1, T_METAL = 2, T_DIRT = 3, T_GLASS = 4, T_FOLIAGE = 5, T_NONE = 6;
const F_DUP = 1;

/** Tampon de flottants extensible. */
class FBuf {
  a = new Float32Array(1 << 15);
  n = 0;
  need(k: number): void {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const b = new Float32Array(c);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  done(): Float32Array {
    return this.a.subarray(0, this.n);
  }
}

/** Triangles d'un lot. Par sommet : position, normale, couleur linéaire RGBA, surface (rugosité, métal, émission), UV + couche. */
export class Soup {
  pos = new FBuf();
  nor = new FBuf();
  col = new FBuf();
  surf = new FBuf();
  uvl = new FBuf();
  /** par triangle */
  tag: number[] = [];
  flag: number[] = [];
  get triangles(): number {
    return this.tag.length;
  }
}

interface MatInfo {
  alpha: boolean;
  rough: number;
  metal: number;
  emissive: number;
  opacity: number;
  double: boolean;
  back: boolean;
  layer: number;
  map: Texture | null;
  r: number; g: number; b: number;
  glassy: boolean;
}

function classify(m: any, mats: BuildingMaterials, cache: Map<string, MatInfo | null>): MatInfo | null {
  const known = cache.get(m.uuid);
  if (known !== undefined) return known;
  let info: MatInfo | null = null;
  const skip = m.colorWrite === false || m.visible === false || m.isShaderMaterial || m.blending === AdditiveBlending || !(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
  if (!skip) {
    const map: Texture | null = m.map && m.map.image ? m.map : null;
    const opacity: number = m.opacity ?? 1;
    const alphaTest = (m.alphaTest ?? 0) > 0;
    const alpha = !!m.transparent && !alphaTest && (opacity < 0.8 || (!!map && m.depthWrite === false));
    let emissive = 0;
    if (m.isMeshBasicMaterial) emissive = 1;
    else if (m.emissive) emissive = Math.min(1, (m.emissiveIntensity ?? 1) * Math.max(m.emissive.r, m.emissive.g, m.emissive.b));
    const c: Color = m.color ?? new Color(1, 1, 1);
    info = {
      alpha,
      rough: m.isMeshStandardMaterial ? m.roughness : 1,
      metal: m.isMeshStandardMaterial ? m.metalness : 0,
      emissive,
      opacity,
      double: m.side === DoubleSide,
      back: m.side === BackSide,
      layer: map ? mats.layerOf(map) : -1,
      map,
      r: c.r, g: c.g, b: c.b,
      glassy: alpha,
    };
    if (info.layer < 0) info.map = null;
  }
  cache.set(m.uuid, info);
  return info;
}

const hsl = { h: 0, s: 0, l: 0 };
const tmpC = new Color();
/** Nature de surface d'un triangle, d'après sa matière, sa teinte, son orientation et sa hauteur. */
function surfaceOf(info: MatInfo, r: number, g: number, b: number, ny: number, y: number, area: number): number {
  if (info.alpha) return T_GLASS;
  if (info.emissive > 0.5) return T_NONE;
  if (info.metal >= 0.2) return T_METAL;
  if (info.map) return T_STONE;
  tmpC.setRGB(r, g, b).getHSL(hsl, SRGBColorSpace);
  const h = hsl.h * 360;
  const flatLow = ny > 0.9 && y < 0.6;
  if (h > 62 && h < 170 && hsl.s > 0.14 && info.rough > 0.8) return flatLow ? T_DIRT : area < 3 ? T_FOLIAGE : T_STONE;
  if (h > 14 && h < 46 && hsl.s > 0.17 && hsl.l < 0.6) return flatLow ? T_DIRT : T_WOOD;
  return T_STONE;
}

const va = new Vector3(), vb = new Vector3(), vc = new Vector3();
const na = new Vector3(), nb = new Vector3(), nc = new Vector3();
const e1 = new Vector3(), e2 = new Vector3(), fn = new Vector3();
const uv = new Vector2();
const nm = new Matrix3();
const P = [va, vb, vc];
const N = [na, nb, nc];

/** 'keep' : tout le sol du modèle ; 'paved' : sans les pelouses et la terre nue (le relief du jeu les remplace) ; 'none' : sans aucune dalle au sol */
export type GroundMode = 'keep' | 'paved' | 'none';

export interface Converted {
  opaque: Soup;
  alpha: Soup;
  bounds: Box3;
  /** altitude la plus basse d'un vrai sol (face tournée vers le haut, plus de 0,5 m²) : négative si le modèle creuse */
  groundMinY: number;
  /** maillages d'origine et matières rencontrées (pour information) */
  sourceMeshes: number;
  skipped: number;
}

/** Parcourt le groupe d'un bâtiment (repère local, racine à l'identité) et trie ses triangles. */
export function convert(root: Object3D, mats: BuildingMaterials, ground: GroundMode = 'keep'): Converted {
  root.updateMatrixWorld(true);
  const opaque = new Soup(), alpha = new Soup();
  const cache = new Map<string, MatInfo | null>();
  const bounds = new Box3();
  const tint = config.tint;
  let sourceMeshes = 0, skipped = 0, groundMinY = 0;
  const col = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const uvs = [0, 0, 0, 0, 0, 0];

  root.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry;
    const pa = g.getAttribute('position');
    if (!pa) return;
    const nA = g.getAttribute('normal');
    const cA = g.getAttribute('color');
    const uA = g.getAttribute('uv');
    const idx = g.getIndex();
    const mw = mesh.matrixWorld;
    nm.getNormalMatrix(mw);
    const mirrored = mw.determinant() < 0;
    const total = idx ? idx.count : pa.count;
    const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const ranges = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    sourceMeshes++;
    for (const range of ranges) {
      const m = list[range.materialIndex ?? 0];
      const info = m ? classify(m, mats, cache) : null;
      if (!info) { skipped++; continue; }
      const out = info.alpha ? alpha : opaque;
      const map = info.map;
      if (map) map.updateMatrix();
      const end = Math.min(total, range.start + range.count);
      for (let i = range.start; i + 2 < end; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(i + k) : i + k;
          P[k].fromBufferAttribute(pa, vi).applyMatrix4(mw);
          if (nA) N[k].fromBufferAttribute(nA, vi).applyMatrix3(nm).normalize();
          if (cA) {
            col[k * 4] = cA.getX(vi); col[k * 4 + 1] = cA.getY(vi); col[k * 4 + 2] = cA.getZ(vi);
            col[k * 4 + 3] = cA.itemSize === 4 ? cA.getW(vi) : 1;
          } else { col[k * 4] = col[k * 4 + 1] = col[k * 4 + 2] = col[k * 4 + 3] = 1; }
          if (uA && map) {
            uv.fromBufferAttribute(uA as BufferAttribute, vi).applyMatrix3(map.matrix);
            uvs[k * 2] = uv.x; uvs[k * 2 + 1] = uv.y;
          } else { uvs[k * 2] = uvs[k * 2 + 1] = 0; }
        }
        e1.subVectors(vb, va);
        e2.subVectors(vc, va);
        fn.crossVectors(e1, e2);
        const area2 = fn.length();
        if (!(area2 > 1e-10)) continue;
        fn.divideScalar(area2);
        let flip = mirrored !== info.back;
        if (flip) fn.negate();
        if (!nA) { na.copy(fn); nb.copy(fn); nc.copy(fn); }
        else if (info.back) { na.negate(); nb.negate(); nc.negate(); }
        const r = (col[0] + col[4] + col[8]) / 3 * info.r, gg = (col[1] + col[5] + col[9]) / 3 * info.g, b = (col[2] + col[6] + col[10]) / 3 * info.b;
        const yMin = Math.min(va.y, vb.y, vc.y), yMax = Math.max(va.y, vb.y, vc.y);
        const tag = surfaceOf(info, r, gg, b, fn.y, yMin, area2 / 2);
        const leafy = isGreenery(info, r, gg, b, fn.y, area2 / 2);
        if (fn.y > 0.7 && area2 > 1 && yMin < groundMinY && !info.alpha) groundMinY = yMin;
        // le sol du lot : retiré à la demande, le relief du jeu passe dessous
        if (ground !== 'keep' && fn.y > 0.95 && yMax < 0.12 && yMin > -0.1 && !info.alpha && (ground === 'none' || tag === T_DIRT)) continue;
        const passes = info.double && !info.alpha ? 2 : 1;
        for (let pass = 0; pass < passes; pass++) {
          if (pass === 1) flip = !flip;
          out.pos.need(9); out.nor.need(9); out.col.need(12); out.surf.need(9); out.uvl.need(9);
          for (let q = 0; q < 3; q++) {
            const k = flip ? 2 - q : q;
            const p = P[k], n = N[k];
            const sgn = pass === 1 ? -1 : 1;
            let a = out.pos.a, j = out.pos.n;
            a[j] = p.x; a[j + 1] = p.y; a[j + 2] = p.z; out.pos.n += 3;
            a = out.nor.a; j = out.nor.n;
            a[j] = n.x * sgn; a[j + 1] = n.y * sgn; a[j + 2] = n.z * sgn; out.nor.n += 3;
            a = out.col.a; j = out.col.n;
            if (leafy) {
              // feuillage des modèles : désaturé et teinté comme les arbres du jeu (palette du niveau comprise)
              const cr = col[k * 4] * info.r, cg = col[k * 4 + 1] * info.g, cb = col[k * 4 + 2] * info.b;
              const l = 0.3 * cr + 0.59 * cg + 0.11 * cb;
              a[j] = (l + (cr - l) * config.foliageSat) * config.foliageTint[0]; a[j + 1] = (l + (cg - l) * config.foliageSat) * config.foliageTint[1]; a[j + 2] = (l + (cb - l) * config.foliageSat) * config.foliageTint[2];
            } else { a[j] = col[k * 4] * info.r * tint[0]; a[j + 1] = col[k * 4 + 1] * info.g * tint[1]; a[j + 2] = col[k * 4 + 2] * info.b * tint[2]; }
            a[j + 3] = col[k * 4 + 3] * info.opacity; out.col.n += 4;
            a = out.surf.a; j = out.surf.n;
            a[j] = info.rough; a[j + 1] = info.metal; a[j + 2] = info.emissive; out.surf.n += 3;
            a = out.uvl.a; j = out.uvl.n;
            a[j] = uvs[k * 2]; a[j + 1] = uvs[k * 2 + 1]; a[j + 2] = info.layer; out.uvl.n += 3;
          }
          out.tag.push(tag);
          out.flag.push(pass === 1 ? F_DUP : 0);
        }
        bounds.expandByPoint(va); bounds.expandByPoint(vb); bounds.expandByPoint(vc);
      }
    }
  });
  return { opaque, alpha, bounds, groundMinY, sourceMeshes, skipped };
}

/**
 * Verdure d'un modèle (sapins, mélèzes dorés, buissons, pelouses) : matière mate, verte, ou jaune d'or sur une
 * facette inclinée (cône d'un arbre). Sert seulement à la teinte ; la nature de surface (collisions) reste `surfaceOf`.
 */
function isGreenery(info: MatInfo, r: number, g: number, b: number, ny: number, area: number): boolean {
  if (info.alpha || info.metal >= 0.2 || info.emissive > 0.5 || info.rough <= 0.8) return false;
  tmpC.setRGB(r, g, b).getHSL(hsl, SRGBColorSpace);
  const h = hsl.h * 360;
  if (h > 62 && h < 170 && hsl.s > 0.14) return true;
  return h > 38 && h <= 62 && hsl.s > 0.3 && ny > 0.12 && ny < 0.9 && area < 8;
}

// ---------- géométries de rendu ----------

function packNormals(src: Float32Array): BufferAttribute {
  const n = src.length / 3;
  const a = new Int8Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = Math.round(src[i * 3] * 127);
    a[i * 4 + 1] = Math.round(src[i * 3 + 1] * 127);
    a[i * 4 + 2] = Math.round(src[i * 3 + 2] * 127);
  }
  return new BufferAttribute(a, 4, true);
}
function packColors(src: Float32Array): BufferAttribute {
  const a = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) a[i] = Math.round(Math.min(1, Math.max(0, src[i])) * 65535);
  return new BufferAttribute(a, 4, true);
}
function packSurf(src: Float32Array): BufferAttribute {
  const n = src.length / 3;
  const a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = Math.round(Math.min(1, Math.max(0, src[i * 3])) * 255);
    a[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, src[i * 3 + 1])) * 255);
    a[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, src[i * 3 + 2])) * 255);
  }
  return new BufferAttribute(a, 4, true);
}

/** Géométrie complète d'un lot (non indexée). Renvoie null si le lot est vide. */
export function fullGeometry(s: Soup): BufferGeometry | null {
  if (!s.triangles) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(s.pos.done().slice(), 3));
  g.setAttribute('normal', packNormals(s.nor.done()));
  g.setAttribute('color', packColors(s.col.done()));
  g.setAttribute('aSurf', packSurf(s.surf.done()));
  g.setAttribute('aUvl', new BufferAttribute(s.uvl.done().slice(), 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** hauteur d'un triangle sur son plus grand côté : la « largeur » de l'élément qu'il dessine */
function altitude(p: Float32Array, i: number): number {
  const ax = p[i], ay = p[i + 1], az = p[i + 2];
  const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
  const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const wx = cx - bx, wy = cy - by, wz = cz - bz;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const a2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const m = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
  return m > 0 ? a2 / m : 0;
}

export interface FarOptions {
  /** largeur minimale (m) d'un élément gardé dans la silhouette lointaine */
  minFeature: number;
}

/**
 * Géométrie lointaine : un seul maillage sans texture. On retire les triangles plus étroits que `minFeature`
 * (menuiseries, lierre, gravats, garde-corps : sous le pixel et sources de scintillement), la texture devient une
 * teinte moyenne cuite dans les sommets, les vitres deviennent opaques.
 */
export function farGeometry(c: Converted, mats: BuildingMaterials, o: FarOptions): BufferGeometry | null {
  const pos = new FBuf(), nor = new FBuf(), col = new FBuf(), surf = new FBuf();
  const smp: [number, number, number, number] = [1, 1, 1, 1];
  for (const s of [c.opaque, c.alpha]) {
    const glass = s === c.alpha;
    const P0 = s.pos.done(), N0 = s.nor.done(), C0 = s.col.done(), S0 = s.surf.done(), U0 = s.uvl.done();
    // Un pignon ou un mur ébréché est fait de bandes étroites côte à côte : ce sont des surfaces pleines, à garder.
    // On mesure donc, par plan et par cube de 1 m, la surface des triangles étroits : pleine (≥ 0,6 m²) = surface
    // continue ; clairsemée = menuiserie, grille, lierre, à retirer.
    const thin = new Uint8Array(s.triangles);
    const keys = new Array<string>(s.triangles);
    const fill = new Map<string, number>();
    for (let t = 0; t < s.triangles; t++) {
      const i = t * 9;
      if (altitude(P0, i) >= o.minFeature) continue;
      thin[t] = 1;
      const ux = P0[i + 3] - P0[i], uy = P0[i + 4] - P0[i + 1], uz = P0[i + 5] - P0[i + 2];
      const vx = P0[i + 6] - P0[i], vy = P0[i + 7] - P0[i + 1], vz = P0[i + 8] - P0[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const a2 = Math.hypot(nx, ny, nz);
      if (!(a2 > 0)) { keys[t] = ''; continue; }
      nx /= a2; ny /= a2; nz /= a2;
      const cx = (P0[i] + P0[i + 3] + P0[i + 6]) / 3, cy = (P0[i + 1] + P0[i + 4] + P0[i + 7]) / 3, cz = (P0[i + 2] + P0[i + 5] + P0[i + 8]) / 3;
      const d = (nx * cx + ny * cy + nz * cz) * 8;
      const base = `${Math.round(nx * 8)},${Math.round(ny * 8)},${Math.round(nz * 8)},${Math.floor(cx)},${Math.floor(cy)},${Math.floor(cz)},`;
      // la distance du plan tombe souvent pile sur une limite d'arrondi (faces à ±0,15 m) : on compte dans les deux cases
      const k0 = base + Math.floor(d), k1 = base + Math.ceil(d);
      keys[t] = k0 + '|' + k1;
      fill.set(k0, (fill.get(k0) ?? 0) + a2 / 2);
      if (k1 !== k0) fill.set(k1, (fill.get(k1) ?? 0) + a2 / 2);
    }
    for (let t = 0; t < s.triangles; t++) {
      const i = t * 9;
      if (thin[t]) {
        const k = keys[t];
        if (!k) continue;
        const cut = k.indexOf('|');
        if (Math.max(fill.get(k.slice(0, cut)) ?? 0, fill.get(k.slice(cut + 1)) ?? 0) < 0.6) continue;
      }
      if (glass && C0[t * 12 + 3] < 0.3) continue;
      const layer = U0[i + 2];
      let tr = 1, tg = 1, tb = 1;
      if (layer >= 0) {
        const u0 = U0[i], v0 = U0[i + 1], u1 = U0[i + 3], v1 = U0[i + 4], u2 = U0[i + 6], v2 = U0[i + 7];
        mats.sample(layer, Math.min(u0, u1, u2), Math.min(v0, v1, v2), Math.max(u0, u1, u2), Math.max(v0, v1, v2), smp);
        if (smp[3] < 0.4 && !glass) continue;
        tr = smp[0]; tg = smp[1]; tb = smp[2];
      }
      pos.need(9); nor.need(9); col.need(12); surf.need(9);
      pos.a.set(P0.subarray(i, i + 9), pos.n); pos.n += 9;
      nor.a.set(N0.subarray(i, i + 9), nor.n); nor.n += 9;
      surf.a.set(S0.subarray(i, i + 9), surf.n); surf.n += 9;
      for (let k = 0; k < 3; k++) {
        const j = t * 12 + k * 4;
        col.a[col.n++] = C0[j] * tr; col.a[col.n++] = C0[j + 1] * tg; col.a[col.n++] = C0[j + 2] * tb; col.a[col.n++] = 1;
      }
    }
  }
  if (!pos.n) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos.done().slice(), 3));
  g.setAttribute('normal', packNormals(nor.done()));
  g.setAttribute('color', packColors(col.done()));
  g.setAttribute('aSurf', packSurf(surf.done()));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------- collisions ----------

export interface CollisionPart {
  tag: BuildingSurface;
  /** positions seules, repère local du bâtiment, non indexée */
  geometry: BufferGeometry;
  triangles: number;
}

/**
 * Maillages de collision par nature de surface. Allégés : sans feuillage, sans éléments plus étroits que
 * `minFeature` (croisillons, barreaux, câbles : la balle passe), sans doublons de faces doubles. Les vitres et
 * l'eau sont à part (`glass`) : au jeu de décider si elles arrêtent la balle.
 */
export function collisionParts(c: Converted, minFeature = 0.07): CollisionPart[] {
  const bufs = SURFACES.map(() => new FBuf());
  for (const s of [c.opaque, c.alpha]) {
    const P0 = s.pos.done();
    for (let t = 0; t < s.triangles; t++) {
      const tag = s.tag[t];
      if (tag > T_GLASS || s.flag[t] & F_DUP) continue;
      if (altitude(P0, t * 9) < minFeature) continue;
      const b = bufs[tag];
      b.need(9);
      b.a.set(P0.subarray(t * 9, t * 9 + 9), b.n);
      b.n += 9;
    }
  }
  const parts: CollisionPart[] = [];
  bufs.forEach((b, i) => {
    if (!b.n) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(b.done().slice(), 3));
    parts.push({ tag: SURFACES[i], geometry: g, triangles: b.n / 9 });
  });
  return parts;
}

export { T_STONE, T_WOOD, T_METAL, T_DIRT };
