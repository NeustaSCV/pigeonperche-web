// Fanions : mâts et drapeaux instanciés qui s'orientent et claquent selon le vent local (indices de dérive).
import { Color, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry } from 'three';
import { GeoBuilder } from '../core/builder';
import type { Engine } from '../core/engine';
import { WIND_GLSL, type Wind } from './wind';

/** Fanions : [x, y du pied, z, hauteur du mât, couleur]. Ils s'orientent et claquent selon le vent local. */
export function buildFlags(engine: Engine, wind: Wind, group: Group, list: number[][]): InstancedMesh {
  const poleMat = engine.setupMaterial(new MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.6 }), undefined, 'pole');
  const pg = new GeoBuilder();
  for (const [x, y, z, h] of list) pg.box(x, y + h / 2, z, 0.05, h, 0.05);
  group.add(new Mesh(pg.build(), poleMat));
  const geo = new PlaneGeometry(1, 1, 10, 3);
  geo.translate(0.5, 0, 0);
  const mat = engine.setupMaterial(
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: DoubleSide }),
    (sh) => {
      Object.assign(sh.uniforms, wind.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}`).replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec3 fo = vec3(instanceMatrix[3]);
        float fs = length(instanceMatrix[0].xyz);
        float g = windGust(fo.xz);
        float sp = uWindSpeed * (0.5 + g) * (0.62 + 0.38 * clamp(fo.y / 200.0, 0.0, 1.0));
        float lift = clamp(sp / 7.0, 0.0, 1.0);
        float u = position.x;
        float wave = sin(u * 7.0 - uWindTime * (3.0 + sp * 1.4) + fo.x) * 0.09 * u * (0.3 + lift);
        vec2 wd = uWindDir;
        vec3 wp = fo;
        wp.xz += wd * u * fs * (0.25 + 0.75 * lift) + vec2(-wd.y, wd.x) * wave * fs;
        wp.y += position.y * fs * 0.6 - u * fs * (1.0 - lift) * 0.85 + wave * 0.4 * fs;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      );
    },
    'flag',
  );
  const im = new InstancedMesh(geo, mat, list.length);
  // étoffe qui flotte au vent : ni balle ni télémètre ne s'y arrêtent (le mât, lui, est solide)
  im.userData.soft = true;
  const d = new Object3D();
  const c = new Color();
  list.forEach(([x, y, z, h, color], i) => {
    d.position.set(x, y + h - 0.35, z);
    d.scale.setScalar(h > 4 ? 1.5 : 0.9);
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
    im.setColorAt(i, c.set(color));
  });
  im.frustumCulled = false;
  im.castShadow = false;
  group.add(im);
  return im;
}
