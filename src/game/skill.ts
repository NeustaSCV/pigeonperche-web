// Tirs d'adresse : un bonus et un compliment quand le tireur touche en plein centre, ou touche une cible en plein
// mouvement plutôt qu'à l'arrêt. Fonctions pures, testées dans tests/skill.test.ts ; l'affichage est dans src/ui/praise.ts.
import { SKILL_CENTRE, SKILL_MOVING } from '../shared/scores-core.mjs';

/** écart au centre, en fraction de la demi-taille de la zone touchée, en deçà duquel le tir est « plein centre » */
export const CENTRE_MAX = 0.25;
/** vitesse de la cible à l'impact, m/s, à partir de laquelle elle est « en mouvement » (un chariot roule à 1,2 m/s) */
export const MOVING_MIN = 0.3;

export interface SkillShot {
  centre: boolean;
  moving: boolean;
  /** points de bonus (avant le plafond de la mission) */
  bonus: number;
  /** compliment affiché au tireur */
  title: string;
}

const PRAISE = {
  both: ['Tir de maître !', 'Magistral !', 'Coup de maître !'],
  centre: ['Plein centre !', 'Dans le mille !', 'En plein centre !', 'Pile au centre !'],
  moving: ['Touché en plein mouvement !', 'Belle avance !', 'Bien anticipé !'],
};

/**
 * Juge un tir au but. `offset` : écart au centre de la zone touchée (0 = centre, 1 = bord), null si inconnu ;
 * `speed` : vitesse de la cible à l'impact, m/s ; `pick` : tirage 0..1 pour varier le compliment.
 * Renvoie null pour un tir ordinaire.
 */
export function assessHit(offset: number | null, speed: number, pick = Math.random()): SkillShot | null {
  const centre = offset !== null && Number.isFinite(offset) && offset <= CENTRE_MAX;
  const moving = Number.isFinite(speed) && speed >= MOVING_MIN;
  if (!centre && !moving) return null;
  const list = centre && moving ? PRAISE.both : centre ? PRAISE.centre : PRAISE.moving;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(pick) ? pick : 0) * list.length)));
  return { centre, moving, bonus: (centre ? SKILL_CENTRE : 0) + (moving ? SKILL_MOVING : 0), title: list[i] };
}

/** Sous-titre du compliment : ce qui a valu le bonus, et les points accordés. */
export function skillDetail(s: SkillShot, points: number, distance: number): string {
  const why = s.centre && s.moving ? 'plein centre, cible en mouvement' : s.centre ? 'plein centre' : 'cible en mouvement';
  const far = distance >= 1000 ? ` · à ${(distance / 1000).toFixed(1).replace('.', ',')} km` : '';
  return points > 0 ? `+${points} points · ${why}${far}` : `${why}${far}`;
}
