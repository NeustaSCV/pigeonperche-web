# Bake needle/leaf-level foliage geometry of a Poly Haven tree into alpha-tested "branch cards" (game LOD).
# usage: bake_cards.py <model dir> <id> <node name> <foliage material name> <alpha png> <out prefix> <target cells> [exemplars=8]
import sys, json, math
import numpy as np
from PIL import Image

mdir, mid, node_name, mat_name, alpha_png, outp, target_cells = sys.argv[1:8]
target_cells = int(target_cells)
NEX = int(sys.argv[8]) if len(sys.argv) > 8 else 8
CELL = 256; GRID = 4  # 4x4 atlas of 256px cells = 1024px; 2 views per exemplar
rng = np.random.default_rng(7)

G = json.load(open(f'{mdir}/{mid}.gltf'))
mm = np.memmap(f'{mdir}/{G["buffers"][0]["uri"]}', dtype=np.uint8, mode='r')
CT = {5123: np.uint16, 5125: np.uint32, 5126: np.float32}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}
def acc(i):
    a = G['accessors'][i]; bv = G['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
    assert not bv.get('byteStride')
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(mm, dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
node = next(n for n in G['nodes'] if n['name'] == node_name)
mi = next(i for i, m in enumerate(G['materials']) if m['name'] == mat_name)
prim = next(p for p in G['meshes'][node['mesh']]['primitives'] if p['material'] == mi)
P = acc(prim['attributes']['POSITION']).astype(np.float32); UV = acc(prim['attributes']['TEXCOORD_0']).astype(np.float32)
I = acc(prim['indices']).reshape(-1, 3).astype(np.int64)
print(f'foliage {mat_name}: {len(I)} tris, {len(P)} verts')
m = G['materials'][mi]; ti = m['pbrMetallicRoughness']['baseColorTexture']['index']
diff = np.asarray(Image.open(f'{mdir}/{G["images"][G["textures"][ti]["source"]]["uri"]}').convert('RGB'), np.float32) / 255
alpha = np.asarray(Image.open(f'{mdir}/textures/{alpha_png}').convert('L').resize(diff.shape[1::-1]), np.float32) / 255

A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
cen = (A + B + C) / 3
area = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
axis_xz = np.average(cen[:, [0, 2]], axis=0, weights=area)
crown_c = np.array([axis_xz[0], np.average(cen[:, 1], weights=area), axis_xz[1]])

# --- voxel clustering: choose cell size giving ~target_cells populated cells
def cells_for(s):
    k = np.floor(cen / s).astype(np.int64); k -= k.min(0)
    dims = k.max(0) + 1
    key = (k[:, 0] * dims[1] + k[:, 1]) * dims[2] + k[:, 2]
    uq, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    return uq, inv, cnt
s = 0.15
while True:
    uq, inv, cnt = cells_for(s)
    carea = np.bincount(inv, weights=area)
    ok = carea >= 0.15 * np.median(carea)
    if ok.sum() <= target_cells: break
    s *= 1.08
print(f'voxel size {s:.3f} m -> {len(uq)} cells, {ok.sum()} kept (>=15% of median foliage area)')
order = np.argsort(inv, kind='stable'); starts = np.concatenate([[0], np.cumsum(cnt)])

def frame(ci):
    tri = order[starts[ci]:starts[ci + 1]]
    pts = np.concatenate([A[tri], B[tri], C[tri]]); w = np.tile(area[tri], 3) + 1e-12
    c = np.average(pts, axis=0, weights=w); d = pts - c
    cov = (d * w[:, None]).T @ d / w.sum()
    ev, evec = np.linalg.eigh(cov)
    n = evec[:, 0]
    if n[1] < 0: n = -n
    r = c - np.array([axis_xz[0], c[1], axis_xz[1]])
    u = r - (r @ n) * n
    if np.linalg.norm(u) < 1e-4: u = evec[:, 2]
    u /= np.linalg.norm(u); v = np.cross(n, u)
    pu, pv, pn = d @ u, d @ v, d @ n
    ext = [np.percentile(x, [1, 99]) for x in (pu, pv, pn)]
    ext = [np.array([lo - 0.04 * (hi - lo) - 0.004, hi + 0.04 * (hi - lo) + 0.004]) for lo, hi in ext]
    return tri, c, u, v, n, ext

# --- exemplars: well-filled, typical cells
cand = np.nonzero(ok)[0]; cand = cand[np.argsort(carea[cand])]
pick = cand[np.linspace(int(len(cand) * 0.55), int(len(cand) * 0.97), NEX).astype(int)]
atlas = np.zeros((CELL * GRID, CELL * GRID, 4), np.float32)
def bake(tri, c, ax_x, ax_y, ax_z, ex, ey, slot):
    NS = max(8, min(400, int(2.5e6 / max(len(tri), 1))))
    w = rng.random((len(tri), NS, 2)); f = w.sum(2) > 1; w[f] = 1 - w[f]
    w0 = 1 - w[..., 0] - w[..., 1]
    pos = w0[..., None] * A[tri][:, None] + w[..., 0:1] * B[tri][:, None] + w[..., 1:2] * C[tri][:, None]
    uv = w0[..., None] * UV[I[tri, 0]][:, None] + w[..., 0:1] * UV[I[tri, 1]][:, None] + w[..., 1:2] * UV[I[tri, 2]][:, None]
    pos = pos.reshape(-1, 3) - c; uv = uv.reshape(-1, 2)
    tx = (np.floor((uv[:, 0] % 1) * diff.shape[1]).astype(int)) % diff.shape[1]; ty = (np.floor((uv[:, 1] % 1) * diff.shape[0]).astype(int)) % diff.shape[0]
    keep = alpha[ty, tx] >= 0.5
    pos, col = pos[keep], diff[ty, tx][keep]
    x = (pos @ ax_x - ex[0]) / (ex[1] - ex[0]); y = (pos @ ax_y - ey[0]) / (ey[1] - ey[0]); z = pos @ ax_z
    inb = (x >= 0) & (x < 1) & (y >= 0) & (y < 1); x, y, z, col = x[inb], y[inb], z[inb], col[inb]
    px = np.clip((x * CELL).astype(int), 0, CELL - 1); py = np.clip(((1 - y) * CELL).astype(int), 0, CELL - 1)
    zn = (z - z.min()) / max(np.ptp(z), 1e-6)
    # painter: far-to-near, darken the deeper layers a little (cheap self-occlusion)
    o = np.argsort(zn); px, py, col, zn = px[o], py[o], col[o], zn[o]
    cell = np.zeros((CELL, CELL, 4), np.float32)
    cell[py, px, :3] = col * (0.62 + 0.38 * zn[:, None]); cell[py, px, 3] = 1
    # 1px dilation of coverage to close sampling pinholes
    a = cell[..., 3]; nb = np.zeros_like(a); cnt4 = np.zeros_like(a); rgb = np.zeros_like(cell[..., :3])
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sa = np.roll(a, (dy, dx), (0, 1)); nb += sa; rgb += np.roll(cell[..., :3], (dy, dx), (0, 1)) * sa[..., None]
    fill = (a == 0) & (nb >= 3)
    cell[fill, :3] = rgb[fill] / nb[fill][:, None]; cell[fill, 3] = 1
    cell[:2] = 0; cell[-2:] = 0; cell[:, :2] = 0; cell[:, -2:] = 0  # transparent gutter
    gy, gx = divmod(slot, GRID)
    atlas[gy * CELL:(gy + 1) * CELL, gx * CELL:(gx + 1) * CELL] = cell
    return cell[..., 3].mean()
exemplar = []
for e, ci in enumerate(pick):
    tri, c, u, v, n, ext = frame(ci)
    cov1 = bake(tri, c, u, v, n, ext[0], ext[1], 2 * e)       # spray plane (seen from above/below)
    cov2 = bake(tri, c, u, n, -v, ext[0], ext[2], 2 * e + 1)  # side plane (seen edge-on)
    exemplar.append((carea[ci], cov1, cov2))
    print(f'  exemplar {e}: {len(tri)} tris, size u/v/n = {np.ptp(ext[0]):.2f}/{np.ptp(ext[1]):.2f}/{np.ptp(ext[2]):.2f} m, coverage {cov1:.2f}/{cov2:.2f}')
# fill transparent texels' RGB with mean foliage colour (no dark fringes under mip-mapping)
op = atlas[..., 3] > 0; mean = atlas[op][:, :3].mean(0); atlas[~op, :3] = mean
Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8), 'RGBA').save(outp + '_atlas.png', optimize=True)

# --- cards
Vp, Vn, Vt, Ix = [], [], [], []
ex_area = np.array([e[0] for e in exemplar])
for ci in np.nonzero(ok)[0]:
    tri, c, u, v, n, ext = frame(ci)
    # exemplar with the closest foliage amount (keeps sparse cells sparse-ish), random among the 3 nearest
    near = np.argsort(np.abs(np.log(ex_area / carea[ci])))[:3]; e = int(rng.choice(near))
    dome = c - crown_c; dome /= np.linalg.norm(dome) + 1e-9
    nn = 0.55 * dome + 0.25 * n + np.array([0, 0.35, 0]); nn /= np.linalg.norm(nn)
    for view, (ax_y, ey) in enumerate(((v, ext[1]), (n, ext[2]))):
        slot = 2 * e + view; gy, gx = divmod(slot, GRID); flip = rng.random() < 0.5
        base = len(Vp)
        for su, sv in ((0, 0), (1, 0), (1, 1), (0, 1)):
            Vp.append(c + u * ext[0][su] + ax_y * ey[sv])
            tu = (gx + (su if True else 0)) / GRID; tv_local = (1 - sv) if not flip else sv
            Vt.append([(gx + su) / GRID, (gy + tv_local) / GRID]); Vn.append(nn)
        Ix += [base, base + 1, base + 2, base, base + 2, base + 3]
Vp = np.array(Vp, np.float32); Vn = np.array(Vn, np.float32); Vt = np.array(Vt, np.float32); Ix = np.array(Ix, np.uint32)
Vp.tofile(outp + '_pos.f32'); Vn.tofile(outp + '_nor.f32'); Vt.tofile(outp + '_uv.f32'); Ix.tofile(outp + '_idx.u32')
json.dump({'verts': len(Vp), 'tris': len(Ix) // 3, 'cells': int(ok.sum()), 'voxel': s, 'exemplars': NEX, 'srcTris': int(len(I))}, open(outp + '_meta.json', 'w'))
print(f'cards: {ok.sum()} cells x 2 crossed quads = {len(Ix)//3} tris; atlas {CELL*GRID}px, opaque {op.mean():.2f}')
