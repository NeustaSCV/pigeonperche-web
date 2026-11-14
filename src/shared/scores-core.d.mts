// Types de scores-core.mjs (cœur du classement partagé par le jeu, le serveur et le greffon Vite).
export type ScoreLevel = 'facile' | 'standard' | 'avance';

/** une ligne de classement */
export interface ScoreEntry {
  name: string;
  score: number;
  grade: string;
  /** 0..1 */
  accuracy: number;
  shots: number;
  /** durée de la mission, secondes */
  time: number;
  /** date d'inscription, ISO 8601 (UTC) */
  date: string;
}
export type ScoreBoards = Record<ScoreLevel, ScoreEntry[]>;
/** résultat d'une mission, avant inscription */
export type ScoreResult = Omit<ScoreEntry, 'name' | 'date'>;

export const SCORES_VERSION: number;
export const SCORE_LEVELS: ScoreLevel[];
export const BOARD_SIZE: number;
export const HOME_SIZE: number;
export const NAME_MAX: number;
export const DEFAULT_NAME: string;
export const GRADES: string[];
export const LEVEL_RULES: Record<ScoreLevel, { steps: number; factor: number; range: number }>;
export function scoreBounds(level: string): { min: number; max: number } | null;
export function cleanName(raw: unknown, partial?: boolean): string;
export function escapeHtml(s: unknown): string;
export function emptyBoards(): ScoreBoards;
export function compareEntries(a: ScoreEntry, b: ScoreEntry): number;
export function normalizeEntry(raw: unknown): ScoreEntry | null;
export function normalizeBoards(raw: unknown): { boards: ScoreBoards; ok: boolean };
export function parseBoards(text: unknown): { boards: ScoreBoards; corrupt: boolean };
export function serializeBoards(boards: ScoreBoards): string;
export function rankOf(board: ScoreEntry[], score: number): number;
export function qualifies(board: ScoreEntry[], score: number): boolean;
export function addEntry(board: ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number };
export function validateSubmission(body: unknown): { ok: true; level: ScoreLevel; entry: Omit<ScoreEntry, 'date'> } | { ok: false; error: string };
