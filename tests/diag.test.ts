// Panneau d'erreur : seules les erreurs des scripts du jeu s'affichent ; celles qu'un navigateur ou une extension
// injecte dans la page (Brave sur iOS, DarkReader…) sont ignorées.
import { describe, expect, it } from 'vitest';
import { ownScript, ownStack } from '../src/core/diag';

const O = 'https://jeu.example';

describe('origine des erreurs', () => {
  it('reconnaît les scripts du jeu', () => {
    expect(ownScript(O + '/assets/index-Dl26.js', O)).toBe(true);
    expect(ownScript(O + '/assets/three.core-Bj.js?v=12', O)).toBe(true);
    expect(ownScript(O + '/src/main.ts', O)).toBe(true);
  });
  it('écarte la page elle-même, les autres origines et les adresses vides', () => {
    expect(ownScript(O + '/', O)).toBe(false);
    expect(ownScript(O + '/index.html', O)).toBe(false);
    expect(ownScript('https://ailleurs.example/x.js', O)).toBe(false);
    expect(ownScript('', O)).toBe(false);
    expect(ownScript('user-script:12', O)).toBe(false);
  });
  it('écarte la pile d’un script injecté (cas relevé dans Brave sur iOS)', () => {
    expect(ownStack(`global code@${O}/:1:12`, O)).toBe(false);
    expect(ownStack(`global code@${O}/:1:19`, O)).toBe(false);
  });
  it('garde une pile qui passe par le jeu, formats Safari et Chrome', () => {
    expect(ownStack(`step@${O}/assets/index-Dl26.js:412:88\nglobal code@${O}/:1:12`, O)).toBe(true);
    expect(ownStack(`TypeError: x\n    at Game.step (${O}/assets/index-Dl26.js:412:88)`, O)).toBe(true);
  });
});
