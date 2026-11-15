// Cibles du niveau « Le Château d'eau » : émetteur du relais (cible commune du jeu), trois volants de vanne, signal
// de la voie, plaque du wagon-citerne (convoi qui s'arrête), drone en point fixe, lunette du théâtre, horloge de la
// gare. Les mécaniques sont dans src/game/extra/sabotage.ts ; ici, seulement leur placement.
import { Vector3 } from 'three';
import { ClockFace, GlintScope, HoverDrone, RailSignal, Stealth, Track, Train, Valve } from '../../game/extra/sabotage';
import { RelayFeed, type Target } from '../../game/targets';
import type { LevelHost } from '../types';
import { ALERT, BUILDINGS, DECKS, GAP, PLAIN, POSTS, SIGNAL, SIZES, TARGETS, TRAIN, polar, targetXZ } from './map';

export interface PlaineTargets {
  list: Target[];
  relay: RelayFeed;
  valves: Valve[];
  signal: RailSignal;
  train: Train;
  /** abscisse de la trouée sur la voie : le wagon marqué s'y range */
  gapS: number;
  drone: HoverDrone;
  glint: GlintScope;
  clock: ClockFace;
  stealth: Stealth;
}

/** Point d'un bâtiment de la banque (repère local) dans le monde : bâtiment posé, sinon position calculée. */
function onBuilding(h: LevelHost, name: string, lx: number, ly: number, lz: number): Vector3 {
  const b = h.buildings?.get(name);
  if (b) return b.toWorld(lx, ly, lz);
  const s = BUILDINGS.find((q) => q.name === name)!;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return new Vector3(s.x + lx * c + lz * sn, s.groundY + ly, s.z - lx * sn + lz * c);
}

export function buildTargets(h: LevelHost): PlaineTargets {
  const e = h.engine, T = TARGETS;
  const H = (x: number, z: number): number => h.terrain.heightAt(x, z);

  // --- émetteur du relais : en haut de son mât, sur le toit-terrasse de la médiathèque ---
  const D = DECKS.mediatheque;
  const relay = new RelayFeed(e, onBuilding(h, 'mediatheque', D.x, D.y + SIZES.relay.mast, D.z));
  // (son mât et son panneau blanc sont du décor fixe : scenery.ts, dans les collisions)

  // --- vannes : trois volants côte à côte, en travers de la ligne de visée ---
  const V = targetXZ('vannes');
  const side = polar(T.vannes.bearing + 90, SIZES.valve.gap);
  const face = POSTS[T.vannes.post];
  const valves = [-1, 0, 1].map((i) => new Valve(e, 'vanne' + (i + 2), `Vanne n° ${i + 2}`, new Vector3(V.x + side.x * i, T.vannes.alt, V.z + side.z * i), face, SIZES.valve.d));

  // --- signal de la voie ---
  const signal = new RailSignal(e, 'signal', T.signal.label, new Vector3(SIGNAL.x, H(SIGNAL.x, SIGNAL.z), SIGNAL.z), POSTS.est, SIZES.signal.w, SIZES.signal.h, T.signal.alt - H(SIGNAL.x, SIGNAL.z));

  // --- convoi : sur la voie du relief (meta.ways), dans le secteur du triage ---
  const rail = (h.terrain.meta.ways ?? []).find((w) => w.name === 'voie ferrée');
  const pts: Vector3[] = [];
  if (rail) for (const p of rail.line) if (Math.hypot(p[0] - GAP.x, p[1] - GAP.z) < 800) pts.push(new Vector3(p[0], Math.max(H(p[0], p[1]), h.terrain.meshHeightAt(p[0], p[1])) + 0.06, p[1]));
  if (pts.length < 2) for (let z = -500; z <= 1000; z += 20) pts.push(new Vector3(GAP.x, PLAIN + 0.06, GAP.z + z));
  const track = new Track(pts);
  const gapS = track.nearest(GAP.x, GAP.z);
  const train = new Train(e, 'wagon', T.wagon.label, track, {
    cars: [
      { kind: 'loco', length: 16, color: 0x2f5d7c }, { kind: 'box', length: 14, color: 0x7a4a36 }, { kind: 'flat', length: 14, color: 0xa8552e },
      { kind: 'tank', length: 14, color: 0xb9bcc0 }, { kind: 'box', length: 14, color: 0x5d6b4a }, { kind: 'tank', length: 14, color: 0x3c4043 },
    ],
    speed: TRAIN.speed, accel: TRAIN.accel, pause: TRAIN.pause,
    shuttle: [gapS + TRAIN.shuttle[0], gapS + TRAIN.shuttle[1]], start: gapS + TRAIN.shuttle[0],
    marked: 3, plateToward: POSTS.est, plateSize: SIZES.plate.s, plateY: SIZES.plate.y,
  });

  // --- drone : point fixe au-dessus de la villa ---
  const dp = targetXZ('drone');
  const villaRoof = (h.buildings?.get('villa')?.groundY ?? PLAIN) + DECKS.villa.y;
  const drone = new HoverDrone(e, 'drone', T.drone.label, new Vector3(dp.x, T.drone.alt, dp.z), POSTS.sud, SIZES.drone.w, SIZES.drone.h, villaRoof);

  // --- lunette de surveillance : sur le faîtage du théâtre ---
  const Dt = DECKS.theatre;
  const glint = new GlintScope(e, 'lunette', T.lunette.label, onBuilding(h, 'theatre', Dt.x, Dt.y + SIZES.glint.y, Dt.z), POSTS.nord, SIZES.glint.d, SIZES.glint.y);

  // --- horloge de la gare ---
  const Dg = DECKS.gare;
  const gare = BUILDINGS.find((b) => b.name === 'gare')!;
  const clock = new ClockFace(e, 'horloge', T.horloge.label, onBuilding(h, 'gare', Dg.x, Dg.y, Dg.z), gare.yaw, SIZES.clock.d);

  const stealth = new Stealth(ALERT);
  return { list: [relay, ...valves, signal, train, drone, glint, clock], relay, valves, signal, train, gapS, drone, glint, clock, stealth };
}
