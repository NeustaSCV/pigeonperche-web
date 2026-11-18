// Données de la carte « ville » qui ne viennent pas de public/ville/ : rendu, ciel, vent, arme, règles du mode en ligne.
import type { AtmosphereSpec, LevelPhysics, OnlineSpec, RenderSpec, SkySpec, WindSpec } from '../types';
import { FILES, tileImages } from './data';

/** plancher de référence de `player.teleport` (m) : sous tous les perchoirs */
export const BASE_Y = 150;
/** emplacement de la visite quand `?poste=` est absent */
export const DEFAULT_POSTE = 6;

export const RENDER: RenderSpec = {
  // la photographie lointaine s'étend à 12 km du centre ; les ombres ne servent qu'au tireur et à son perchoir
  cameraFar: 20000, shadowFar: 300, haze: 0.8, treeRange: 0,
  // carte profonde de 4 km : plan proche relevé à l'œil nu, pour la précision de profondeur au loin
  nearEye: 0.5,
};
export const ATMOSPHERE: AtmosphereSpec = { valleyY: 160, mist: 0 };
export const SKY: SkySpec = { clear: 1, cloudShadow: 0, warmth: 0.35, clearUpright: true, sunGlow: 0.25 };   // soleil haut : sans cela l'horizon clair du ciel remonte côté sud
/** vent régulier : ni rafales, ni abri, ni errance (celle-ci est coupée dans `buildSite`, `WindSpec` ne la porte pas) */
export const WIND: WindSpec = { fromBearing: 250, speed: 3, gusts: 0, shelter: 1 };
export const PHYSICS: LevelPhysics = { latitudeDeg: 48.8, altitudeM: 165, temperatureC: 15, coriolis: false, spinDrift: false, aeroJump: false, densityFromAltitude: false };
export const WEAPON = '375ct';
export const RANGE_LIMIT = 4500;
export const DOPE_LIMIT = 3000;
export const ONLINE: OnlineSpec = { standingScope: true, magazine: 3, pulse: false, logbook: false, eyeView: 'first', coarseBothTurrets: true };
export const PRELOAD: string[] = [...Object.values(FILES), 'ville/lointain.jpg', ...tileImages(3)];
