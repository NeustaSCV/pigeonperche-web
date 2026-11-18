// Ville nouvelle : place définitive des emplacements. Le fichier public/ville/emplacements.json donne une position
// approchée (celle que le serveur connaît, à 40 m près) ; le jeu la déplace pour que le tireur tienne debout sur un
// perchoir dessiné : sommet d'une grue, point haut d'un toit-terrasse, cabane à côté du tronc. Même calcul que la
// page d'origine, sans rien dessiner : il est vérifié par tests/ville-world.test.ts.
import { CRANE_H, EYE, type Emplacement, type Grue, type VilleWorld } from './data';

/** emplacements gardés à la place de trois anciens postes relevés à la main : numéro → clé de meta.postes */
const KEPT: Record<number, string> = { 6: 'theatre', 9: 'edison', 17: 'pres' };
/** bord de toit relevé à la main pour l'emplacement n° 9 (absent de meta.json) */
const KEPT_EXTRA: Record<string, [number, number, number]> = { edison: [314.5, 183.4, 230.5] };

export function placeEmplacements(w: VilleWorld): { emp: Emplacement[]; grues: Grue[] } {
  const { raw } = w;
  const emp: Emplacement[] = raw.emplacements.map((e) => ({ ...e, grue: false, ox: 0, oz: 0, x0: e.x, z0: e.z }));
  const grues: Grue[] = raw.meta.grues.map((g) => ({ ...g }));

  // grues : on reprend celles déjà posées à moins de 15 m, on dresse les autres à côté de l'emplacement
  for (const e of emp) if (e.type === 'grue') {
    const c = grues.find((q) => Math.hypot(q.x - e.x, q.z - e.z) < 15);
    if (c) c.nom = e.nom;
    else grues.push({ nom: e.nom, x: e.x + 24, z: e.z + 10, sol: w.groundY(e.x + 24, e.z + 10), cap: 200 });
  }
  // le tireur est debout sur la plateforme du sommet, dans l'axe du mât
  for (const c of grues) {
    const e = emp.find((q) => q.nom === c.nom);
    if (e) { e.x = c.x; e.z = c.z; e.y = c.sol + CRANE_H + 13.26; e.grue = true; }
  }

  // trois toits gardent la place relevée à la main, sur un petit échafaudage de 1,5 m
  const postes: Record<string, [number, number, number]> = { ...raw.meta.postes, ...KEPT_EXTRA };
  for (const e of emp) {
    const p = postes[KEPT[e.n]];
    if (p) { e.x = p[0]; e.y = p[1] + 1.5; e.z = p[2]; }
  }

  // toits-terrasses : sur le toit du modèle le plus haut à moins de 8 m, à 90 cm au moins d'un bord ;
  // l'œil est à 3,1 m au-dessus (échafaudage de 1,5 m, puis le tireur)
  const stable = (x: number, z: number, t: number): boolean => [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]].every(([a, b]) => Math.abs(w.roofAt(x + a, z + b) - t) < 0.3);
  for (const e of emp) if (e.type === 'toit' && !e.grue) {
    let best: [number, number, number] = [w.roofAt(e.x, e.z), e.x, e.z];
    if (best[0] > -1e8 && !stable(e.x, e.z, best[0])) best[0] = -1e9;
    for (let r = 1; r <= 8; r++) for (let a = 0; a < 12; a++) {
      const x = e.x + Math.cos(a * 0.5236) * r, z = e.z + Math.sin(a * 0.5236) * r, t = w.roofAt(x, z);
      if (t > best[0] + 0.3 && stable(x, z, t)) best = [t, x, z];
    }
    if (best[0] > -1e8) { e.x = best[1]; e.z = best[2]; e.y = best[0] + 1.5 + EYE; }
  }

  // dans l'arbre, on se tient sur la cabane, à côté du tronc ; sur le château d'eau, au bord de la cuve, face à la ville
  for (const e of emp) {
    const dc = Math.atan2(w.BCX - e.x, w.BCZ - e.z), ux = Math.sin(dc), uz = Math.cos(dc);
    if (e.type === 'arbre') { e.ox = ux * 1.45; e.oz = uz * 1.45; }
    if (e.type === 'chateau') { e.ox = ux * 9.6; e.oz = uz * 9.6; }
  }

  // sur un toit, l'œil ne doit jamais être sous un volume de toiture du modèle : on le remonte au besoin
  for (const e of emp) {
    if (e.type !== 'toit') continue;
    const px = e.x + e.ox, pz = e.z + e.oz;
    for (const b of raw.bats) {
      if (Math.abs(b.x - px) > 150 || Math.abs(b.z - pz) > 150) continue;
      for (const k of b.k) {
        const dx = px - k[0], dz = pz - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]);
        const u = dx * ct + dz * st, v = -dx * st + dz * ct;
        if (Math.abs(u) <= k[2] / 2 + 0.5 && Math.abs(v) <= k[3] / 2 + 0.5) e.y = Math.max(e.y, k[5] + 1.7);
      }
    }
  }
  return { emp, grues };
}
