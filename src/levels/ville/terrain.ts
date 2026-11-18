// Ville nouvelle : relief propre à la carte (`Level.createTerrain`). Le relief commun du jeu est un maillage polaire
// centré sur le site de tir, avec herbe et roche ; ici c'est une grille au pas de 8 m sur toute la carte, drapée des
// dalles dessinées, et la carte est bombée. Seules l'altitude et la matière du sol changent : balles, télémètre,
// caméra et effets lisent ce relief par les mêmes méthodes que partout ailleurs.
import { Group, SRGBColorSpace, TextureLoader, type ShaderMaterial, type Texture } from 'three';
import { assetUrl, fetchBin } from '../../core/assets';
import type { Engine } from '../../core/engine';
import { Terrain } from '../../world/terrain';
import type { Wind } from '../../world/wind';
import { VilleWorld, readVille, tileImages } from './data';
import { buildGround, waterMat } from './ground';

let worldP: Promise<VilleWorld> | null = null;
/** La carte, lue une seule fois (relief et scène la partagent). */
export function loadWorld(): Promise<VilleWorld> {
  return (worldP ??= readVille((p) => fetch(assetUrl(p)).then((r) => r.json()), fetchBin).then((raw) => new VilleWorld(raw)));
}

const loadTexture = (path: string, anisotropy: number): Promise<Texture> =>
  new TextureLoader().loadAsync(assetUrl(path)).then((t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = anisotropy; return t; });

export class VilleTerrain extends Terrain {
  world!: VilleWorld;
  /** textures des dalles du sol (les toits des bâtiments y lisent leur teinte) et matière de l'eau */
  tiles: Texture[] = [];
  water!: ShaderMaterial;
  /** pièces d'une seule couleur du sol (murs de quai), que la scène fusionne avec son mobilier */
  extras = new Group();

  async load(): Promise<void> {
    const w = (this.world = await loadWorld());
    const r = w.raw.relief;
    let min = 1e9, max = -1e9;
    for (let i = 0; i < r.length; i++) { if (r[i] < min) min = r[i]; if (r[i] > max) max = r[i]; }
    // ni carte de matières ni route ni rivière : le relief commun n'en lit rien ici
    this.H = r;
    this.splat = new Uint8Array(0);
    this.meta = { res: w.N / w.meta.pas + 1, size: w.N, min, max, siteHeights: {}, road: [], river: [] };
  }

  heightAt(x: number, z: number): number {
    const w = this.world;
    return w.terrainY(x, z) + w.bendY(x, z);
  }
  meshHeightAt(x: number, z: number): number {
    return this.heightAt(x, z);
  }
  /** pas de roche : une balle au sol soulève de la poussière */
  splatAt(): number {
    return 0;
  }
  /** poussière de ville : gris chaud */
  dustColorAt(_x: number, _z: number, out: [number, number, number]): [number, number, number] {
    out[0] = 0.3; out[1] = 0.28; out[2] = 0.25;
    return out;
  }

  async build(engine: Engine, _wind: Wind): Promise<void> {
    const w = this.world;
    // textures vues de très loin et de biais : filtrage anisotrope au maximum, comme la page d'origine
    const aniso = engine.renderer.capabilities.getMaxAnisotropy();
    const [far, ...tiles] = await Promise.all(['ville/lointain.jpg', ...tileImages(w.NT)].map((p) => loadTexture(p, aniso)));
    this.tiles = tiles;
    this.water = waterMat(engine);
    this.group.add(buildGround(w, tiles, far, this.water, this.extras));
  }
}
