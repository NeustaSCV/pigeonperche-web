// Plans d'eau du décor : lac (grand quad) et rivière (ruban le long d'une polyligne), rides animées.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Engine } from '../core/engine';

export interface WaterSpec {
  /** niveau de l'eau du lac (m) ; la rivière ne descend jamais dessous */
  level: number;
  /** rectangle du lac : centre et dimensions (m) */
  lake?: { x: number; z: number; w: number; d: number } | null;
  /** rivière : points (x, z, altitude du lit) de terrain.meta.river, largeur du lit */
  river?: { points: [number, number, number][]; width: number } | null;
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
  for (let i = 0; i < rv.length; i++) {
    const a = rv[Math.max(0, i - 1)], b = rv[Math.min(rv.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const y = Math.max(rv[i][2] + 0.25, o.level + 0.02);
    pos.push(rv[i][0] - (dz / l) * w, y, rv[i][1] + (dx / l) * w, rv[i][0] + (dz / l) * w, y, rv[i][1] - (dx / l) * w);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (i < rv.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
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
