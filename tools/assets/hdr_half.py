"""Réduit de moitié une image Radiance .hdr (moyenne 2×2 en lumière linéaire, donc énergie conservée) :
    python3 tools/assets/hdr_half.py public/assets/sky/sky_4k.hdr public/assets/sky/sky_2k.hdr
"""
import sys
import numpy as np
from hdr import read_hdr


def rle(row):
    out = bytearray()
    n = len(row); i = 0
    while i < n:
        j = i + 1
        while j < n and j - i < 127 and row[j] == row[i]:
            j += 1
        if j - i >= 4:
            out += bytes([128 + (j - i), row[i]]); i = j
            continue
        k = i
        while k < n and k - i < 128:
            if k + 3 < n and row[k] == row[k + 1] == row[k + 2] == row[k + 3]:
                break
            k += 1
        out += bytes([k - i]) + bytes(row[i:k]); i = k
    return out


def write_hdr(path, im):
    H, W, _ = im.shape
    m = im.max(axis=2)
    e = np.where(m > 1e-32, np.floor(np.log2(np.maximum(m, 1e-38))) + 1, 0).astype(np.int32)
    s = np.ldexp(1.0, -e)[..., None] * 256.0
    rgb = np.clip(np.floor(im * s), 0, 255).astype(np.uint8)
    ex = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    rgb[m <= 1e-32] = 0
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + ('-Y %d +X %d\n' % (H, W)).encode())
        for y in range(H):
            f.write(bytes([2, 2, W >> 8, W & 255]))
            for c in (rgb[y, :, 0], rgb[y, :, 1], rgb[y, :, 2], ex[y]):
                f.write(rle(c.tolist()))


if __name__ == '__main__':
    im = read_hdr(sys.argv[1]).astype(np.float64)
    H, W, _ = im.shape
    half = im.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3))
    write_hdr(sys.argv[2], half)
    back = read_hdr(sys.argv[2])
    print('%dx%d -> %dx%d, écart moyen relatif à la relecture : %.4f' % (W, H, W // 2, H // 2, np.abs(back - half).sum() / half.sum()))
