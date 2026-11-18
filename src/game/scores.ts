// Classements côté jeu. Deux modes, choisis tout seuls :
// - « en ligne » : le serveur expose l'API (api/scores) ; le classement est commun à tous les joueurs ;
// - « local » : pas d'API (site servi en statique simple, hors ligne) ; les scores restent dans le navigateur
//   (localStorage), sur cet appareil seulement.
// Rien ici ne lève d'erreur : stockage indisponible (navigation privée), données abîmées ou réseau coupé sont tolérés.
import { DEFAULT_NAME, SCORE_LEVELS, addEntry, cleanName, emptyBoards, normalizeBoards, normalizeEntry, parseBoards, serializeBoards, type ScoreBoards, type ScoreEntry, type ScoreLevel, type ScoreResult, type UnrankedLevel } from '../shared/scores-core.mjs';

export * from '../shared/scores-core.mjs';

export const SCORES_KEY = 'hr.scores';
export const NAME_KEY = 'hr.name';
/** adresse relative : le jeu est servi avec `base: './'`, éventuellement sous un sous-dossier */
export const SCORES_URL = 'api/scores';

export type SubmitOutcome =
  /** inscrit ; `rank` 0 : d'autres joueurs sont passés devant entre-temps, le score ne tient plus dans les 20 */
  | { status: 'ok'; rank: number; board: ScoreEntry[]; online: boolean; fellBack: boolean }
  /** refusé pour l'instant (trop d'inscriptions) : on peut réessayer */
  | { status: 'retry'; message: string }
  /** refusé par le serveur */
  | { status: 'refused'; message: string };

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ScoreServiceOptions {
  /** `null` : pas de stockage ; par défaut le localStorage du navigateur, s'il est accessible */
  storage?: Store | null;
  /** `null` : pas de réseau (mode local d'emblée) */
  fetch?: Fetch | null;
  url?: string;
  timeoutMs?: number;
  now?: () => Date;
}

function browserStorage(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export class ScoreService {
  /** classements affichés : ceux du serveur en ligne, ceux du navigateur sinon */
  boards: ScoreBoards = emptyBoards();
  online = false;
  private storage: Store | null;
  private fetch: Fetch | null;
  private url: string;
  private timeoutMs: number;
  private now: () => Date;

  constructor(o: ScoreServiceOptions = {}) {
    this.storage = o.storage === undefined ? browserStorage() : o.storage;
    this.fetch = o.fetch === undefined ? (typeof fetch === 'function' ? (u, i) => fetch(u, i) : null) : o.fetch;
    this.url = o.url ?? SCORES_URL;
    this.timeoutMs = o.timeoutMs ?? 4000;
    this.now = o.now ?? (() => new Date());
    this.boards = this.readLocal();
  }

  // ---------------------------------------------------------------- stockage local
  private get(key: string): string | null {
    try { return this.storage?.getItem(key) ?? null; } catch { return null; }
  }
  private set(key: string, value: string): boolean {
    try { if (!this.storage) return false; this.storage.setItem(key, value); return true; } catch { return false; }
  }
  readLocal(): ScoreBoards {
    return parseBoards(this.get(SCORES_KEY)).boards;
  }
  /** nombre de scores enregistrés dans ce navigateur (classement de repli) */
  localCount(): number {
    const b = this.readLocal();
    return SCORE_LEVELS.reduce((n, id) => n + (b[id]?.length ?? 0), 0);
  }
  /** vide le classement local de ce navigateur ; le classement du serveur n'est pas concerné */
  clearLocal(): void {
    try { this.storage?.removeItem(SCORES_KEY); } catch { /* stockage indisponible */ }
    if (!this.online) this.boards = emptyBoards();
  }
  /** dernier nom inscrit sur cet appareil */
  lastName(): string {
    return cleanName(this.get(NAME_KEY));
  }

  // ---------------------------------------------------------------- réseau
  private async call(init?: RequestInit): Promise<Response | null> {
    if (!this.fetch) return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try { return await this.fetch(this.url, { ...init, signal: ctl?.signal, cache: 'no-store' }); } catch { return null; } finally { if (timer) clearTimeout(timer); }
  }
  /** réponse JSON de l'API, ou null (un hébergement statique répond 404, ou la page d'accueil en HTML) */
  private async json(r: Response | null): Promise<any> {
    if (!r || !/json/i.test(r.headers.get('content-type') ?? '')) return null;
    try { return await r.json(); } catch { return null; }
  }

  /** Lit les classements : serveur s'il répond, navigateur sinon. À rappeler pour rafraîchir. */
  async load(): Promise<ScoreBoards> {
    const r = await this.call();
    const data = r?.ok ? await this.json(r) : null;
    const got = data ? normalizeBoards(data) : null;
    if (got?.ok) { this.online = true; this.boards = got.boards; }
    else { this.online = false; this.boards = this.readLocal(); }
    return this.boards;
  }

  /** Inscrit un score sous `name`. En ligne : au serveur ; s'il ne répond plus, ou hors ligne : dans le navigateur. */
  async submit(asked: ScoreLevel | UnrankedLevel, result: ScoreResult, rawName: string): Promise<SubmitOutcome> {
    // carte hors classement (mode en ligne) : rien n'est inscrit, ni au serveur ni dans le navigateur
    const level = SCORE_LEVELS.find((l) => l === asked);
    if (!level) return { status: 'refused', message: 'Cette carte n’a pas de classement.' };
    const name = cleanName(rawName) || DEFAULT_NAME;
    this.set(NAME_KEY, name);
    if (this.online) {
      const r = await this.call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, name, score: result.score, grade: result.grade, accuracy: result.accuracy, shots: result.shots, time: result.time }) });
      const data = await this.json(r);
      if (r && data) {
        if (r.ok && Array.isArray(data.board) && Number.isInteger(data.rank)) {
          const board = (data.board as unknown[]).map(normalizeEntry).filter((e): e is ScoreEntry => !!e);
          this.boards = { ...this.boards, [level]: board };
          return { status: 'ok', rank: data.rank, board, online: true, fellBack: false };
        }
        if (r.status === 429) return { status: 'retry', message: 'Trop d’inscriptions depuis cette connexion : réessayez dans une minute.' };
        if (r.status >= 400 && r.status < 500) return { status: 'refused', message: 'Le serveur a refusé ce score.' };
      }
      // serveur injoignable ou en panne : repli sur l'appareil
      this.online = false;
      const out = this.submitLocal(level, result, name);
      return { ...out, fellBack: true };
    }
    return this.submitLocal(level, result, name);
  }

  private submitLocal(level: ScoreLevel, result: ScoreResult, name: string): { status: 'ok'; rank: number; board: ScoreEntry[]; online: boolean; fellBack: boolean } {
    const boards = this.readLocal();
    const entry = normalizeEntry({ ...result, name, date: this.now().toISOString() });
    const { board, rank } = entry ? addEntry(boards[level], entry) : { board: boards[level], rank: 0 };
    boards[level] = board;
    if (rank > 0) this.set(SCORES_KEY, serializeBoards(boards));
    this.boards = boards;
    return { status: 'ok', rank, board, online: false, fellBack: false };
  }
}
