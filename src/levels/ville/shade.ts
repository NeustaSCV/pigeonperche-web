// Ville nouvelle : lumière des aplats et fusion des petits objets.
// Le sol, les façades et l'eau gardent leurs shaders d'origine, sans éclairage calculé : ils sortent une couleur
// linéaire multipliée par `uLight`, réglée pour s'accorder au soleil et au ciel du jeu sous son post-traitement.
// Le mobilier (perchoirs, grues, manège, arbres…) est en matière standard du jeu, éclairée par son soleil, sans ombre
// portée ; les pièces d'une seule couleur sont fusionnées en un maillage par groupe (`bake`).
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import type { Engine } from '../../core/engine';

/** soleil de la carte : au sud-est, à 38° de hauteur, comme les ombres déjà dessinées dans les dalles du sol */
export const SUN = new Vector3(0.55, 0.62, 0.56).normalize();
export const SUN_BEARING = (Math.atan2(SUN.x, -SUN.z) * 180) / Math.PI;
export const SUN_ELEVATION = (Math.asin(SUN.y) * 180) / Math.PI;

/** gain des aplats (RVB linéaire) : ce qu'une surface claire en plein soleil renvoie dans le rendu du jeu */
export const GAIN = 1.9;
export const uLight = { value: new Vector3(GAIN * 1.0, GAIN * 0.98, GAIN * 0.94) };

export const NOISE_GLSL = /* glsl */ `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`;

/** Matière sans éclairage (lointain, horizon) portée au niveau de lumière des aplats. */
export function basic(o: ConstructorParameters<typeof MeshBasicMaterial>[0] = {}): MeshBasicMaterial {
  const m = new MeshBasicMaterial(o);
  m.color.multiplyScalar(GAIN);
  return m;
}

/** part de lumière d'ambiance ajoutée au mobilier : la face à l'ombre d'un aplat garde 60 % de sa teinte, le mobilier doit suivre */
const FILL = 0.5;
/**
 * Matière standard du jeu, mate, sans ombre portée ni reçue, avec une lumière d'ambiance en plus (`FILL`) pour que
 * les faces à l'ombre s'accordent aux aplats voisins. `key` distingue les programmes (textures, côtés).
 */
export function lit(engine: Engine, o: ConstructorParameters<typeof MeshStandardMaterial>[0], key: string): MeshStandardMaterial {
  return engine.setupMaterial(new MeshStandardMaterial({ roughness: 0.95, metalness: 0, ...o }), (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse += diffuseColor.rgb * ${FILL.toFixed(2)};`);
  }, 'ville-' + key);
}

// ---------------------------------------------------------------- pièces d'une seule couleur, fusionnées
const flats = new Map<string, MeshBasicMaterial>();
/**
 * Marque « pièce d'une seule couleur » : matière provisoire, remplacée à la fusion (`bake`). `side: DoubleSide` pour
 * une pièce sans épaisseur.
 */
export function flat(color: number, o: { side?: typeof DoubleSide } = {}): Material {
  const k = color + (o.side ? 'd' : '');
  let m = flats.get(k);
  if (!m) { m = new MeshBasicMaterial(o.side ? { color, side: o.side } : { color }); m.userData.flat = true; flats.set(k, m); }
  return m;
}

/**
 * Fusionne les pièces d'une seule couleur de `root` (matières de `flat`) en un maillage (deux s'il y a des pièces
 * sans épaisseur), en repère monde ; les autres maillages (texturés, instanciés) sont gardés tels quels. Chaque pièce
 * descend de la courbure de la carte à l'endroit où elle est posée. Renvoie le groupe à ajouter à la scène.
 */
export function bake(engine: Engine, root: Object3D, bendY: (x: number, z: number) => number): Group {
  root.updateMatrixWorld(true);
  const out = new Group();
  const acc = [{ pos: [] as number[], nor: [] as number[], col: [] as number[] }, { pos: [] as number[], nor: [] as number[], col: [] as number[] }];
  const v = new Vector3(), c = new Color(), keep: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    let vis = true;
    for (let q: Object3D | null = m; q; q = q.parent) if (!q.visible) vis = false;
    if (!vis) return;
    const mat = m.material as Material;
    if (Array.isArray(m.material) || !mat.userData.flat || (m as unknown as InstancedMesh).isInstancedMesh) { keep.push(m); return; }
    const a = acc[mat.side === DoubleSide ? 1 : 0];
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), e = m.matrixWorld.elements;
    const dy = bendY(e[12], e[14]);
    c.copy((mat as MeshBasicMaterial).color);
    // matrice des normales : valable ici, les pièces n'ont que des échelles positives
    const nm = m.normalMatrix.getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      a.pos.push(v.x, v.y + dy, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      a.nor.push(v.x, v.y, v.z);
      a.col.push(c.r, c.g, c.b);
    }
    if (g !== m.geometry) g.dispose();
  });
  acc.forEach((a, i) => {
    if (!a.pos.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(a.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(a.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(a.col), 3));
    g.computeBoundingSphere();
    const mesh = new Mesh(g, i ? lit(engine, { vertexColors: true, side: DoubleSide }, 'plat2') : lit(engine, { vertexColors: true }, 'plat'));
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  });
  for (const m of keep) {
    // maillage gardé : posé en repère monde, descendu de la courbure à son origine
    const e = m.matrixWorld.elements;
    m.matrix.copy(m.matrixWorld);
    m.matrix.elements[13] += bendY(e[12], e[14]);
    m.matrixAutoUpdate = false;
    out.add(m);
  }
  out.updateMatrixWorld(true);
  return out;
}
