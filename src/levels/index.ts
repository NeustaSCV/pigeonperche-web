// Registre des niveaux. Un dossier src/levels/<id>/ est reconnu tout seul : sa fiche (meta.ts) est chargée d'emblée
// pour le menu, son module (index.ts) seulement quand on joue ce niveau. Aucun fichier commun à modifier pour
// livrer une carte : il suffit que sa fiche porte `ready: true`.
import type { CampaignId, Level, LevelId, LevelMeta } from './types';

/** Toutes les cartes. Les six premières forment les campagnes ; `ville` est hors campagne (mode en ligne), on l'ouvre par `?level=ville`. */
export const LEVEL_IDS: LevelId[] = ['facile', 'standard', 'avance', 'fete', 'phare', 'plaine', 'ville'];

/** Campagnes du menu : trois cartes chacune, de la plus facile à la plus difficile. */
export const CAMPAIGNS: { id: CampaignId; title: string; levels: LevelId[] }[] = [
  { id: 'vallee', title: 'La vallée', levels: ['facile', 'standard', 'avance'] },
  { id: 'lieux', title: 'Lieux oubliés', levels: ['fete', 'phare', 'plaine'] },
];
export const campaignOf = (id: LevelId): CampaignId => CAMPAIGNS.find((c) => c.levels.includes(id))?.id ?? 'vallee';

/** Fiches provisoires des niveaux dont le dossier n'est pas encore livré. */
const SOON: Record<LevelId, LevelMeta> = {
  facile: { id: 'facile', title: 'Facile', tagline: 'Tir de précision', note: 'Carte d’initiation, aides au tir complètes. À venir.', difficulty: 'assist', ready: false },
  standard: { id: 'standard', title: 'Standard', tagline: 'Tir de précision', note: 'À venir.', difficulty: 'standard', ready: false },
  avance: { id: 'avance', title: 'Avancé', tagline: 'Tir de précision', note: 'Tirs jusqu’à 2 500 m, aucune aide. À venir.', difficulty: 'real', ready: false },
  fete: { id: 'fete', title: 'Facile', name: 'La Fête foraine', campaign: 'lieux', tagline: 'Tir de précision', note: 'À venir.', difficulty: 'assist', ready: false },
  phare: { id: 'phare', title: 'Standard', name: 'Le Phare', campaign: 'lieux', tagline: 'Tir de précision', note: 'À venir.', difficulty: 'standard', ready: false },
  plaine: { id: 'plaine', title: 'Avancé', name: 'Le Château d’eau', campaign: 'lieux', tagline: 'Tir de précision', note: 'À venir.', difficulty: 'real', ready: false },
  ville: { id: 'ville', title: 'Ville nouvelle', tagline: 'Tir de précision', note: 'À venir.', difficulty: 'standard', ready: false },
};

const metas = import.meta.glob<{ meta: LevelMeta }>('./*/meta.ts', { eager: true });
const modules = import.meta.glob<{ level: Level }>('./*/index.ts');

export interface LevelEntry {
  id: LevelId;
  meta: LevelMeta;
  /** carte livrée : fiche prête et module présent */
  playable: boolean;
}

export const LEVELS: LevelEntry[] = LEVEL_IDS.map((id) => {
  const meta = metas[`./${id}/meta.ts`]?.meta ?? SOON[id];
  return { id, meta, playable: meta.ready && `./${id}/index.ts` in modules };
});

export const levelEntry = (id: string | null | undefined): LevelEntry | undefined => LEVELS.find((l) => l.id === id);
export const isPlayable = (id: string | null | undefined): id is LevelId => !!levelEntry(id)?.playable;

/** Niveau proposé d'emblée : « facile » dès qu'il est livré, « standard » d'ici là. */
export const DEFAULT_LEVEL: LevelId = isPlayable('facile') ? 'facile' : 'standard';

/**
 * Niveau à jouer : `?level=<id>`, sinon le dernier choisi au menu, sinon le niveau par défaut.
 * `?level=<id>` charge aussi un niveau en chantier (module présent, fiche pas encore `ready`) : c'est ainsi qu'on l'essaie.
 */
export function resolveLevelId(params: URLSearchParams): LevelId {
  const asked = params.get('level');
  if (asked && LEVEL_IDS.includes(asked as LevelId) && `./${asked}/index.ts` in modules) return asked as LevelId;
  let saved: string | null = null;
  try { saved = localStorage.getItem('hr.level'); } catch { /* stockage indisponible */ }
  return isPlayable(saved) ? saved : DEFAULT_LEVEL;
}

export async function loadLevel(id: LevelId): Promise<Level> {
  const load = modules[`./${id}/index.ts`];
  if (!load) throw new Error(`niveau « ${id} » : src/levels/${id}/index.ts introuvable`);
  const m = await load();
  if (m.level.data.id !== id) throw new Error(`niveau « ${id} » : data.id vaut « ${m.level.data.id} »`);
  return m.level;
}

/** Change de niveau : le choix est mémorisé et la page rechargée avec `?level=<id>` (les autres paramètres sont gardés). */
export function switchLevel(id: LevelId): void {
  try { localStorage.setItem('hr.level', id); } catch { /* stockage indisponible */ }
  const url = new URL(location.href);
  url.searchParams.set('level', id);
  // on revient au menu du nouveau niveau, pas en pleine partie
  url.searchParams.delete('play');
  url.searchParams.delete('step');
  location.assign(url.toString());
}

/**
 * Cohérence d'un niveau une fois ses cibles construites : renvoie la liste des défauts (vide si tout va bien).
 * Le jeu refuse de démarrer un niveau incohérent, avec ces messages.
 */
export function checkLevel(d: Level['data'], targetIds: string[], weaponIds: string[]): string[] {
  const bad: string[] = [];
  const posts = Object.keys(d.posts);
  if (!d.steps.length) bad.push('aucun objectif (steps)');
  for (const s of d.steps) {
    for (const t of s.targets) if (!targetIds.includes(t)) bad.push(`objectif « ${s.id} » : cible « ${t} » absente de buildTargets()`);
    const p = d.stepPost[s.id];
    if (p !== undefined && !posts.includes(p)) bad.push(`objectif « ${s.id} » : poste conseillé « ${p} » inconnu`);
  }
  for (const l of d.sightlines) if (!posts.includes(l.post)) bad.push(`ligne de visée : poste « ${l.post} » inconnu`);
  if (!weaponIds.length) bad.push('aucune arme connue dans weapons');
  if (d.tutorial) {
    if (!posts.includes(d.tutorial.post)) bad.push(`tutoriel : poste « ${d.tutorial.post} » inconnu`);
    for (const t of [d.tutorial.near, d.tutorial.far]) if (!targetIds.includes(t)) bad.push(`tutoriel : cible « ${t} » absente`);
  }
  for (const p of d.testPlan) {
    if (!posts.includes(p.post)) bad.push(`testPlan « ${p.step} » : poste « ${p.post} » inconnu`);
    if (!d.steps.some((s) => s.id === p.step)) bad.push(`testPlan : objectif « ${p.step} » inconnu`);
  }
  return bad;
}
