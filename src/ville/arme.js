// Ville nouvelle : la carabine du tireur, vue à la première personne quand il n'est pas en lunette. C'est le modèle du
// jeu solo (src/weapons/rifle-model.ts) pour l'arme unique du multijoueur. Elle est dessinée dans une petite scène à
// part, par-dessus l'image de la ville : elle ne peut ni traverser un garde-corps ni être coupée par le plan proche.
import * as THREE from 'three';
import { rifleBlueprint } from '../weapons/rifle-model';
import { weaponById } from '../config/weapons';

export function installArme({ renderer, camera, soleil, centre, arme = '375ct' }) {
  // la scène est posée au centre de la carte, où la courbure appliquée par les shaders est nulle
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, 0.03, 6);
  cam.position.set(centre[0], 0, centre[1]);
  const bp = rifleBlueprint(weaponById(arme), 1);
  const mesh = new THREE.Mesh(bp.merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
  mesh.rotation.y = Math.PI;                         // le modèle a le canon vers +Z ; la caméra regarde vers −Z
  mesh.frustumCulled = false;
  const g = new THREE.Group(); g.add(mesh); scene.add(g);
  // tenue basse, à droite : la détente (origine du modèle) à 17 cm à droite, 21 cm sous l'œil, 40 cm devant
  g.position.set(centre[0] + 0.17, -0.21, centre[1] - 0.4); g.rotation.set(0.035, 0.075, -0.045);
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x4a4f55, 1.25));
  const sol = new THREE.DirectionalLight(0xfff2dd, 1.9); scene.add(sol); scene.add(sol.target); sol.target.position.copy(cam.position);
  const q = new THREE.Quaternion(), d = new THREE.Vector3();
  return {
    /** À appeler après le rendu de la ville, quand l'arme doit se voir. */
    dessine() {
      cam.aspect = camera.aspect; cam.updateProjectionMatrix();
      d.copy(soleil).applyQuaternion(q.copy(camera.quaternion).invert()); sol.position.copy(cam.position).add(d);   // le soleil de la ville, vu dans le repère du regard
      const auto = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, cam); renderer.autoClear = auto;
    },
    scene, cam, groupe: g,
  };
}
