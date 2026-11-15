// Cibles du niveau « Le Phare ». Tout est du matériel : plaque de réglage, feux des bouées du chenal, boîtier du treuil
// de la grue, antenne et projecteur du caboteur, bidon de la barge, moteur du canot, lanterne de la tourelle.
// Une seule cible se déplace : le canot, qui marque un arrêt franc à chaque point de sa route. Les bouées et le
// caboteur sont tenus par leurs corps-morts : ils ne bougent que de quelques centimètres avec la houle.
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { Engine } from '../../core/engine';
import { BUOY_LAMP_Y, CarriedTarget, Floater, Runner, buoyGeometry, hullGeometry, paintMesh, painter, skiffGeometry, tint } from '../../game/extra/sea-targets';
import { FuelDrum, SteelPlate, type Target } from '../../game/targets';
import type { Swell } from '../../world/sea';
import type { LevelHost } from '../types';
import { BARGE, BEACON, BUOYS, CRANE, ISLET, QUAY, SEA_LEVEL, SHIP, SKIFF, bargeAt } from './map';

/** Part de la houle transmise aux flotteurs : bouées et caboteur sont bridés par leur mouillage. */
const FOLLOW = { buoy: 0.12, ship: 0.06, skiff: 0.1 };

const glow = (r: number, g: number, b: number): MeshBasicMaterial => new MeshBasicMaterial({ color: new Color(r, g, b) });

/** Feu de bouée ou de tourelle : cage sombre et verre lumineux (le verre s'éteint quand le feu est touché). */
function lamp(engine: Engine, r: number, color: [number, number, number]): { mesh: Group; lit: Mesh } {
  const g = new Group();
  const gb = painter();
  tint(gb, 0x24272a);
  gb.cyl(0, -r * 1.25, 0, r * 0.95, r * 0.95, r * 0.3, 10, 1, true);
  gb.cyl(0, r * 0.95, 0, r * 0.95, r * 0.25, r * 0.5, 10, 1, true);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; gb.box(Math.cos(a) * r * 0.9, 0, Math.sin(a) * r * 0.9, 0.03, r * 2, 0.03); }
  g.add(paintMesh(engine, gb));
  const lit = new Mesh(new SphereGeometry(r * 0.82, 12, 8), glow(...color));
  g.add(lit);
  return { mesh: g, lit };
}

export interface PhareTargets {
  list: Target[];
  /** porteurs (bouées, caboteur, canot) : à ajouter à la scène */
  carriers: Group;
  skiff: Runner;
  /** cible du canot (son moteur) */
  motor: CarriedTarget;
}

export function buildTargets(h: LevelHost, swell: Swell): PhareTargets {
  const e = h.engine;
  const carriers = new Group();
  const list: Target[] = [];
  const fixed = (x: number, z: number, heading = 0): Floater => new Floater({ x, z, level: 0, swell: null, heading });

  // --- 1. plaque de réglage sur l'îlot ---
  list.push(new SteelPlate(e, 'reglage', 'Plaque de réglage', new Vector3(ISLET.x, h.terrain.heightAt(ISLET.x, ISLET.z), ISLET.z), 0.45, false));

  // --- 2. bouées du chenal : la cible est le feu ---
  for (const B of BUOYS) {
    const c = new Floater({ x: B.x, z: B.z, level: SEA_LEVEL, swell, follow: FOLLOW.buoy, tilt: 1 });
    const gb = painter();
    buoyGeometry(gb, B.color, B.shape);
    c.group.add(paintMesh(e, gb));
    carriers.add(c.group);
    const L = lamp(e, 0.2, B.shape === 'can' ? [9, 1.2, 0.8] : [1.0, 8, 2.2]);
    list.push(new CarriedTarget({ id: B.id, label: B.label, carrier: c, local: new Vector3(0, BUOY_LAMP_Y, 0), r: 0.21, kind: 'glass', mesh: L.mesh, lit: L.lit, note: 'Feu éteint.' }));
  }

  // --- 3. boîtier de commande du treuil, sur son poteau au pied de la grue, tourné vers le phare ---
  {
    const x = CRANE.x - 6.2, z = CRANE.z + 2.9;
    const c = fixed(x, z, Math.atan2(-z, x));
    const gb = painter();
    tint(gb, 0xe2b714);
    gb.box(0, 0, 0, 0.2, 0.56, 0.46);
    tint(gb, 0x1c1f22);
    gb.box(-0.105, 0.12, 0, 0.02, 0.16, 0.3);
    tint(gb, 0xb3261e);
    gb.box(-0.105, -0.12, 0.08, 0.03, 0.1, 0.1);
    list.push(new CarriedTarget({
      id: 'treuil', label: 'Boîtier de commande du treuil', carrier: c, local: new Vector3(-0.06, QUAY.top + 1.75, 0), half: new Vector3(0.1, 0.28, 0.23),
      kind: 'electric', minEnergy: 200, weakNote: 'Le boîtier a encaissé : pas assez d’énergie à cette distance.', note: 'Treuil bloqué.', mesh: paintMesh(e, gb),
    }));
  }

  // --- 4. caboteur au mouillage : antenne radio sur la timonerie, projecteur de pont sur le mât de charge ---
  {
    const c = new Floater({ x: SHIP.x, z: SHIP.z, level: SEA_LEVEL, swell, follow: FOLLOW.ship, tilt: 1, heading: SHIP.heading });
    const gb = painter();
    const A = hullGeometry(gb, SHIP.length, SHIP.beam, 0x1f3a52);
    // mâtereau de l'antenne et console du projecteur
    tint(gb, 0xd8d8d8);
    gb.box(A.roof.x, A.roof.y + 0.75, A.roof.z, 0.07, 1.5, 0.07);
    gb.box(A.mast.x - 0.5, A.mast.y - 1.5, 0, 0.9, 0.08, 0.08);
    c.group.add(paintMesh(e, gb));
    carriers.add(c.group);
    const ab = painter();
    tint(ab, 0xa9afb3);
    ab.box(0, 0, 0, 0.36, 0.6, 0.5);
    tint(ab, 0xd8d8d8);
    ab.box(0, 0.75, 0, 0.04, 0.9, 0.04);
    ab.box(0, 0.95, 0, 0.03, 0.03, 0.9);
    const led = new Mesh(new SphereGeometry(0.05, 8, 6), glow(6, 0.4, 0.3));
    led.position.set(0, 0.2, 0.27);
    const am = new Group();
    am.add(paintMesh(e, ab), led);
    list.push(new CarriedTarget({
      id: 'antenne', label: 'Émetteur radio du caboteur', carrier: c, local: new Vector3(A.roof.x, A.roof.y + 1.8, A.roof.z), half: new Vector3(0.18, 0.3, 0.25),
      kind: 'electric', minEnergy: 150, weakNote: 'Le boîtier a encaissé : pas assez d’énergie à cette distance.', note: 'Radio hors service.', mesh: am, lit: led,
    }));
    const pg = new Group();
    const body = painter();
    tint(body, 0x2e3134);
    body.cyl(0, -0.3, 0, 0.3, 0.3, 0.6, 12, 1, true);
    const bm = paintMesh(e, body);
    bm.rotation.z = Math.PI / 2;
    pg.add(bm);
    const lens = new Mesh(new CylinderGeometry(0.27, 0.27, 0.04, 16), glow(12, 10.5, 8));
    lens.rotation.z = Math.PI / 2;
    lens.position.x = -0.31;
    const lens2 = lens.clone();
    lens2.position.x = 0.31;
    const lit = new Group();
    lit.add(lens, lens2);
    pg.add(lit);
    list.push(new CarriedTarget({ id: 'projecteur', label: 'Projecteur de pont du caboteur', carrier: c, local: new Vector3(A.mast.x - 0.95, A.mast.y - 1.5, 0), r: 0.33, kind: 'glass', mesh: pg, lit, note: 'Projecteur éteint.' }));
  }

  // --- 5. barge de ravitaillement : un bidon de carburant sous l'abri, visible du musoir seulement ---
  {
    const p = bargeAt(BARGE.drum.s, BARGE.drum.f);
    const d = new FuelDrum(e, new Vector3(p.x, BARGE.deck, p.z));
    d.label = 'Bidon de carburant de la barge';
    list.push(d);
  }

  // --- 6. le canot : la seule cible qui se déplace ; arrêt franc à chaque point de sa route ---
  const skiff = new Runner({ level: SEA_LEVEL, swell, follow: FOLLOW.skiff, tilt: 1 }, SKIFF.route, SKIFF.speed);
  const sg = painter();
  const S = skiffGeometry(sg, 5.6, 0xd96a1e);
  skiff.group.add(paintMesh(e, sg));
  carriers.add(skiff.group);
  const hit = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshBasicMaterial({ visible: false }));
  const motor = new CarriedTarget({
    id: 'canot', label: 'Moteur du canot', carrier: skiff, local: S.motor, half: S.half, kind: 'metal', minEnergy: 250,
    weakNote: 'Le capot a encaissé : pas assez d’énergie à cette distance.', note: 'Moteur détruit : le canot dérive.', mesh: hit,
    onDone: (_h, ctx) => {
      skiff.halt(ctx.time);
      const p = skiff.worldAt(S.motor, ctx.time, new Vector3());
      ctx.fx.addEmitter(p, 5, { speed: 0.5, up: 1.6, life: 5, size: [0.5, 4], color: 0x2a2a2a, alpha: 0.55, drag: 0.3, wind: 1 });
    },
  });
  list.push(motor);

  // --- 7. tourelle de la passe : la lanterne ---
  {
    const c = fixed(BEACON.x, BEACON.z);
    const L = lamp(e, 0.36, [9, 8.2, 5.5]);
    list.push(new CarriedTarget({ id: 'passe', label: 'Lanterne de la tourelle de la passe', carrier: c, local: new Vector3(0, BEACON.height, 0), half: new Vector3(0.36, 0.45, 0.36), kind: 'glass', mesh: L.mesh, lit: L.lit, note: 'La passe est éteinte.' }));
  }

  return { list, carriers, skiff, motor };
}
