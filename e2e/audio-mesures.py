#!/usr/bin/env python3
"""Mesure les rendus de e2e/audio.mjs (e2e/out/tir/audio/*.wav, sortie de mixage, 48 kHz stéréo flottant).

Sorties : e2e/out/tir/audio/mesures.json, tableau.md (les dix-sept armes), <nom>.png (attaque, forme d'onde,
spectrogramme) et planche-<n>.png (spectrogrammes côte à côte).
Sonie : maximum de la sonie momentanée (400 ms, pondération K, UIT-R BS.1770). Attaque : de 10 à 90 % de la première crête (3 ms après le début).
Aucune normalisation : les niveaux sont ceux que le jeu envoie à la sortie, volume à 100 %.
"""
import glob, json, os
import numpy as np
from scipy import signal
from scipy.io import wavfile
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'tir', 'audio')
SR = 48000
ORDER = ['22lr', '308sub', '223', '6cm', '65cm', '308', '65prc', '7prc', '300wm', '300prc', '338lm', '338lm300', '33xc', '375ct', '408ct', '416b', '50bmg']


def kweight(x):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]; a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]; a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def momentary_max(x):
    p = (kweight(x) ** 2).sum(axis=1)
    n = int(0.4 * SR)
    c = np.cumsum(np.concatenate([[0.0], p]))
    w = (c[n:] - c[:-n]) / n
    return -0.691 + 10 * np.log10(max(w.max() if len(w) else p.mean(), 1e-12))


def db(v):
    return 20 * np.log10(max(float(v), 1e-9))


def bands(seg):
    if len(seg) < 64:
        return [0, 0, 0, 0]
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    tot = sp.sum() + 1e-20
    return [float(sp[(f >= a) & (f < b)].sum() / tot) for a, b in [(0, 200), (200, 2000), (2000, 8000), (8000, 24001)]]


def rms5(x):
    """niveau efficace glissant sur 5 ms (dB), les deux voies confondues"""
    n = int(0.005 * SR)
    return np.sqrt(np.convolve((x ** 2).mean(axis=1), np.ones(n) / n, mode='same'))


def measure(x, echo=None):
    a = np.abs(x).max(axis=1)
    pk = a.max()
    if pk < 1e-7:
        return {'silence': True, 'crete_dbfs': round(db(pk), 1)}
    on = int(np.argmax(a >= 0.05 * pk))
    # front initial : de 10 à 90 % de la première crête (3 ms après le début). Les prises réelles ont souvent leur plus
    # forte excursion 10 à 20 ms plus tard (réflexion du sol) : la mesurer donnerait le retard de cette réflexion.
    loc = a[on:on + int(0.003 * SR)]
    lp = loc.max()
    t10 = int(np.argmax(loc >= 0.1 * lp)); t90 = int(np.argmax(loc >= 0.9 * lp))
    n = int(0.01 * SR)
    e = np.sqrt(np.convolve((x ** 2).mean(axis=1), np.ones(n) / n, mode='same'))
    ep = e.max()

    def last_above(dbv):
        idx = np.nonzero(e >= ep * 10 ** (dbv / 20))[0]
        return (idx[-1] - on) / SR if len(idx) else 0.0
    m = x.mean(axis=1)
    r = rms5(x)
    ref = r[on:on + int(0.1 * SR)].max()
    out = {
        'crete_dbfs': round(db(pk), 2), 'sonie_lufs': round(momentary_max(x), 2), 'attaque_ms': round(max(t90 - t10, 0) / SR * 1000 + 1000 / SR, 2),
        'rms5_dbfs': round(db(ref), 1),
        'duree_m20_ms': round(last_above(-20) * 1000), 'duree_m40_ms': round(last_above(-40) * 1000),
        'spectre_attaque': [round(v * 100) for v in bands(m[on:on + int(0.02 * SR)])],
        'spectre_corps': [round(v * 100) for v in bands(m[on:on + int(0.3 * SR)])],
        'spectre_queue': [round(v * 100) for v in bands(m[on + int(0.15 * SR):on + int(0.65 * SR)])],
        'grave_db': round(db(np.sqrt((signal.sosfilt(signal.butter(4, 120, 'lowpass', fs=SR, output='sos'), m[on:on + int(0.4 * SR)]) ** 2).mean())), 1),
        'queue_200ms_db': round(db(np.sqrt((x[on + int(0.35 * SR):on + int(0.5 * SR)] ** 2).mean())) - db(ref), 1),
        'ecretes': int((np.abs(x) >= 0.999).sum()),
        'facteur_crete_db': round(db(pk) - db(np.sqrt((x[on:on + int(max(last_above(-40), 0.05) * SR)] ** 2).mean())), 1),
    }
    if echo:
        # niveau de chaque écho : plus fort niveau efficace (5 ms) dans la fenêtre du retour, sous celui de la détonation
        ech = []
        for rel in sorted(echo['reliefs'], key=lambda q: q['distance']):
            t = 2 * rel['distance'] / 343
            i0 = on + int((t - 0.02) * SR); i1 = on + int((t + 0.45) * SR)
            if i1 < len(r):
                ech.append([rel['distance'], round(t, 2), round(db(r[i0:i1].max()) - db(ref), 1)])
        out['echos'] = ech
    return out


def plot(x, path, title):
    m = x.mean(axis=1)
    t = np.arange(len(m)) / SR
    fig, ax = plt.subplots(3, 1, figsize=(7.2, 4.3), dpi=100, gridspec_kw={'height_ratios': [1, 1, 1.5]})
    fig.patch.set_facecolor('#14171a')
    for a in ax:
        a.set_facecolor('#0c0e10'); a.tick_params(colors='#9aa3ab', labelsize=7)
        for s in a.spines.values(): s.set_color('#2c3238')
    on = int(np.argmax(np.abs(m) >= 0.05 * np.abs(m).max()))
    z0 = max(0, on - int(0.002 * SR)); z1 = min(len(m), on + int(0.03 * SR))
    ax[0].plot((np.arange(z0, z1) - on) / SR * 1000, x[z0:z1, 0], color='#e8b04a', lw=0.8)
    ax[0].set_xlim((z0 - on) / SR * 1000, (z1 - on) / SR * 1000); ax[0].set_ylim(-1.05, 1.05)
    ax[0].set_title(title + ' — attaque (ms)', color='#d8dde2', fontsize=8, loc='left', pad=3)
    r = 20 * np.log10(rms5(x) + 1e-9)
    ax[1].plot(t[::48], r[::48], color='#e8b04a', lw=0.8)
    ax[1].set_xlim(0, t[-1]); ax[1].set_ylim(-90, 0)
    ax[1].set_title('niveau efficace sur 5 ms (dBFS) sur toute la durée (s)', color='#d8dde2', fontsize=8, loc='left', pad=3)
    f, ts, S = signal.spectrogram(m, SR, nperseg=1024, noverlap=768)
    ax[2].pcolormesh(ts, f, 10 * np.log10(S + 1e-14), vmin=-120, vmax=-30, cmap='magma', shading='auto')
    ax[2].set_yscale('symlog', linthresh=200); ax[2].set_ylim(30, 20000)
    ax[2].set_yticks([50, 200, 1000, 5000, 20000]); ax[2].set_yticklabels(['50', '200', '1 k', '5 k', '20 k'])
    ax[2].set_title('spectrogramme (Hz, de −120 à −30 dB)', color='#d8dde2', fontsize=8, loc='left', pad=3)
    fig.tight_layout(pad=0.6)
    fig.savefig(path, facecolor=fig.get_facecolor())
    plt.close(fig)


def sheet(names, raw, path):
    """spectrogrammes des 1,2 premières secondes, côte à côte"""
    cols = 4
    rows = (len(names) + cols - 1) // cols
    fig, ax = plt.subplots(rows, cols, figsize=(3.4 * cols, 2.3 * rows), dpi=100, squeeze=False)
    fig.patch.set_facecolor('#14171a')
    for k, a in enumerate(ax.flat):
        a.set_facecolor('#0c0e10'); a.tick_params(colors='#9aa3ab', labelsize=6)
        if k >= len(names):
            a.axis('off'); continue
        m = raw[names[k]].mean(axis=1)[: int(1.2 * SR)]
        f, ts, S = signal.spectrogram(m, SR, nperseg=512, noverlap=448)
        a.pcolormesh(ts, f, 10 * np.log10(S + 1e-14), vmin=-110, vmax=-25, cmap='magma', shading='auto')
        a.set_yscale('symlog', linthresh=200); a.set_ylim(30, 20000)
        a.set_yticks([50, 200, 1000, 5000]); a.set_yticklabels(['50', '200', '1 k', '5 k'])
        a.set_title(names[k], color='#d8dde2', fontsize=8, loc='left', pad=2)
    fig.tight_layout(pad=0.5)
    fig.savefig(path, facecolor=fig.get_facecolor())
    plt.close(fig)


def main():
    info = json.load(open(os.path.join(ROOT, 'rendus.json')))
    raw = {}
    for p in sorted(glob.glob(os.path.join(ROOT, '*.wav'))):
        sr, x = wavfile.read(p)
        assert sr == SR and x.ndim == 2
        raw[os.path.basename(p)[:-4]] = x.astype(np.float64)
    out = {}
    for name, x in raw.items():
        lv = name.split('_')[1] if '_' in name else ''
        echo = info['echo'].get(lv if lv in info['echo'] else 'standard') if name.split('_')[0] in ORDER else None
        if 'ambiance' in name:
            # ambiance seule avant le tir (1 à 3 s), puis 1,5 à 2,5 s et 3,5 à 4,5 s après : elle doit revenir
            seg = lambda a, b: round(db(np.sqrt((x[int(a * SR):int(b * SR)] ** 2).mean())), 1)
            out[name] = {'ambiance_avant_dbfs': seg(1, 3), 'apres_1s5_dbfs': seg(4.5, 5.5), 'apres_3s5_dbfs': seg(6.5, 7.5), 'crete_dbfs': round(db(np.abs(x).max()), 2), 'ecretes': int((np.abs(x) >= 0.999).sum())}
            plot(x, os.path.join(ROOT, name + '.png'), name)
            continue
        out[name] = measure(x, echo)
        if not out[name].get('silence'):
            plot(x, os.path.join(ROOT, name + '.png'), name)
    json.dump(out, open(os.path.join(ROOT, 'mesures.json'), 'w'), indent=1, ensure_ascii=False)
    arm = {a['id']: a for a in info['armes']}
    L = ['| arme | calibre | bouche | attaque | crête dBFS | sonie LUFS | attaque ms | efficace 5 ms dBFS | grave < 120 Hz dB | durée −20 / −40 dB ms | corps 0,3 s : < 200 / 200–2 k / 2–8 k / > 8 k % | queue de 350 à 500 ms dB | échos (m : dB) | repli : crête / sonie / attaque |', '|' + '---|' * 14]
    for i in ORDER:
        m = out.get(i + '_standard'); f = out.get(i + '_repli')
        if not m:
            continue
        bk = info['bake'].get(i + '_standard', {})
        L.append('| %s | %s | %s | %s | %.1f | %.1f | %.2f | %.1f | %.1f | %d / %d | %s | %.1f | %s | %s |' % (
            i, arm[i]['caliber'], arm[i]['muzzle'], 'enregistrée' if bk.get('recorded') else 'synthèse', m['crete_dbfs'], m['sonie_lufs'], m['attaque_ms'], m['rms5_dbfs'], m['grave_db'],
            m['duree_m20_ms'], m['duree_m40_ms'], ' / '.join(str(v) for v in m['spectre_corps']), m['queue_200ms_db'],
            ' · '.join('%d : %.0f' % (e[0], e[2]) for e in m.get('echos', [])[:3]),
            '%.1f / %.1f / %.2f' % (f['crete_dbfs'], f['sonie_lufs'], f['attaque_ms']) if f else '—'))
    open(os.path.join(ROOT, 'tableau.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))
    for k, v in out.items():
        if k.split('_')[0] not in ORDER or not k.endswith(('_standard', '_repli')):
            print(k, json.dumps(v, ensure_ascii=False))
    sheet([i + '_standard' for i in ORDER if i + '_standard' in raw], raw, os.path.join(ROOT, 'planche-hybride.png'))
    sheet([i + '_repli' for i in ORDER if i + '_repli' in raw], raw, os.path.join(ROOT, 'planche-repli.png'))


main()
