// Préchargement en arrière-plan, pendant que le joueur lit le menu : les fichiers lourds arrivent dans le cache du
// navigateur, et le clic sur « Commencer » n'a plus qu'à construire la scène. Rien n'est décodé ni gardé en mémoire
// ici : le jeu redemande ensuite les mêmes adresses (src/core/assets.ts), servies par le cache.
import { assetUrl } from './assets';

declare const __COMMON_ASSETS__: string[] | undefined;
/** textures et modèles communs aux trois cartes, relevés à la construction (vite.config.ts) */
const COMMON: string[] = typeof __COMMON_ASSETS__ !== 'undefined' && Array.isArray(__COMMON_ASSETS__) ? __COMMON_ASSETS__ : [];

export interface PreloadPlan {
  /** dossier du relief de la carte choisie (public/terrain/<dir>/) */
  terrainDir: string;
  /** fichier du ciel pour la qualité choisie */
  sky: string;
}

/** Adresses à précharger, dans l'ordre où le chargement de la carte les demandera : relief, ciel, puis le reste. */
export function preloadList(plan: PreloadPlan): string[] {
  const t = `terrain/${plan.terrainDir}/`;
  return [t + 'meta.json', t + 'height.bin', t + 'splat.bin', 'assets/sky/' + plan.sky, ...COMMON];
}

/** Connexion comptée (économie de données demandée, réseau mobile lent) : on ne télécharge rien d'avance. */
export function meteredConnection(nav: { connection?: { saveData?: boolean; effectiveType?: string; type?: string } } = navigator as never): boolean {
  const c = nav.connection;
  if (!c) return false;
  return c.saveData === true || c.type === 'cellular' || /^(slow-2g|2g|3g)$/.test(c.effectiveType ?? '');
}

export class Preloader {
  private queue: string[] = [];
  private stopped = false;
  private active = 0;
  /** fichiers arrivés / demandés */
  done = 0;
  total = 0;

  constructor(private parallel = 3, private doFetch: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)) {}

  start(paths: string[]): void {
    this.queue = paths.slice();
    this.total = paths.length;
    this.done = 0;
    this.stopped = false;
    for (let i = this.active; i < this.parallel; i++) void this.pump();
  }

  /** Arrête d'en demander de nouveaux (les téléchargements en cours se terminent : le jeu en profitera). */
  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  private async pump(): Promise<void> {
    this.active++;
    try {
      while (!this.stopped) {
        const p = this.queue.shift();
        if (!p) break;
        try {
          const r = await this.doFetch(assetUrl(p), { priority: 'low' } as RequestInit);
          // lire la réponse jusqu'au bout : c'est ce qui l'inscrit dans le cache
          if (r.ok) await r.arrayBuffer();
        } catch {
          /* hors ligne, fichier absent : le chargement normal s'en chargera */
        }
        this.done++;
      }
    } finally {
      this.active--;
    }
  }
}
