// Niveau visé par un script e2e : `--level <id>` (ou HR_LEVEL), « standard » par défaut.
// Dans la page, les données du niveau chargé sont dans window.hr.level (postes, plan du tireur, site…).
const at = process.argv.indexOf('--level');
export const LEVEL = at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : process.env.HR_LEVEL || 'standard';
/** fragment de requête à joindre à l'URL du jeu */
// HR_QUERY : paramètres d'essai ajoutés à l'URL (ex. HR_QUERY='phys=full&alt=1800' pour jouer la mission avec la physique avancée)
export const LQ = 'level=' + LEVEL + (process.env.HR_QUERY ? '&' + process.env.HR_QUERY : '');
/** le niveau demandé est-il bien celui que la page a chargé ? (un niveau non livré retombe sur le niveau par défaut) */
export async function assertLevel(page) {
  const got = await page.evaluate(() => window.hr.level.id);
  if (got !== LEVEL) { console.log(`! niveau demandé « ${LEVEL} », niveau chargé « ${got} » (carte non livrée ?)`); process.exit(1); }
}
