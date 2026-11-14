// Plans d'eau du décor : lac (grand quad) et rivière (ruban le long d'une polyligne), rides animées.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Engine } from '../core/engine';

export interface WaterSpec {
  /** niveau de l'eau du lac (m) ; la rivière ne descend jamais dessous */
  level: number;
  /** rectangle du lac : centre et dimensions (m) */
  lake?: { x: number; z: number; w: number; d: number } | null;
  /** rivière : points (x, z, altitude du lit) de terrain.meta.river, largeur du lit */
  river?: {
    points: [number, number, number][];
    width: number;
    /**
     * Rivière lointaine : altitude du maillage dessiné du relief (`terrain.meshHeightAt`). Le ruban est alors
     * finement découpé et posé sur le relief là où ses grandes mailles passent au-dessus de l'eau — sans cela, à
     * plus de 500 m du site, le lit (plus étroit qu'une maille) n'apparaît que par plaques.
     */
    drape?: (x: number, z: number) => number;
    /** hauteur du ruban drapé au-dessus du maillage (défaut 0,45 m) */
    lift?: number;
  } | null;
}

export function buildWater(engine: Engine, group: Group, o: WaterSpec): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: 0x1d3a3f, roughness: 0.07, metalness: 0.0, envMapIntensity: 1.5 });
  engine.setupMaterial(
    mat,
    (sh) => {
      sh.uniforms.tNoise = { value: engine.noiseTex };
      sh.uniforms.uTimeW = engine.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise;\nuniform float uTimeW;\nvarying vec3 vWP;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          {
            vec2 p = vWP.xz;
            float t = uTimeW;
            // rides : deux couches de bruit qui glissent, dérivées par différences finies
            float e = 0.6;
            #define WH(q) (texture2D(tNoise, (q) * 0.021 + vec2(t * 0.011, t * 0.007)).r + 0.5 * texture2D(tNoise, (q) * 0.083 - vec2(t * 0.019, -t * 0.013)).g + 0.25 * texture2D(tNoise, (q) * 0.31 + vec2(-t * 0.03, t * 0.021)).b)
            float h0 = WH(p), hx = WH(p + vec2(e, 0.0)), hz = WH(p + vec2(0.0, e));
            vec3 nw = normalize(vec3((h0 - hx) * 0.55, 1.0, (h0 - hz) * 0.55));
            normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
          }`,
        );
    },
    'water',
  );
  // lac : grand quad
  if (o.lake) {
    const lake = new Mesh(new PlaneGeometry(o.lake.w, o.lake.d, 1, 1), mat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(o.lake.x, o.level, o.lake.z);
    lake.receiveShadow = true;
    group.add(lake);
  }
  // rivière : ruban
  const rv = o.river?.points ?? [];
  if (rv.length < 2) return mat;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const w = o.river!.width / 2 + 2.5;
  const drape = o.river!.drape;
  if (!drape) {
    for (let i = 0; i < rv.length; i++) {
      const a = rv[Math.max(0, i - 1)], b = rv[Math.min(rv.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const y = Math.max(rv[i][2] + 0.25, o.level + 0.02);
      pos.push(rv[i][0] - (dz / l) * w, y, rv[i][1] + (dx / l) * w, rv[i][0] + (dz / l) * w, y, rv[i][1] - (dx / l) * w);
      nrm.push(0, 1, 0, 0, 1, 0);
      if (i < rv.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
  } else {
    // ruban drapé : rééchantillonné tous les ~6 m dans les deux sens, chaque sommet au niveau de l'eau ou, si le
    // maillage dessiné du relief passe au-dessus (mailles de 10 à 45 m loin du site), posé juste sur lui
    const STEP = 6, lift = o.river!.lift ?? 0.45;
    const across = Math.max(2, Math.ceil((2 * w) / STEP));
    const line: [number, number, number][] = [];
    for (let i = 0; i < rv.length - 1; i++) {
      const a = rv[i], b = rv[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
      for (let k = 0; k < n; k++) { const t = k / n; line.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    }
    line.push(rv[rv.length - 1]);
    const cols = across + 1;
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 2)], b = line[Math.min(line.length - 1, i + 2)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const level = Math.max(line[i][2] + 0.25, o.level + 0.02);
      for (let c = 0; c < cols; c++) {
        const u = (c / across) * 2 - 1;
        const x = line[i][0] - (dz / l) * w * u, z = line[i][1] + (dx / l) * w * u;
        // les bords du ruban restent au niveau de l'eau : c'est le relief qui dessine la berge
        const y = Math.abs(u) > 0.99 ? level : Math.max(level, drape(x, z) + lift);
        pos.push(x, y, z);
        nrm.push(0, 1, 0);
        if (i < line.length - 1 && c < across) {
          const p = i * cols + c;
          idx.push(p, p + 1, p + cols, p + 1, p + cols + 1, p + cols);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  const river = new Mesh(g, mat);
  river.receiveShadow = true;
  group.add(river);
  return mat;
}
