// Manipulation de l'arme en main : mouvement du verrou, du chargeur (ou de la cartouche d'une arme à un coup),
// et points où le tireur pose ses mains. Tout part des repères du modèle (`anchors` : grip, forend, bolt_handle, mag),
// donc le geste va là où le levier se trouve réellement — derrière la poignée sur un bullpup.
import { Vector3 } from 'three';
import type { Rig } from '../player/character';
import type { Rifle, RifleParts } from './rifle';

/** Cibles des mains, dans le repère de l'arme. */
export interface HandTargets {
  /** main droite : poignée, levier de culasse pendant le réarmement, cartouche pendant le rechargement à un coup */
  right: Vector3;
  /** main gauche au repos : sous le fût (accroupi, debout) ou sous le talon de la crosse (couché, arme sur bipied) */
  left: Vector3;
  /** main gauche pendant un changement de chargeur, et poids de ce geste (0..1) */
  leftMag: Vector3;
  magW: number;
}

const out: HandTargets = { right: new Vector3(), left: new Vector3(), leftMag: new Vector3(), magW: 0 };
const knob = new Vector3(), cart = new Vector3(), tmp = new Vector3(), eye = new Vector3(), sh = new Vector3();
const sm = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** course de la culasse : réarmement normal, et rechargement à un coup (il faut la place d'une cartouche entière) */
const SINGLE_TRAVEL = 0.12;
const LIFT = 1.05;

/**
 * Anime le verrou et le chargeur de `parts` selon l'état de `rifle`, et renvoie les cibles des mains (objet réutilisé).
 * Réarmement (boltPhase) : la main quitte la poignée (0 → 0,09), lève le levier (0,07 → 0,18), tire la culasse
 * (0,17 → 0,38), la repousse (0,44 → 0,66), rabat le levier (0,66 → 0,80) et revient à la poignée (0,82 → 0,98).
 */
export function handleRifle(parts: RifleParts, rifle: Rifle, prone: boolean): HandTargets {
  const a = parts.anchors;
  const ph = rifle.boltPhase;
  const rp = rifle.reloadPhase;
  const loading = rifle.single && rp < 1;
  let lift = 0, back = 0, travel = rifle.def.barrelMm > 600 ? 0.095 : 0.075;
  if (loading) {
    lift = sm(0.06, 0.13, rp) * (1 - sm(0.87, 0.94, rp));
    back = sm(0.12, 0.22, rp) * (1 - sm(0.76, 0.88, rp));
    travel = SINGLE_TRAVEL;
  } else if (ph > 0) {
    lift = sm(0.07, 0.18, ph) * (1 - sm(0.66, 0.8, ph));
    back = sm(0.17, 0.38, ph) * (1 - sm(0.44, 0.66, ph));
  }
  parts.bolt.rotation.z = -lift * LIFT;
  parts.bolt.position.z = parts.boltRest.z - back * travel;
  // boule du levier dans le repère de l'arme (elle tourne et recule avec la culasse) ; la paume la coiffe par l'extérieur
  const kx = a.bolt_handle.x - parts.boltRest.x, ky = a.bolt_handle.y - parts.boltRest.y;
  const c = Math.cos(-lift * LIFT), s = Math.sin(-lift * LIFT);
  const grow = 1 + 0.018 / Math.max(0.02, Math.hypot(kx, ky));
  knob.set(parts.boltRest.x + (kx * c - ky * s) * grow, parts.boltRest.y + (kx * s + ky * c) * grow, a.bolt_handle.z - back * travel);

  // --- main droite ---
  const right = out.right.copy(a.grip);
  if (loading) {
    // arme à un coup : culasse ouverte, la main va chercher une cartouche, la présente au-dessus de la fenêtre, la
    // couche dans l'auget ; la culasse la pousse en chambre en se refermant
    const seat = parts.magRest;
    const push = sm(0.76, 0.88, rp);
    cart.set(seat.x - 0.2, seat.y - 0.1, seat.z - 0.2);
    cart.lerp(tmp.set(seat.x - 0.06, seat.y + 0.04, seat.z), sm(0.36, 0.52, rp));
    cart.lerp(seat, sm(0.52, 0.6, rp));
    cart.z += push * (SINGLE_TRAVEL - 0.01);
    parts.magazine.position.copy(cart);
    parts.magazine.visible = rp >= 0.36 && push < 0.97;
    if (rp < 0.24) right.lerp(knob, sm(0, 0.07, rp));
    else if (rp < 0.64) right.copy(knob).lerp(tmp.set(cart.x - 0.03, cart.y + 0.012, cart.z - 0.015), sm(0.24, 0.36, rp));
    else if (rp < 0.94) right.set(seat.x - 0.03, seat.y + 0.012, seat.z - 0.015).lerp(knob, sm(0.64, 0.76, rp));
    else right.copy(knob).lerp(a.grip, sm(0.94, 1, rp));
  } else {
    if (parts.single) { parts.magazine.visible = false; parts.magazine.position.copy(parts.magRest); }
    if (ph > 0) {
      const h = sm(0, 0.09, ph) * (1 - sm(0.82, 0.98, ph));
      right.lerp(knob, h);
      // la main contourne l'arme par la droite plutôt que de la traverser
      right.x -= 0.03 * 4 * h * (1 - h);
    }
  }

  // --- chargeur : la main gauche le saisit (0 → 0,10), le sort dans son axe (0,10 → 0,20), l'emporte (0,20 → 0,30),
  //     rapporte le suivant (0,42 → 0,52), l'engage (0,52 → 0,65) et retourne sous le fût (0,68 → 0,85)
  out.magW = 0;
  if (!parts.single) {
    const m = parts.magazine;
    m.position.copy(parts.magRest);
    m.visible = true;
    if (rp < 1) {
      const pull = sm(0.1, 0.2, rp) * (1 - sm(0.52, 0.65, rp));
      const away = sm(0.2, 0.3, rp) * (1 - sm(0.42, 0.52, rp));
      const side = Math.abs(parts.magOut.x) > Math.abs(parts.magOut.y);
      m.position.addScaledVector(parts.magOut, pull);
      // vers la poche du tireur : en arrière, du côté gauche
      m.position.x += (side ? 0.05 : 0.14) * away;
      m.position.y += (side ? -0.06 : 0.02) * away;
      m.position.z -= 0.3 * away;
      m.visible = away < 0.9;
      out.magW = sm(0, 0.1, rp) * (1 - sm(0.68, 0.85, rp));
      out.leftMag.copy(m.position).addScaledVector(tmp.copy(parts.magOut).normalize(), 0.035);
    }
  }
  // --- main gauche au repos : sous le fût, sans tendre le bras au-delà de sa portée ; couché, l'arme repose sur son
  //     bipied et la main gauche cale le talon de la crosse (le passage de l'un à l'autre est lissé)
  const hs = parts.hands;
  hs.prone += ((prone ? 1 : 0) - hs.prone) * 0.15;
  out.left.set(a.forend.x, a.forend.y - 0.025, Math.min(a.forend.z, a.grip.z + 0.32));
  if (hs.prone > 0.001) out.left.lerp(tmp.set(a.butt.x + 0.02, a.butt.y - 0.085, a.butt.z + 0.09), hs.prone);
  return out;
}

/**
 * Position de l'arme épaulée dans le repère du groupe du personnage : la lunette à hauteur de l'œil du tireur dans sa
 * pose courante, à distance d'œil, la plaque de couche au creux de l'épaule droite (jamais plus de 10 cm derrière
 * l'articulation, ni plus de 5 cm devant). Renvoie [hauteur, avancée] de l'origine de l'arme ; couché, seule
 * l'avancée sert (la hauteur vient du bipied posé au sol).
 */
export function shoulderMount(rig: Rig, parts: RifleParts): [number, number] {
  const a = parts.anchors;
  rig.toGroup(rig.head, eye.set(0, 0.15, 0.1));
  rig.toGroup(rig.spine, sh.copy(rig.armR.position));
  const butt = Math.min(sh.z + 0.05, Math.max(sh.z - 0.1, eye.z - a.eye.z + a.butt.z));
  return [eye.y - a.eye.y, butt - a.butt.z];
}
