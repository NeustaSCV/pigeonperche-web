// Build optimised GLBs from Poly Haven glTF sources. Run: node .tmp/scripts/build-models.mjs [name ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weldPrimitive, simplifyPrimitive, prune, dedup, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, '.tmp/assets-src/models');
const OUT = path.join(ROOT, 'public/assets/models');

// budget: total triangles. foliage: {re, budget, maxScale}. keep: node-name regex.
const JOBS = {
  rock_a: { id: 'rock_moss_set_02', budget: 4000 },
  rock_b: { id: 'rock_moss_set_01', budget: 4000 },
  rock_c: { id: 'boulder_01', budget: 4000 },
  rock_d: { id: 'namaqualand_boulder_05', budget: 4000 },
  deadwood: { id: 'dead_tree_trunk', budget: 6000 },
  shrub: { id: 'fern_02', budget: 3940, alpha: { fern_02: 'fern_02_alpha_1k.png' } },
  clump: { id: 'grass_medium_02', keep: /^grass_medium_02_[ac]$/, keepLayout: true, budget: 2000, alpha: { grass_medium_02: 'grass_medium_02_alpha_1k.png' } },
  conifer: {
    id: 'fir_tree_01', keep: /^fir_tree_01_b_LOD0$/, budget: 30000,
    foliage: { re: /twig/, budget: 20200 }, cards: 'conifer',
    solid: { fir_tree_01_trunk_b: 2200, fir_tree_01_bark: 6400, fir_tree_01_dead_branches: 1000 },
  },
  conifer_b: {
    id: 'pine_sapling_medium', keep: /^pine_sapling_medium_a_LOD0$/, budget: 30000,
    foliage: { re: /twig/, budget: 22800 }, cards: 'conifer_b',
    solid: { pine_sapling_medium_bark: 6200, pine_sapling_medium_dead_branches: 900 },
  },
  broadleaf: {
    id: 'tree_small_02', budget: 30000,
    foliage: { re: /leaves/, budget: 20800 }, cards: 'broadleaf',
    solid: { tree_small_02_trunk: 2400, tree_small_02_branches: 6600 },
  },
};

const triCount = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Connected components of a primitive (vertices welded by position). */
function components(prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const nv = pos.length / 3;
  const canon = new Uint32Array(nv);
  const map = new Map();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(pos[3 * i] * 2e4)},${Math.round(pos[3 * i + 1] * 2e4)},${Math.round(pos[3 * i + 2] * 2e4)}`;
    const j = map.get(k);
    if (j === undefined) { map.set(k, i); canon[i] = i; } else canon[i] = j;
  }
  map.clear();
  const parent = new Uint32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(canon[idx[t]]), b = find(canon[idx[t + 1]]), c = find(canon[idx[t + 2]]);
    if (a !== b) parent[b] = a; const a2 = find(a); if (a2 !== c) parent[find(c)] = a2;
  }
  const compOfTri = new Uint32Array(idx.length / 3);
  const ids = new Map(); const comps = [];
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(canon[idx[t]]);
    let c = ids.get(r); if (c === undefined) { c = comps.length; ids.set(r, c); comps.push({ tris: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], sum: [0, 0, 0], n: 0 }); }
    compOfTri[t / 3] = c; const C = comps[c]; C.tris++;
    for (let k = 0; k < 3; k++) { const v = idx[t + k]; for (let d = 0; d < 3; d++) { const x = pos[3 * v + d]; if (x < C.min[d]) C.min[d] = x; if (x > C.max[d]) C.max[d] = x; C.sum[d] += x; } C.n++; }
  }
  return { comps, compOfTri };
}

/** Foliage-card LOD: keep a random subset of whole cards and enlarge the survivors about their centroid. */
function cullCards(doc, prim, budget, log, opts = {}) {
  const { comps, compOfTri } = components(prim);
  const total = triCount(prim);
  const sizes = comps.map((c) => Math.hypot(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2])).sort((a, b) => a - b);
  const trisS = comps.map((c) => c.tris).sort((a, b) => a - b);
  log(`    foliage: ${total} tris in ${comps.length} cards; tris/card median ${trisS[trisS.length >> 1]} (max ${trisS[trisS.length - 1]}); card diag median ${sizes[sizes.length >> 1].toFixed(3)} m, p90 ${sizes[Math.floor(sizes.length * 0.9)].toFixed(3)} m`);
  if (total <= budget) return { cards: comps.length, kept: comps.length, scale: 1 };
  const frac = budget / total;
  const rnd = mulberry32(1234);
  const keep = new Uint8Array(comps.length); let keptTris = 0, kept = 0;
  // stratified by height (y) so that the crown keeps its distribution
  const order = comps.map((c, i) => i).sort((a, b) => comps[a].sum[1] / comps[a].n - comps[b].sum[1] / comps[b].n);
  let acc = rnd();
  for (const i of order) { acc += frac; if (acc >= 1) { acc -= 1; keep[i] = 1; keptTris += comps[i].tris; kept++; } }
  const scale = Math.min(opts.maxScale ?? 3.2, Math.sqrt(1 / frac) * (opts.cover ?? 0.6));
  // rebuild compacted attribute arrays
  const idx = prim.getIndices().getArray();
  const nv = prim.getAttribute('POSITION').getCount();
  const remap = new Int32Array(nv).fill(-1); const compOfVert = new Uint32Array(nv); let nn = 0; const newIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const c = compOfTri[t / 3]; if (!keep[c]) continue;
    for (let k = 0; k < 3; k++) { const v = idx[t + k]; if (remap[v] < 0) { remap[v] = nn++; compOfVert[v] = c; } newIdx.push(remap[v]); }
  }
  for (const sem of prim.listSemantics()) {
    const acc0 = prim.getAttribute(sem); const es = acc0.getElementSize(); const src = acc0.getArray();
    const dst = new src.constructor(nn * es);
    for (let v = 0; v < nv; v++) { const r = remap[v]; if (r < 0) continue; for (let d = 0; d < es; d++) dst[r * es + d] = src[v * es + d]; }
    if (sem === 'POSITION') {
      for (let v = 0; v < nv; v++) { const r = remap[v]; if (r < 0) continue; const C = comps[compOfVert[v]];
        for (let d = 0; d < 3; d++) { const cen = C.sum[d] / C.n; dst[r * 3 + d] = cen + (dst[r * 3 + d] - cen) * scale; } }
    }
    const na = doc.createAccessor().setType(acc0.getType()).setArray(dst).setNormalized(acc0.getNormalized()).setBuffer(acc0.getBuffer());
    prim.setAttribute(sem, na);
  }
  const ia = nn > 65535 ? new Uint32Array(newIdx) : new Uint16Array(newIdx);
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ia).setBuffer(prim.getIndices().getBuffer()));
  log(`    foliage: kept ${kept}/${comps.length} cards (${keptTris} tris), each scaled x${scale.toFixed(2)} about its centroid`);
  return { cards: comps.length, kept, scale };
}

function simplifyTo(prim, target, log) {
  const before = triCount(prim);
  if (before <= target) return;
  weldPrimitive(prim, {});
  for (const error of [0.002, 0.006, 0.015, 0.04, 0.1, 0.3]) {
    const cur = triCount(prim); if (cur <= target * 1.03) break;
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: target / cur, error, lockBorder: false });
  }
  if (triCount(prim) > target * 1.1) {
    // split normals / fragmented charts block collapses: drop normals, weld by position+uv, simplify, rebuild smooth normals
    prim.setAttribute('NORMAL', null);
    weldPrimitive(prim, {});
    for (const error of [0.01, 0.04, 0.1, 0.3, 1]) {
      const cur = triCount(prim); if (cur <= target * 1.03) break;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: target / cur, error, lockBorder: false });
    }
    const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray();
    const nor = new Float32Array(pos.length);
    // accumulate area-weighted face normals per welded position so UV seams stay smooth
    const key = (v) => `${pos[3 * v]},${pos[3 * v + 1]},${pos[3 * v + 2]}`; const accN = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
      const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (const v of [a, b, c]) { const k = key(v); let e = accN.get(k); if (!e) accN.set(k, (e = [0, 0, 0])); e[0] += n[0]; e[1] += n[1]; e[2] += n[2]; }
    }
    for (let v = 0; v < pos.length / 3; v++) { let e = accN.get(key(v)) ?? [0, 1, 0]; let l = Math.hypot(...e); if (!(l > 1e-20)) { e = [0, 1, 0]; l = 1; } nor[3 * v] = e[0] / l; nor[3 * v + 1] = e[1] / l; nor[3 * v + 2] = e[2] / l; }
    prim.setAttribute('NORMAL', prim.getAttribute('POSITION').clone().setArray(nor));
    log(`    (normals rebuilt after position weld)`);
  }
  log(`    simplify ${before} -> ${triCount(prim)} (target ${target})`);
}

async function build(name, job) {
  const lines = []; const log = (s) => { lines.push(s); console.log(s); };
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const dir = path.join(SRC, job.id);
  const doc = await io.read(path.join(dir, `${job.id}.gltf`));
  const root = doc.getRoot();
  log(`== ${name}  <- ${job.id}`);
  // 1. select nodes
  if (job.keep) for (const n of root.listNodes()) { if (n.getMesh() && !job.keep.test(n.getName())) n.dispose(); else if (n.getMesh() && !job.keepLayout) n.setTranslation([0, 0, 0]); }
  await doc.transform(prune({ keepAttributes: true, keepLeaves: false }));
  const prims = () => root.listMeshes().flatMap((m) => m.listPrimitives());
  const origTris = prims().reduce((s, p) => s + triCount(p), 0);
  const origPer = prims().map((p) => `${p.getMaterial().getName()}=${triCount(p)}`);
  // 2. strip vertex colours (wind/variation masks in Poly Haven assets; would tint baseColor in three.js) and PBR extras
  const stripped = new Set();
  for (const p of prims()) for (const sem of p.listSemantics()) if (/^COLOR_/.test(sem)) { p.setAttribute(sem, null); stripped.add(sem); }
  for (const ext of root.listExtensionsUsed()) if (/KHR_materials_(specular|ior)/.test(ext.extensionName)) { stripped.add(ext.extensionName); ext.dispose(); }
  if (stripped.size) log(`    stripped: ${[...stripped].join(', ')}`);
  // 3. geometry
  const all = prims();
  const isFol = (p) => job.foliage && job.foliage.re.test(p.getMaterial().getName());
  const solidTotal = all.filter((p) => !isFol(p)).reduce((s, p) => s + triCount(p), 0);
  const solidBudget = job.budget - (job.foliage ? job.foliage.budget : 0);
  let fol = null;
  for (const p of all) {
    const mname = p.getMaterial().getName();
    if (isFol(p) && job.cards) {
      // replace needle/leaf-level geometry by baked branch cards (see bake_cards.py)
      const pre = path.join(ROOT, '.tmp/assets-src/cards', job.cards);
      const rd = (suf, T) => { const b = fs.readFileSync(pre + suf); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
      const meta = JSON.parse(fs.readFileSync(pre + '_meta.json', 'utf8'));
      const buf = root.listBuffers()[0];
      for (const sem of p.listSemantics()) p.setAttribute(sem, null);
      p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(rd('_pos.f32', Float32Array)).setBuffer(buf));
      p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(rd('_nor.f32', Float32Array)).setBuffer(buf));
      p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(rd('_uv.f32', Float32Array)).setBuffer(buf));
      const ix = rd('_idx.u32', Uint32Array);
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(meta.verts > 65535 ? ix : new Uint16Array(ix)).setBuffer(buf));
      const mat = p.getMaterial();
      const tex = doc.createTexture(`${mname}_cards`).setImage(fs.readFileSync(pre + '_atlas.png')).setMimeType('image/png').setURI(`${mname}_cards_atlas.png`);
      mat.setBaseColorTexture(tex).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null)
        .setRoughnessFactor(0.85).setMetallicFactor(0).setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true);
      fol = { method: 'baked branch cards', ...meta };
      log(`    foliage: ${meta.srcTris} tris baked into ${meta.cells} cells x 2 crossed quads = ${meta.tris} tris (voxel ${meta.voxel.toFixed(2)} m, ${meta.exemplars} exemplars x 2 views in a 1024 px RGBA atlas)`);
    } else if (isFol(p)) fol = cullCards(doc, p, job.foliage.budget, log, job.foliage);
    else {
      const target = job.solid?.[mname] ?? Math.floor((triCount(p) / solidTotal) * solidBudget);
      simplifyTo(p, target, log);
    }
  }
  // 4. alpha: Poly Haven glTFs ship baseColor as JPEG without alpha -> pack diff RGB + separate alpha map into one RGBA PNG
  for (const [mname, alphaFile] of Object.entries(job.alpha ?? {})) {
    const mat = root.listMaterials().find((m) => m.getName() === mname);
    const tex = mat.getBaseColorTexture();
    const rgb = sharp(tex.getImage()).removeAlpha();
    const meta = await rgb.metadata();
    const a = await sharp(path.join(dir, 'textures', alphaFile)).resize(meta.width, meta.height).greyscale().extractChannel(0).toBuffer();
    const png = await rgb.joinChannel(a).png({ compressionLevel: 9 }).toBuffer();
    tex.setImage(png).setMimeType('image/png').setURI(`${mname}_diff_alpha.png`);
    mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    log(`    alpha packed into ${mname} baseColor (RGBA PNG ${meta.width}x${meta.height}), alphaMode=MASK cutoff 0.5`);
  }
  for (const m of root.listMaterials()) if (m.getAlphaMode() === 'BLEND') { m.setAlphaMode('MASK').setAlphaCutoff(0.5); }
  // 5. textures <= 1024
  for (const t of root.listTextures()) {
    const s = t.getSize(); if (s && Math.max(...s) > 1024) { const img = await sharp(t.getImage()).resize(1024, 1024, { fit: 'inside' }).toBuffer(); t.setImage(img); log(`    resized texture ${t.getName() || t.getURI()} ${s} -> 1024`); }
  }
  await doc.transform(prune({ keepAttributes: true }), dedup());
  // report
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(2));
  const finalPrims = root.listNodes().filter((n) => n.getMesh()).flatMap((n) => n.getMesh().listPrimitives().map((p) => ({ node: n.getName(), material: p.getMaterial().getName(), alphaMode: p.getMaterial().getAlphaMode(), triangles: triCount(p), vertices: p.getAttribute('POSITION').getCount(), attributes: p.listSemantics() })));
  const finalTris = finalPrims.reduce((s, p) => s + p.triangles, 0);
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  const rec = {
    name, file: `models/${name}.glb`, source: job.id, keptNode: job.keep ? job.keep.source : 'all', originalTriangles: origTris, originalPerMaterial: origPer, triangles: finalTris,
    bboxSize: size, bboxMin: b.min.map((v) => +v.toFixed(2)), bboxMax: b.max.map((v) => +v.toFixed(2)), primitives: finalPrims, foliage: fol,
    materials: root.listMaterials().map((m) => ({ name: m.getName(), alphaMode: m.getAlphaMode(), alphaCutoff: m.getAlphaMode() === 'MASK' ? m.getAlphaCutoff() : undefined, doubleSided: m.getDoubleSided() })),
    textures: root.listTextures().map((t) => ({ uri: t.getURI() || t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage().byteLength })),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName), bytes: fs.statSync(out).size, stripped: [...stripped],
  };
  log(`    => ${finalTris} tris (was ${origTris}), bbox ${size.join(' x ')} m, ${(rec.bytes / 1e6).toFixed(2)} MB, ext=[${rec.extensions}]`);
  for (const p of finalPrims) log(`       ${p.node} / ${p.material} [${p.alphaMode}] ${p.triangles} tris, ${p.vertices} verts, ${p.attributes.join(',')}`);
  fs.writeFileSync(path.join(ROOT, '.tmp/assets-src', `model_${name}.json`), JSON.stringify(rec, null, 1));
}

await MeshoptSimplifier.ready;
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
for (const [name, job] of Object.entries(JOBS)) if (!want.length || want.includes(name)) await build(name, job);
