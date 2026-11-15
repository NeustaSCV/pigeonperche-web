#!/usr/bin/env python3
"""Prépare les sons enregistrés du tir (public/assets/audio/) à partir des prises libres (CC0) de la banque d'origine.

Usage : python3 tools/gen-shot-audio.py <dossier de la banque>
        (le dossier qui contient weapons/shots/, weapons/mech/ ; licences et auteurs : voir CREDITS.md)

Attaques de tir : 0,30 s, stéréo, 48 kHz, 16 bits ; coupe-bas à 45 Hz (24 dB/octave) ; fondu de sortie de 0,12 s.
Le jeu n'en garde que l'attaque et le corps : le grave, la queue et les échos sont synthétisés (src/audio/shot-bake.ts).
Mécanique : culasse ouverte, culasse refermée, douille au sol ; mono, 32 kHz, 16 bits.
Format : WAV PCM non compressé, lu par le jeu sans décodeur (src/audio/samples.ts), donc identique sur tous les navigateurs.
"""
import os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SRC = sys.argv[1] if len(sys.argv) > 1 else ''
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'audio')
if not os.path.isdir(os.path.join(SRC, 'weapons')):
    sys.exit('usage : python3 tools/gen-shot-audio.py <dossier de la banque audio>')
os.makedirs(OUT, exist_ok=True)


def load(rel, channel=None):
    """Une seule voie des prises stéréo : les deux micros sont espacés (voies décorrélées), leur somme étale l'attaque."""
    sr, x = wavfile.read(os.path.join(SRC, rel))
    x = x.astype(np.float64) / (32768.0 if x.dtype == np.int16 else 1.0)
    return sr, (x if x.ndim == 1 else x[:, channel] if channel is not None else x.mean(axis=1))


def save(name, x, sr):
    x = x / np.abs(x).max() * 0.89
    wavfile.write(os.path.join(OUT, name), sr, np.round(x * 32767).astype(np.int16))
    print('%-22s %5.2f s  %6d Hz  %5.1f Ko' % (name, len(x) / sr, sr, os.path.getsize(os.path.join(OUT, name)) / 1024))


def fade_out(x, n):
    n = min(n, len(x))
    x[-n:] *= np.linspace(1, 0, n)
    return x


# attaques : une par classe de calibre, en stéréo (les deux micros de la prise sont espacés : c'est ce qui donne sa
# largeur au tir), 0,30 s avec un fondu de sortie de 0,12 s — exactement ce que la maquette retenue faisait entendre.
for name, rel in [('shot-small.wav', 'weapons/shots/shot_small_01.wav'),
                  ('shot-intermediate.wav', 'weapons/shots/shot_intermediate_01.wav'),
                  ('shot-medium.wav', 'weapons/shots/shot_medium_01.wav'),
                  ('shot-magnum.wav', 'weapons/shots/shot_magnum_03.wav'),
                  ('shot-suppressed.wav', 'weapons/shots/shot_suppressed_01.wav')]:
    sr, x = wavfile.read(os.path.join(SRC, rel))
    assert sr == 48000 and x.ndim == 2
    x = x.astype(np.float64) / 32768.0
    x = signal.sosfilt(signal.butter(4, 45, 'highpass', fs=sr, output='sos'), x, axis=0)
    x = x[: int(0.30 * sr)].copy()
    n = int(0.12 * sr)
    x[-n:] *= np.linspace(1, 0, n)[:, None]
    save(name, x, sr)

# mécanique : rééchantillonnée à 32 kHz
for name, rel, dur in [('bolt-open.wav', 'weapons/mech/bolt_open_01.wav', 0.57), ('bolt-close.wav', 'weapons/mech/bolt_close_01.wav', 0.64),
                       ('casing.wav', 'weapons/mech/casing_stone_04.wav', 0.50)]:
    sr, x = load(rel)
    x = fade_out(x[: int(dur * sr)].copy(), int(0.05 * sr))
    save(name, signal.resample_poly(x, 2, 3), 32000)
