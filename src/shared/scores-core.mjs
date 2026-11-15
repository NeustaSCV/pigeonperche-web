// Cœur du classement, sans aucune dépendance ni accès au réseau, au disque ou au DOM : le même fichier est lu par
// le jeu (src/game/scores.ts), par le serveur (server/) et par le greffon Vite (vite.config.ts).
// JavaScript simple, pour que Node le charge tel quel ; les types sont dans scores-core.d.mts.

/** version du format enregistré (fichier du serveur, localStorage) */
export const SCORES_VERSION = 1;
export const SCORE_LEVELS = ['facile', 'standard', 'avance'];
/** scores conservés par niveau (écran de fin) et scores montrés à l'accueil */
export const BOARD_SIZE = 20;
export const HOME_SIZE = 5;
export const NAME_MAX = 8;
export const DEFAULT_NAME = 'ANONYME';
/** grades de Mission.score(), du meilleur au moins bon */
export const GRADES = ['Tireur d’élite', 'Tireur de précision', 'Tireur confirmé', 'Recrue'];

/**
 * Ce qui borne un score, par niveau : nombre d'objectifs, coefficient du préréglage d'aides (Mission.score) et
 * portée maximale de la carte. tests/scores.test.ts vérifie ces valeurs contre les données des niveaux.
 */
/** Tirs d'adresse (src/game/skill.ts) : points d'un tir en plein centre, d'un tir sur cible en mouvement, plafond par objectif. */
export const SKILL_CENTRE = 250;
export const SKILL_MOVING = 400;
export const SKILL_PER_STEP = 650;

export const LEVEL_RULES = {
  facile: { steps: 8, factor: 1, range: 1500 },
  standard: { steps: 10, factor: 1.2, range: 2600 },
  avance: { steps: 9, factor: 1.5, range: 3200 },
};

/**
 * Bornes d'un score de mission terminée (voir Mission.complete et Mission.score) : chaque objectif vaut de 1 000 à
 * 1 000 + 600 (précision) + 300 (rapidité) + 0,5 point par mètre ; la discrétion ajoute de 0 à 2 000 ; le tout est
 * multiplié par le coefficient du niveau.
 */
export function scoreBounds(level) {
  const r = LEVEL_RULES[level];
  if (!r) return null;
  return { min: Math.floor(r.steps * 1000 * r.factor), max: Math.ceil((r.steps * (1900 + SKILL_PER_STEP + r.range * 0.5) + 2000) * r.factor) };
}

/**
 * Nom de borne d'arcade : majuscules sans accent, lettres, chiffres, espace et tiret, 8 caractères au plus.
 * `partial` (saisie en cours) garde une espace finale pour qu'on puisse taper la suite.
 */
export function cleanName(raw, partial = false) {
  let s = typeof raw === 'string' ? raw : '';
  s = s.slice(0, 64).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  s = s.replace(/[–—_]/g, '-').replace(/[^A-Z0-9 -]/g, '').replace(/ {2,}/g, ' ').replace(/^[ ]+/, '');
  s = s.slice(0, NAME_MAX);
  return partial ? s : s.trim();
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** échappement HTML (les noms sont déjà nettoyés ; ceinture et bretelles avant toute insertion dans la page) */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function emptyBoards() {
  return { facile: [], standard: [], avance: [] };
}

/** score décroissant, puis date croissante : à score égal, le premier inscrit reste devant */
export function compareEntries(a, b) {
  return b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Une ligne relue (fichier, localStorage, réponse du serveur) : rendue propre, ou null si elle est inutilisable. */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name) || DEFAULT_NAME;
  if (!isInt(raw.score, 0, 1e7)) return null;
  const accuracy = typeof raw.accuracy === 'number' && Number.isFinite(raw.accuracy) ? Math.min(1, Math.max(0, raw.accuracy)) : 0;
  return {
    name,
    score: raw.score,
    grade: GRADES.includes(raw.grade) ? raw.grade : GRADES[GRADES.length - 1],
    accuracy: Math.round(accuracy * 10000) / 10000,
    shots: isInt(raw.shots, 0, 1e6) ? raw.shots : 0,
    time: isInt(raw.time, 0, 1e7) ? raw.time : 0,
    date: typeof raw.date === 'string' && ISO.test(raw.date) ? raw.date : '1970-01-01T00:00:00.000Z',
  };
}

/** Classements relus d'un objet quelconque : toujours les trois niveaux, triés, 20 lignes au plus. `ok` : le format était le bon. */
export function normalizeBoards(raw) {
  const boards = emptyBoards();
  const ok = !!raw && typeof raw === 'object' && raw.v === SCORES_VERSION && !!raw.levels && typeof raw.levels === 'object';
  if (ok) {
    for (const id of SCORE_LEVELS) {
      const list = raw.levels[id];
      if (!Array.isArray(list)) continue;
      boards[id] = list.slice(0, 200).map(normalizeEntry).filter(Boolean).sort(compareEntries).slice(0, BOARD_SIZE);
    }
  }
  return { boards, ok };
}

/** Texte enregistré → classements. `corrupt` : texte non vide mais illisible (JSON cassé, autre format). */
export function parseBoards(text) {
  if (typeof text !== 'string' || !text.trim()) return { boards: emptyBoards(), corrupt: false };
  let raw = null;
  try { raw = JSON.parse(text); } catch { return { boards: emptyBoards(), corrupt: true }; }
  const { boards, ok } = normalizeBoards(raw);
  return { boards, corrupt: !ok };
}

export function serializeBoards(boards) {
  return JSON.stringify({ v: SCORES_VERSION, levels: boards });
}

/** rang (à partir de 1) que prendrait un nouveau score : derrière les scores égaux déjà inscrits */
export function rankOf(board, score) {
  let n = 1;
  for (const e of board) if (e.score >= score) n++;
  return n;
}
/** le score entre-t-il dans les 20 du niveau ? */
export const qualifies = (board, score) => rankOf(board, score) <= BOARD_SIZE;

/** Insère une ligne ; renvoie le nouveau classement et le rang obtenu (0 : hors des 20, classement inchangé). */
export function addEntry(board, entry) {
  const rank = rankOf(board, entry.score);
  if (rank > BOARD_SIZE) return { board, rank: 0 };
  const next = board.slice();
  next.splice(rank - 1, 0, entry);
  return { board: next.slice(0, BOARD_SIZE), rank };
}

/** grade compatible avec la précision annoncée ? (mêmes seuils que Mission.score ; l'alerte peut coûter le premier grade) */
function gradeFits(grade, acc) {
  if (grade === GRADES[0]) return acc > 0.85;
  if (grade === GRADES[1]) return acc > 0.6;
  if (grade === GRADES[2]) return acc > 0.35 && acc <= 0.6;
  return acc <= 0.35;
}

/**
 * Contrôle d'une inscription reçue (corps JSON déjà décodé). Le client n'est pas digne de confiance : tout est
 * vérifié ici, et la date est posée par celui qui enregistre. Renvoie la ligne prête à dater, ou le motif du refus.
 */
export function validateSubmission(body) {
  const bad = (error) => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('corps de requête invalide');
  const level = body.level;
  if (typeof level !== 'string' || !SCORE_LEVELS.includes(level)) return bad('niveau inconnu');
  if (typeof body.name !== 'string') return bad('nom manquant');
  const name = cleanName(body.name);
  if (!name) return bad('nom vide');
  const b = scoreBounds(level);
  if (!isInt(body.score, b.min, b.max)) return bad('score hors des bornes du niveau');
  const acc = body.accuracy;
  if (typeof acc !== 'number' || !Number.isFinite(acc) || acc <= 0 || acc > 1) return bad('précision invalide');
  const steps = LEVEL_RULES[level].steps;
  if (!isInt(body.shots, steps, 5000)) return bad('nombre de tirs invalide');
  // chaque objectif validé prend plus de deux secondes ; une partie ne dure pas plus d'une journée
  if (!isInt(body.time, steps * 2, 86400)) return bad('durée invalide');
  if (!GRADES.includes(body.grade) || !gradeFits(body.grade, acc)) return bad('grade incohérent');
  return { ok: true, level, entry: { name, score: body.score, grade: body.grade, accuracy: Math.round(acc * 10000) / 10000, shots: body.shots, time: body.time } };
}
