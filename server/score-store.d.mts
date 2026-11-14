import type { ScoreBoards, ScoreEntry, ScoreLevel } from '../src/shared/scores-core.mjs';

export interface ScoreStore {
  file: string;
  read(): Promise<ScoreBoards>;
  submit(level: ScoreLevel, entry: Omit<ScoreEntry, 'date'>): Promise<{ rank: number; board: ScoreEntry[] }>;
}
export function createScoreStore(file: string, options?: { now?: () => Date; log?: (message: string) => void }): ScoreStore;
