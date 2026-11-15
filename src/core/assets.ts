// Chargement des assets avec repli procédural : le jeu ne dépend jamais d'un fichier manquant.
import {
  CanvasTexture,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Group,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry32 } from './noise';

const BASE = import.meta.env.BASE_URL;
/** empreinte du contenu de public/ (vite.config.ts) : tant qu'elle ne change pas, le navigateur garde les fichiers sans redemander */
declare const __ASSETS_VERSION__: string | undefined;
const VERSION = typeof __ASSETS_VERSION__ === 'string' && __ASSETS_VERSION__ ? '?v=' + __ASSETS_VERSION__ : '';
export const assetUrl = (p: string): string => BASE + p + VERSION;

/** Côté maximal des textures (0 = sans limite). Sur téléphone, la mémoire graphique est comptée : 512. */
let texLimit = 0;
export function setTextureLimit(px: number): void {
  texLimit = px;
}
function fit(img: ImageBitmap | HTMLCanvasElement): ImageBitmap | HTMLCanvasElement {
  if (!texLimit || Math.max(img.width, img.height) <= texLimit) return img;
  const k = texLimit / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  if ('close' in img) img.close();
  return c;
}

export async function loadImage(path: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(assetUrl(path));
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

export async function fetchBin(path: string): Promise<ArrayBuffer> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error('introuvable : ' + path);
  return r.arrayBuffer();
}

const FALLBACK: Record<string, [number, number, number]> = {
  grass: [84, 98, 46], rock: [118, 114, 108], scree: [126, 120, 110], forest: [70, 60, 42], moss: [70, 88, 40],
  dirt: [120, 100, 76], wall: [128, 122, 112], flag: [120, 116, 108], bark: [80, 64, 50], wood: [70, 54, 40],
  plaster: [200, 188, 166], roof: [150, 82, 56], metal: [110, 112, 114], fabric: [150, 140, 120],
};

function fallbackCanvas(name: string, kind: 'diff' | 'nor' | 'arm', size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const rnd = mulberry32(name.length * 131 + 7);
  const base = kind === 'diff' ? FALLBACK[name] ?? [128, 128, 128] : kind === 'nor' ? [128, 128, 255] : [255, 220, 0];
  for (let i = 0; i < size * size; i++) {
    const n = kind === 'diff' ? (rnd() - 0.5) * 36 : 0;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export type TexKind = 'diff' | 'nor' | 'arm';

export async function loadPixels(name: string, kind: TexKind, size: number): Promise<Uint8ClampedArray> {
  const img = await loadImage(`assets/tex/${name}_${kind}.jpg`);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img ?? fallbackCanvas(name, kind, 64), 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

/** Texture 2D tuilable. */
export async function loadTex(name: string, kind: TexKind, anisotropy = 4): Promise<Texture> {
  const img = await loadImage(`assets/tex/${name}_${kind}.jpg`);
  const tex = new CanvasTexture(fit(img ?? fallbackCanvas(name, kind, 64)) as any);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = kind === 'diff' ? SRGBColorSpace : NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export interface TexSet {
  map: Texture;
  normalMap: Texture;
  arm: Texture;
}
export async function loadTexSet(name: string, anisotropy = 4): Promise<TexSet> {
  const [map, normalMap, arm] = await Promise.all([loadTex(name, 'diff', anisotropy), loadTex(name, 'nor', anisotropy), loadTex(name, 'arm', anisotropy)]);
  return { map, normalMap, arm };
}

/** Tableau de textures (une couche par nom) et couleur moyenne linéaire de chaque couche. */
export async function loadTexArray(names: string[], kind: TexKind, size: number, anisotropy: number): Promise<{ tex: DataArrayTexture; mean: [number, number, number][] }> {
  if (texLimit) size = Math.min(size, texLimit);
  const layers = await Promise.all(names.map((n) => loadPixels(n, kind, size)));
  const data = new Uint8Array(size * size * 4 * names.length);
  const mean: [number, number, number][] = [];
  layers.forEach((px, i) => {
    data.set(px, i * size * size * 4);
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < px.length; k += 64) {
      r += Math.pow(px[k] / 255, 2.2);
      g += Math.pow(px[k + 1] / 255, 2.2);
      b += Math.pow(px[k + 2] / 255, 2.2);
    }
    const n = px.length / 64;
    mean.push([r / n, g / n, b / n]);
  });
  const tex = new DataArrayTexture(data, size, size, names.length);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = kind === 'diff' ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return { tex, mean };
}

const gltf = new GLTFLoader();
export async function loadModel(name: string): Promise<Group | null> {
  try {
    const r = await gltf.loadAsync(assetUrl(`assets/models/${name}.glb`));
    return r.scene;
  } catch {
    return null;
  }
}
