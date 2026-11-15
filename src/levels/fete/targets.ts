// Cibles du niveau « fete ». Les plaques de réglage sont les plaques communes ; tout le reste vient des mécaniques
// de fête foraine (src/game/extra/fair.ts) : ballons, plaques de la grande roue, silhouettes du manège, cloche du
// tape-fort, globes de la guirlande. Une seule cible bouge : la roue, par à-coups, avec des arrêts francs.
import type { Engine } from '../../core/engine';
import { CarouselFigure, FairBalloon, FairBulb, OrderedSeries, StrikerBell, WheelPlate, type FairCarousel, type FairWheel } from '../../game/extra/fair';
import { SteelPlate, type Target } from '../../game/targets';
import { CAROUSEL, STRIKER, WHEEL, GARLAND } from './map';
import type { Anchors } from './scenery';

export interface FairTargets {
  list: Target[];
  plates: WheelPlate[];
  figures: CarouselFigure[];
  bell: StrikerBell;
  garland: OrderedSeries;
}

const BALLOON_COLORS = [0xd8362c, 0xe9b52c, 0x2f7fb8, 0xd8362c, 0x3f9a6a, 0xe9b52c];
const FIGURE_LABEL = { duck: 'Canard du manège', star: 'Étoile du manège', disc: 'Cible ronde du manège' };

export function buildTargets(e: Engine, A: Anchors, wheel: FairWheel, carousel: FairCarousel): FairTargets {
  const balloons = A.balloons.map((p, i) => new FairBalloon(e, `balloon${i + 1}`, 'Ballon de la baraque', p, BALLOON_COLORS[i % BALLOON_COLORS.length], 1.1, 0.25));
  const plates = WHEEL.plates.map((cabin, i) => new WheelPlate(e, `wheel${i + 1}`, 'Plaque de la grande roue', wheel, cabin, 0.55));
  // six silhouettes sur le devant du plateau, de gauche à droite pour le tireur
  const n = CAROUSEL.figures.length;
  const figures = CAROUSEL.figures.map((shape, i) => new CarouselFigure(e, `figure${i + 1}`, FIGURE_LABEL[shape], carousel, ((i - (n - 1) / 2) * 21 * Math.PI) / 180, shape, 1.5));
  const bell = new StrikerBell(e, 'bell', 'Cloche du tape-fort', A.striker, STRIKER.h, STRIKER.minEnergy);
  const ids = A.bulbs.map((_, i) => `bulb${i + 1}`);
  const garland = new OrderedSeries(ids);
  const bulbs = A.bulbs.map((p, i) => new FairBulb(e, ids[i], `Globe n° ${i + 1} de la guirlande`, p, garland, GARLAND.r));
  const list: Target[] = [
    new SteelPlate(e, 'plate1', 'Plaque carrée', A.plate1, 0.45, false),
    new SteelPlate(e, 'plate2', 'Plaque ronde', A.plate2, 0.6, true),
    ...balloons, ...plates, ...figures, bell, ...bulbs,
  ];
  return { list, plates, figures, bell, garland };
}
