// Banc d'essai des bâtiments : le VRAI moteur du jeu (ombres en cascade, ciel HDRI, atmosphère, tons, lunette) sur un
// sol nu, un bâtiment à la fois. Piloté par e2e/buildings.mjs ; utilisable à la main :
//   /src/buildings/bench.html?b=eglise&carte=&vue=proche|lunette|oeil&lod=full|far&q=medium
import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { Engine, type QualityName } from '../core/engine';
import { Sky } from '../world/sky';
import { Colliders } from '../world/colliders';
import { PROBES } from './poi';
import {
  CATALOG, SELECTION, configureBuildings, disposeBuilding, flattenArea, loadBuilding, placeBuilding, pointsOfInterest,
  registerBuildingColliders, setBuildingLod, textureLayers, updateBuildingLod,
  type Building, type BuildingId, type BuildingLod, type PlacedBuilding,
} from './index';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLElement;
const engine = new Engine(canvas, (params.get('q') as QualityName) || 'medium');
engine.dynamicRes = false;
const sky = new Sky();
const GROUND_Y = 40;

let current: Building | null = null;
let placed: PlacedBuilding | null = null;
let ground: Mesh;

type ViewName = 'proche' | 'lunette' | 'oeil';
const view = { name: 'proche' as ViewName, mag: 12, dist: 800 };

function frames(n: number): void {
  for (let i = 0; i < n; i++) engine.render(1 / 60, 16);
}

function applyView(name: ViewName, mag = 12, dist = 800): void {
  view.name = name; view.mag = mag; view.dist = dist;
  const cam = engine.camera;
  const b = current;
  const c = new Vector3(0, GROUND_Y + 6, 0);
  let r = 40;
  if (b) {
    b.bounds.getCenter(c);
    c.y = GROUND_Y + Math.min(b.bounds.max.y, 30) * 0.45;
    r = Math.max(b.footprint.built.hx, b.footprint.built.hz, b.bounds.max.y * 0.8);
  }
  // le soleil est à l'ouest-sud-ouest : on regarde depuis le sud-ouest, faces éclairées visibles
  const az = (Number(params.get('az') ?? 205) * Math.PI) / 180;
  const dir = new Vector3(Math.sin(az), 0, -Math.cos(az));
  const scope = name === 'lunette';
  if (name === 'proche') {
    const d = r * 1.9 + 14;
    cam.position.copy(c).addScaledVector(dir, d).add(new Vector3(0, d * 0.28, 0));
    cam.fov = engine.view.baseFov;
  } else {
    // tireur 110 m plus haut que la cible, comme depuis la ruine
    cam.position.copy(c).addScaledVector(dir, dist).add(new Vector3(0, 110, 0));
    cam.fov = scope ? engine.scopeFov(mag) : engine.view.baseFov;
  }
  cam.up.set(0, 1, 0);
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  engine.setScopeChain(scope);
  engine.finish.u('uScopeF').value = scope ? 1 : 0;
  engine.lens.u('uCA').value = scope ? 0.006 : 0.0012;
  engine.lens.u('uMirage').value = scope ? 0.0011 * Math.min(1, dist / 900) * Math.min(1.4, mag / 16) : 0;
  engine.shadowFocus = scope ? dist : 0;
  sky.follow(cam.position);
}

async function show(id: BuildingId, carte?: string, usure?: number): Promise<Record<string, unknown>> {
  if (current) { disposeBuilding(current); current = null; }
  const t0 = performance.now();
  const b = await loadBuilding(id, { carte: carte || undefined, usure });
  const ms = performance.now() - t0;
  current = b;
  placed = placeBuilding(b, { x: 0, z: 0, yaw: 0, groundY: GROUND_Y });
  // le sol du banc descend sous les modèles creusés
  ground.position.y = GROUND_Y - 0.02 - (b.footprint.ownGround && b.footprint.dug > 0 ? b.footprint.dug + 0.3 : 0);
  engine.scene.add(b.group);
  applyView(view.name, view.mag, view.dist);
  frames(6);
  return {
    id, carte: b.carte, loadMs: Math.round(ms), timings: b.timings, full: b.statsByLod.full, far: b.statsByLod.far, source: b.source,
    collision: Object.fromEntries(b.collision.map((p) => [p.tag, p.triangles])),
    bounds: [b.bounds.min.toArray().map((v) => +v.toFixed(1)), b.bounds.max.toArray().map((v) => +v.toFixed(1))],
    footprint: b.footprint, openings: b.openings.length, obstacles: b.obstacles.length, layers: textureLayers(),
  };
}

/** Coût réel dans le moteur : appels et triangles de l'image avec le bâtiment, moins la même image sans lui (ombres comprises). */
function measure(lod: BuildingLod): { calls: number; tris: number } {
  const b = current!;
  setBuildingLod(b, lod);
  frames(8);
  const withB = { ...engine.stats };
  b.group.visible = false;
  frames(8);
  const without = { ...engine.stats };
  b.group.visible = true;
  frames(2);
  return { calls: withB.calls - without.calls, tris: withB.tris - without.tris };
}

/** Temps d'une image (ms), moyenne de n rendus enchaînés terminés par une lecture de pixel (force le GPU à finir). */
function timeFrames(n = 40): number {
  const gl = engine.renderer.getContext();
  const px = new Uint8Array(4);
  frames(3);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  frames(n);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t0) / n;
}

/**
 * Essai balistique avec les collisions du jeu : pour chaque ouverture relevée donnant dehors, un tir de l'extérieur
 * vers l'intérieur doit passer ; le même tir décalé sur le mur d'à côté doit être arrêté.
 */
function probe(): Record<string, unknown> {
  const b = current!, p = placed!;
  const col = new Colliders();
  const n = registerBuildingColliders(p, col, { walkSegments: true });
  const t0 = performance.now();
  col.build();
  const bvhMs = performance.now() - t0;
  const set = pointsOfInterest(b);
  let through = 0, tried = 0, masked = 0, plugged = 0, stopped = 0, walls = 0, mismatch = 0;
  const a = new Vector3(), e = new Vector3(), hit = new Vector3();
  const pluggedAt: string[] = [];
  for (const o of set.points) {
    if (o.kind !== 'window' && o.kind !== 'opening' && o.kind !== 'door') continue;
    if (o.source !== 'auto') continue;
    tried++;
    // mêmes cinq tirs que poi.ts, mais avec les collisions du jeu et le bâtiment posé dans le monde
    let pass = 0, far = false;
    for (const [fu, fv] of PROBES) {
      const ox = o.x - o.nz * fu * o.width, oy = o.y + fv * o.height, oz = o.z + o.nx * fu * o.width;
      a.set(ox + o.nx * 20, oy, oz + o.nz * 20).applyMatrix4(p.matrix);
      e.set(ox - o.nx * 0.6, oy, oz - o.nz * 0.6).applyMatrix4(p.matrix);
      const d = col.segment(a, e, hit);
      if (d < 0) pass++;
      else if (d < 17) far = true; // un arbre, une clôture, une autre aile entre le tireur et l'ouverture
    }
    if (pass) through++;
    else if (far) masked++;
    else { plugged++; if (pluggedAt.length < 6) pluggedAt.push(`${o.kind} (${o.x.toFixed(1)}, ${o.y.toFixed(1)}, ${o.z.toFixed(1)}) ${o.width.toFixed(1)}x${o.height.toFixed(1)} m`); }
    if ((o.clear ?? 0) > 0 !== pass > 0 && !far) mismatch++;
  }
  // les murs : chaque segment plein relevé par la banque (mur à hauteur d'homme) doit arrêter un tir qui le croise à 1 m du sol
  for (const ob of b.obstacles) {
    if (ob.nature !== 'mur') continue;
    const dx = ob.x2 - ob.x1, dz = ob.z2 - ob.z1, len = Math.hypot(dx, dz);
    if (len < 0.8) continue;
    const mx = (ob.x1 + ob.x2) / 2, mz = (ob.z1 + ob.z2) / 2, nx = -dz / len, nz = dx / len;
    a.set(mx + nx * 1.2, 1.05, mz + nz * 1.2).applyMatrix4(p.matrix);
    e.set(mx - nx * 1.2, 1.05, mz - nz * 1.2).applyMatrix4(p.matrix);
    walls++;
    if (col.segment(a, e) >= 0) stopped++;
  }
  const kinds: Record<string, number> = {};
  for (const o of set.points) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  return { triangles: n, bvhMs: Math.round(bvhMs), segs: col.segs.length, openings: tried, through, masked, plugged, mismatch, pluggedAt, walls, stopped, poi: kinds, faces: set.faces.map((f) => `${f.side}:${f.score}(${Math.round(f.width)}x${Math.round(f.height)} m, ${Math.round(f.fill * 100)} %, ${f.openings} ouv.)`) };
}

/**
 * Stabilité de l'image sous un déplacement de caméra d'un quart de pixel (scintillement des détails plus fins que le
 * pixel) : écart moyen (0 à 255) entre deux images du carré central, rapporté à l'écart entre deux images sans
 * déplacement (grain du film, brume). 1 = aussi stable qu'une image fixe.
 */
function stability(lod: BuildingLod): { noise: number; shift: number; ratio: number } {
  const b = current!;
  setBuildingLod(b, lod);
  const gl = engine.renderer.getContext();
  const S = 384;
  const x0 = Math.max(0, Math.floor(gl.drawingBufferWidth / 2 - S / 2)), y0 = Math.max(0, Math.floor(gl.drawingBufferHeight / 2 - S / 2));
  const grab = (): Uint8Array => { frames(1); const px = new Uint8Array(S * S * 4); gl.readPixels(x0, y0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const diff = (p: Uint8Array, q: Uint8Array): number => { let d = 0; for (let i = 0; i < p.length; i += 4) d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); return d / (S * S * 3); };
  frames(8);
  const cam = engine.camera;
  const dist = cam.position.distanceTo(new Vector3(0, GROUND_Y, 0));
  const pxSize = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / gl.drawingBufferHeight;
  const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  let noise = 0, shift = 0;
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = grab(), a2 = grab();
    cam.position.addScaledVector(right, pxSize * 0.25);
    cam.updateMatrixWorld();
    const c = grab();
    noise += diff(a, a2);
    shift += diff(a2, c);
  }
  cam.position.addScaledVector(right, -pxSize * 0.25 * N);
  cam.updateMatrixWorld();
  return { noise: +(noise / N).toFixed(3), shift: +(shift / N).toFixed(3), ratio: +(shift / Math.max(noise, 1e-6)).toFixed(2) };
}

/** Résumé des points d'intérêt (pour le tableau et la sélection). */
function poiSummary(): Record<string, unknown> {
  const set = pointsOfInterest(current!);
  const r1 = (v: number): number => +v.toFixed(1);
  const ops = set.points.filter((p) => p.kind === 'window' || p.kind === 'opening' || p.kind === 'breach' || (p.kind === 'door' && p.source === 'auto'));
  return {
    openings: ops.length,
    open: ops.filter((p) => (p.clear ?? 0) > 0).length,
    posts: ops.filter((p) => p.stand).length,
    highestPost: set.points.filter((p) => p.stand && p.kind !== 'roof' && p.kind !== 'ground').reduce((m, p) => Math.max(m, p.stand!.y), 0),
    roofs: set.points.filter((p) => p.kind === 'roof').map((p) => ({ x: r1(p.x), y: r1(p.y), z: r1(p.z), area: p.area })),
    galleries: set.points.filter((p) => p.kind === 'gallery').map((p) => ({ x: r1(p.x), y: r1(p.y), z: r1(p.z), area: p.area, nx: r1(p.nx), nz: r1(p.nz) })),
    summit: set.points.filter((p) => p.kind === 'summit').map((p) => ({ x: r1(p.x), y: r1(p.y), z: r1(p.z) }))[0] ?? null,
    ground: set.points.filter((p) => p.source === 'fiche').length,
    faces: set.faces.map((f) => ({ side: f.side, w: Math.round(f.width), h: Math.round(f.height), fill: +f.fill.toFixed(2), openings: f.openings, score: f.score })),
  };
}

async function init(): Promise<void> {
  engine.initShadows(new Vector3(-0.8, 0.25, 0.3).normalize());
  await sky.load(engine);
  engine.initPost(sky.lut);
  sky.update(0, true);
  engine.scene.add(sky.dome);
  configureBuildings(engine, params.has('tex') ? { largeSize: Number(params.get('tex')) } : {});
  // sol nu : herbe sèche de la vallée
  const gm = engine.setupMaterial(new MeshStandardMaterial({ color: 0x5d6638, roughness: 1 }), undefined, 'benchGround');
  ground = new Mesh(new PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), gm);
  ground.receiveShadow = true;
  ground.position.y = GROUND_Y - 0.04;
  engine.scene.add(ground);
  engine.resize();
  applyView('proche');
  frames(4);
  const api = {
    ready: true, engine, CATALOG, SELECTION, show, measure, probe, frames, timeFrames, stability, poiSummary,
    view: (n: ViewName, mag?: number, dist?: number) => { applyView(n, mag, dist); frames(8); },
    lod: (l: BuildingLod | 'auto') => {
      if (!current) return '';
      if (l === 'auto') updateBuildingLod(current, engine.camera.position, engine.zoomK());
      else setBuildingLod(current, l);
      frames(8);
      return current.lod;
    },
    poi: () => (current ? pointsOfInterest(current) : null),
    flat: () => (placed ? flattenArea(placed) : null),
    get building() { return current; },
  };
  (window as any).bench = api;
  const id = params.get('b') as BuildingId | null;
  if (id) {
    view.name = (params.get('vue') as ViewName) || 'proche';
    const r = await show(id, params.get('carte') || undefined, params.has('usure') ? Number(params.get('usure')) : undefined);
    if (params.get('lod') === 'far') api.lod('far');
    info.textContent = JSON.stringify(r, null, 1);
    // à la main : rendu continu
    const loop = (): void => { engine.render(1 / 60, 16); requestAnimationFrame(loop); };
    loop();
  }
}
window.addEventListener('resize', () => engine.resize());
init().catch((e) => {
  console.error(e);
  (window as any).bench = { ready: false, error: String(e?.stack || e) };
  info.textContent = String(e?.stack || e);
});
