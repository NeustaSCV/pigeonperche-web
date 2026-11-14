// Matières des bâtiments de la banque, côté jeu : trois matières partagées par TOUS les bâtiments
// (opaque, transparente, lointaine) et deux tableaux de textures (petites et grandes) où sont rangées
// les textures dessinées au canvas par la banque. Un bâtiment complet = 1 à 2 appels de dessin.
import {
  DataArrayTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Material,
  type Texture,
} from 'three';

/** Ce que l'adaptateur attend du moteur du jeu (src/core/engine.ts) : l'enregistrement des ombres en cascade. */
export interface BuildingHost {
  setupMaterial<T extends Material>(mat: T, patch?: (shader: any) => void, key?: string): T;
  q?: { anisotropy?: number };
}
export interface BuildingConfig {
  /** côté d'une couche du tableau des petites textures (tuiles de mur de la banque : 128 à 256 px) */
  smallSize: number;
  /** côté d'une couche du tableau des grandes textures (atlas d'enseignes : 512 à 1024 px) ; 512 sur téléphone */
  largeSize: number;
  /** gain des surfaces émissives de la banque (écrans, néons, flammes) : le jeu est de jour */
  emissiveGain: number;
  /** teinte générale appliquée aux couleurs de la banque pour les accorder aux pierres du jeu */
  tint: [number, number, number];
  /**
   * Feuillage des arbres et buissons propres aux modèles (verts vifs dans la banque) : saturation gardée (0 à 1) et
   * teinte, pour les accorder à la végétation du jeu. La teinte est multipliée par la palette du niveau.
   */
  foliageSat: number;
  foliageTint: [number, number, number];
}
export const config: BuildingConfig = { smallSize: 256, largeSize: 1024, emissiveGain: 2.2, tint: [0.93, 0.9, 0.86], foliageSat: 0.55, foliageTint: [0.5, 0.56, 0.4] };

/** indice de couche à partir duquel on lit le tableau des grandes textures */
export const LARGE_BASE = 1000;
/** côté des vignettes qui donnent la couleur du détail lointain */
const TH = 32;

/** Un tableau de textures extensible : une couche par texture source de la banque. */
class LayerPool {
  tex: DataArrayTexture;
  count = 0;
  private cap: number;
  private data: Uint8Array<ArrayBuffer>;
  private index = new Map<string, number>();
  /** couleur moyenne linéaire (r, g, b) et opacité moyenne de chaque couche */
  means: [number, number, number, number][] = [];
  /** vignette 32 × 32 (RGBA, sRGB, ligne 0 en bas) de chaque couche, pour la couleur du détail lointain */
  thumbs: Uint8ClampedArray[] = [];

  constructor(public size: number, cap: number, private uniform: { value: Texture | null }, private anisotropy: number) {
    this.cap = cap;
    this.data = new Uint8Array(size * size * 4 * cap);
    this.tex = this.make();
  }

  private make(): DataArrayTexture {
    const t = new DataArrayTexture(this.data, this.size, this.size, this.cap);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = this.anisotropy;
    t.needsUpdate = true;
    this.uniform.value = t;
    return t;
  }

  /** Range une texture (une seule fois) et renvoie l'indice de sa couche. */
  add(src: Texture, scratch: CanvasRenderingContext2D, thumb: CanvasRenderingContext2D): number {
    const key = src.source.uuid;
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const s = this.size;
    if (this.count === this.cap) {
      const old = this.tex;
      const bigger = new Uint8Array(s * s * 4 * this.cap * 2);
      bigger.set(this.data);
      this.data = bigger;
      this.cap *= 2;
      this.tex = this.make();
      old.dispose();
    }
    const layer = this.count++;
    const img = src.image as CanvasImageSource;
    scratch.canvas.width = scratch.canvas.height = s;
    scratch.clearRect(0, 0, s, s);
    scratch.drawImage(img, 0, 0, s, s);
    const px = scratch.getImageData(0, 0, s, s).data;
    const row = s * 4;
    const base = layer * s * row;
    // les textures de canvas sont retournées à l'envoi (flipY) : la ligne 0 du tableau est le bas de l'image
    for (let y = 0; y < s; y++) {
      const from = (src.flipY ? s - 1 - y : y) * row;
      this.data.set(px.subarray(from, from + row), base + y * row);
    }
    // vignette et moyenne
    thumb.clearRect(0, 0, TH, TH);
    thumb.drawImage(img, 0, 0, TH, TH);
    const t = thumb.getImageData(0, 0, TH, TH).data;
    const tb = new Uint8ClampedArray(TH * TH * 4);
    for (let y = 0; y < TH; y++) {
      const from = (src.flipY ? TH - 1 - y : y) * TH * 4;
      tb.set(t.subarray(from, from + TH * 4), y * TH * 4);
    }
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < tb.length; i += 4) {
      const w = tb[i + 3] / 255;
      r += srgbToLinear(tb[i] / 255) * w;
      g += srgbToLinear(tb[i + 1] / 255) * w;
      b += srgbToLinear(tb[i + 2] / 255) * w;
      a += w;
    }
    const n = Math.max(a, 1e-3);
    this.means[layer] = [r / n, g / n, b / n, a / (TH * TH)];
    this.thumbs[layer] = tb;
    this.index.set(key, layer);
    this.tex.needsUpdate = true;
    return layer;
  }
}

export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Les matières partagées et les tableaux de textures. Créés par `configureBuildings`. */
export class BuildingMaterials {
  opaque: MeshStandardMaterial;
  alpha: MeshStandardMaterial;
  far: MeshStandardMaterial;
  private uSmall = { value: null as Texture | null };
  private uLarge = { value: null as Texture | null };
  private uGain = { value: config.emissiveGain };
  private small: LayerPool;
  private large: LayerPool;
  private scratch: CanvasRenderingContext2D;
  private thumb: CanvasRenderingContext2D;

  constructor(host: BuildingHost) {
    const an = host.q?.anisotropy ?? 4;
    this.small = new LayerPool(config.smallSize, 16, this.uSmall, an);
    this.large = new LayerPool(config.largeSize, 1, this.uLarge, an);
    const c1 = document.createElement('canvas');
    this.scratch = c1.getContext('2d', { willReadFrequently: true })!;
    const c2 = document.createElement('canvas');
    c2.width = c2.height = TH;
    this.thumb = c2.getContext('2d', { willReadFrequently: true })!;
    this.opaque = host.setupMaterial(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }), this.patch(true, false), 'bank');
    this.alpha = host.setupMaterial(
      new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: DoubleSide }),
      this.patch(true, true),
      'bankAlpha',
    );
    this.far = host.setupMaterial(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }), this.patch(false, false), 'bankFar');
  }

  /**
   * Vide les tableaux de textures. Les indices de couche sont écrits dans les géométries : à n'appeler qu'une fois
   * TOUS les bâtiments libérés (changement de carte).
   */
  reset(): void {
    const an = this.small.tex.anisotropy;
    this.small.tex.dispose();
    this.large.tex.dispose();
    this.small = new LayerPool(config.smallSize, 16, this.uSmall, an);
    this.large = new LayerPool(config.largeSize, 1, this.uLarge, an);
  }

  /** Range une texture de la banque ; renvoie l'indice de couche à écrire dans l'attribut `aUvl`. */
  layerOf(src: Texture): number {
    const img = src.image as { width?: number; height?: number } | null;
    if (!img || !img.width || !img.height) return -1;
    const big = Math.max(img.width, img.height) > this.small.size;
    const pool = big ? this.large : this.small;
    return pool.add(src, this.scratch, this.thumb) + (big ? LARGE_BASE : 0);
  }

  /**
   * Couleur (linéaire) et opacité moyennes d'une couche sur le rectangle UV [u0, u1] × [v0, v1] d'un triangle.
   * Un rectangle qui couvre plus d'une demi-texture (tuiles répétées) donne la moyenne de toute la couche.
   */
  sample(layer: number, u0: number, v0: number, u1: number, v1: number, out: [number, number, number, number]): void {
    const pool = layer >= LARGE_BASE ? this.large : this.small;
    const l = layer >= LARGE_BASE ? layer - LARGE_BASE : layer;
    if (u1 - u0 > 0.5 || v1 - v0 > 0.5) {
      const m = pool.means[l];
      out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = m[3];
      return;
    }
    const t = pool.thumbs[l];
    const x0 = Math.floor(u0 * TH), x1 = Math.max(x0, Math.ceil(u1 * TH) - 1);
    const y0 = Math.floor(v0 * TH), y1 = Math.max(y0, Math.ceil(v1 * TH) - 1);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = ((((y % TH) + TH) % TH) * TH + (((x % TH) + TH) % TH)) * 4;
        const w = t[k + 3] / 255;
        r += srgbToLinear(t[k] / 255) * w; g += srgbToLinear(t[k + 1] / 255) * w; b += srgbToLinear(t[k + 2] / 255) * w;
        a += w; n++;
      }
    const d = Math.max(a, 1e-3);
    out[0] = r / d; out[1] = g / d; out[2] = b / d; out[3] = a / Math.max(n, 1);
  }

  get layers(): { small: number; large: number } {
    return { small: this.small.count, large: this.large.count };
  }

  private patch(textured: boolean, transparent: boolean) {
    return (sh: any): void => {
      sh.uniforms.uBkGain = this.uGain;
      if (textured) {
        sh.uniforms.uBkSmall = this.uSmall;
        sh.uniforms.uBkLarge = this.uLarge;
      }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec4 aSurf;\nvarying vec3 vSurf;\n${textured ? 'attribute vec3 aUvl;\nvarying vec3 vUvl;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurf = aSurf.xyz;\n${textured ? 'vUvl = aUvl;' : ''}`);
      let f: string = sh.fragmentShader.replace(
        '#include <common>',
        `#include <common>\nuniform float uBkGain;\nvarying vec3 vSurf;\n${textured ? 'uniform highp sampler2DArray uBkSmall;\nuniform highp sampler2DArray uBkLarge;\nvarying vec3 vUvl;' : ''}`,
      );
      if (textured)
        f = f.replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          {
            vec2 bkDx = dFdx(vUvl.xy), bkDy = dFdy(vUvl.xy);
            if (vUvl.z > -0.5) {
              vec4 bk = vUvl.z < ${(LARGE_BASE - 0.5).toFixed(1)}
                ? textureGrad(uBkSmall, vec3(vUvl.xy, vUvl.z), bkDx, bkDy)
                : textureGrad(uBkLarge, vec3(vUvl.xy, vUvl.z - ${LARGE_BASE.toFixed(1)}), bkDx, bkDy);
              ${transparent ? 'diffuseColor *= bk;' : 'if (bk.a < 0.4) discard;\n              diffuseColor.rgb *= bk.rgb;'}
            }
          }`,
        );
      f = f
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = max(vSurf.x, 0.04);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uBkGain;');
      sh.fragmentShader = f;
    };
  }
}
