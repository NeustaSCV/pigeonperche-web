// Sons enregistrés du jeu (public/assets/audio/, licences dans CREDITS.md) : attaques de tir et mécanique de culasse.
// Chargement paresseux et tolérant : un fichier absent, tronqué ou illisible vaut « pas de fichier », et le moteur se
// replie sur la synthèse. Les fichiers sont des WAV PCM 16 bits lus ici sans décodeur du navigateur : le résultat
// est le même partout (pas de dépendance à un codec, pas de rééchantillonnage implicite).

export interface Pcm {
  /** fréquence d'échantillonnage du fichier, Hz */
  sr: number;
  /** mono, −1..1 */
  data: Float32Array;
}

export const SAMPLE_FILES = {
  small: 'shot-small.wav',
  intermediate: 'shot-intermediate.wav',
  medium: 'shot-medium.wav',
  magnum: 'shot-magnum.wav',
  suppressed: 'shot-suppressed.wav',
  boltOpen: 'bolt-open.wav',
  boltClose: 'bolt-close.wav',
  casing: 'casing.wav',
} as const;
export type SampleName = keyof typeof SAMPLE_FILES;

/** Lit un WAV PCM 16 bits (mono, ou stéréo ramené en mono). Renvoie null si ce n'en est pas un. */
export function parseWav(buf: ArrayBuffer): Pcm | null {
  try {
    const v = new DataView(buf);
    const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    if (buf.byteLength < 46 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let o = 12, sr = 0, ch = 0, bits = 0, fmt = 0;
    while (o + 8 <= buf.byteLength) {
      const id = tag(o), len = v.getUint32(o + 4, true);
      if (id === 'fmt ') {
        fmt = v.getUint16(o + 8, true); ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true);
      } else if (id === 'data') {
        if (fmt !== 1 || bits !== 16 || ch < 1 || ch > 2 || sr < 8000 || sr > 96000) return null;
        const n = Math.floor(Math.min(len, buf.byteLength - o - 8) / (2 * ch));
        if (n < 64) return null;
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let c = 0; c < ch; c++) s += v.getInt16(o + 8 + (i * ch + c) * 2, true);
          data[i] = s / ch / 32768;
        }
        return { sr, data };
      }
      o += 8 + len + (len & 1);
    }
  } catch {
    /* fichier tronqué */
  }
  return null;
}

export class SampleBank {
  private pcm = new Map<SampleName, Pcm>();
  private asked = false;

  get(name: SampleName): Pcm | null {
    return this.pcm.get(name) ?? null;
  }

  /** Pour les tests : installe un son sans passer par le réseau. */
  put(name: SampleName, p: Pcm): void {
    this.pcm.set(name, p);
  }

  /**
   * Lance le chargement de tous les fichiers (une seule fois). `onLoad` est appelé à l'arrivée de chacun ; un échec
   * est silencieux : le son correspondant reste synthétisé.
   */
  load(base: string, onLoad: (name: SampleName) => void): void {
    if (this.asked || typeof fetch !== 'function') return;
    this.asked = true;
    for (const name of Object.keys(SAMPLE_FILES) as SampleName[]) {
      void fetch(base + SAMPLE_FILES[name])
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => {
          const p = b ? parseWav(b) : null;
          if (!p) return;
          this.pcm.set(name, p);
          onLoad(name);
        })
        .catch(() => undefined);
    }
  }
}
