import type { ScoreStore } from './score-store.mjs';

export const API_PATH: string;
export function createRateLimiter(max: number, windowMs: number, now?: () => number): (key: string) => boolean;
export function createScoresApi(options: { file: string; trustProxy?: boolean; postsPerMinute?: number; readsPerMinute?: number; log?: (message: string) => void }): {
  /** vrai si la requête visait l'API et a reçu sa réponse */
  handle(req: any, res: any): Promise<boolean>;
  store: ScoreStore;
};
