/* ---------------------------------------------------------------------------
   Modération automatique des photos de profil.

   On ne prétend pas faire de la reconnaissance d'image « IA » : il n'existe
   aucun modèle gratuit fiable qui tourne sur le serveur gratuit de Render.
   Ce qui est fait ici est mesurable et vérifiable :

     1. le navigateur mesure l'image qu'il vient de compresser (part de peau,
        luminosité moyenne, taille) — il a déjà les pixels sous la main ;
     2. le serveur applique des seuils fixes sur ces mesures ;
     3. toute photo douteuse passe en « à vérifier » et apparaît dans la console
        d'administration, où un humain tranche en un clic.

   Une photo douteuse n'est PAS cachée : elle reste visible, mais elle est
   signalée. Seule une décision humaine la retire du site.
   --------------------------------------------------------------------------- */

export const SEUILS = {
  peauMax: 0.55,        // au-delà, beaucoup de peau visible -> à vérifier
  lumiereMin: 40,       // en dessous, photo trop sombre pour juger
  coteMin: 300          // largeur et hauteur minimales
};

/**
 * Calcule l'état de modération d'une photo.
 * @param {{skin?:number, brightness?:number, width?:number, height?:number}|null} m
 * @returns {{status:'ok'|'review', score:number|null, note:string|null}}
 */
export function evaluerPhoto(m) {
  if (!m || typeof m !== 'object') {
    return { status: 'review', score: null, note: 'Analyse impossible : à vérifier à la main' };
  }

  const peau = Number(m.skin);
  const lumiere = Number(m.brightness);
  const largeur = Number(m.width);
  const hauteur = Number(m.height);

  if (!Number.isFinite(peau) || peau < 0 || peau > 1) {
    return { status: 'review', score: null, note: 'Mesures absentes ou invalides' };
  }
  if (Number.isFinite(largeur) && Number.isFinite(hauteur)) {
    if (largeur < SEUILS.coteMin || hauteur < SEUILS.coteMin) {
      return { status: 'review', score: Math.round(peau * 100), note: 'Image trop petite (' + largeur + '×' + hauteur + ')' };
    }
  }
  if (Number.isFinite(lumiere) && lumiere < SEUILS.lumiereMin) {
    return { status: 'review', score: Math.round(peau * 100), note: 'Photo très sombre (luminosité ' + Math.round(lumiere) + '/255)' };
  }
  if (peau >= SEUILS.peauMax) {
    return { status: 'review', score: Math.round(peau * 100), note: 'Beaucoup de peau visible (' + Math.round(peau * 100) + ' %)' };
  }

  return { status: 'ok', score: Math.round(peau * 100), note: null };
}
