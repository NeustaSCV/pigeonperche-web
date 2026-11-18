// Fiche de la carte « ville ». Carte hors campagne : elle n'apparaît ni au menu des campagnes ni dans les tableaux
// de scores du solo ; on l'ouvre par `?level=ville`. Fichier minuscule, chargé d'emblée : pas d'import de code.
import type { LevelMeta } from '../types';

export const meta: LevelMeta = {
  id: 'ville',
  title: 'Ville nouvelle',
  tagline: 'une ville, trente-neuf emplacements en hauteur',
  note: 'Carte du mode en ligne. Tireurs fixes, de 600 à 2 800 m.',
  difficulty: 'standard',
  ready: true,
};
