// Cibles du niveau « standard » et leur placement sur les points d'ancrage du décor.
import type { Engine } from '../../core/engine';
import { Balloon, Drone, FuelDrum, Market, Padlock, RelayFeed, Searchlight, Sentinel, SteelPlate, Vehicle, type Target } from '../../game/targets';
import type { Fx } from '../../world/fx';
import type { Terrain } from '../../world/terrain';
import { PATROL_RANGE } from './map';
import type { Anchors } from './scenery';

export interface StandardTargets {
  /** toutes les cibles, dans l'ordre des objectifs */
  list: Target[];
  market: Market;
  vehicle: Vehicle;
  drone: Drone;
}

export function buildTargets(e: Engine, A: Anchors, terrain: Terrain, fx: Fx): StandardTargets {
  const drone = new Drone(e, A.drone);
  // la route de meta.json compte 16 points par tronçon de ROAD
  const vehicle = new Vehicle(e, terrain, fx, [PATROL_RANGE[0] * 16, PATROL_RANGE[1] * 16]);
  const market = new Market(e, A, terrain);
  const list: Target[] = [
    new SteelPlate(e, 'plate1', 'Plaque carrée', A.plate1, 0.45, false),
    new SteelPlate(e, 'plate2', 'Plaque ronde', A.plate2, 0.6, true),
    new Balloon(e, A.balloon),
    new RelayFeed(e, A.relayFeed),
    new Searchlight(e, A.searchlight),
    new FuelDrum(e, A.drum),
    new Padlock(e, A),
    drone,
    new Sentinel(e, A),
    vehicle,
    market,
  ];
  return { list, market, vehicle, drone };
}
