/* ---------------------------------------------------------------------------
   Les réglages du paiement, rangés en base (table public.reglages).

   Pourquoi en base et pas dans le code : le numéro Wave qui reçoit l'argent,
   le prix et la durée doivent pouvoir changer sans redéployer, et sans que
   ces informations soient écrites en clair dans le dépôt public.

   Tant que la migration n'est pas passée, tout continue de fonctionner avec
   les valeurs par défaut : le paiement s'annonce simplement « pas encore
   disponible » au lieu de faire planter l'API.
   --------------------------------------------------------------------------- */
import { query } from './db.js';
import { waveDisponible } from './wave.js';

const DEFAUTS = {
  prix_debout: '700',
  duree_jours: '30',
  devise: 'FCFA',
  paiement_actif: 'oui',
  wave_numero: '',
  wave_nom: '',
  operateurs: 'wave',
  // Formule promoteurs : prix d'une visite reçue grâce à l'application
  prix_visite: '500'
};

const TTL_MS = 10 * 1000;          // une modif dans la console se voit tout de suite
let cache = { valeurs: null, at: 0 };

/** Ne garde que les 10 chiffres d'un numéro ivoirien (+225 07 07 …). */
export function numeroNu(valeur) {
  const chiffres = String(valeur || '').replace(/\D/g, '');
  return chiffres.length > 10 ? chiffres.slice(-10) : chiffres;
}

/** 0700000000 → « 07 00 00 00 00 » */
export function numeroLisible(valeur) {
  const n = numeroNu(valeur);
  return n.length === 10 ? n.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5') : n;
}

export async function lireReglages(force = false) {
  if (!force && cache.valeurs && Date.now() - cache.at < TTL_MS) return cache.valeurs;

  const valeurs = { ...DEFAUTS };
  try {
    const { rows } = await query('select cle, valeur from public.reglages');
    for (const r of rows) {
      if (r.cle in DEFAUTS && r.valeur !== null) valeurs[r.cle] = r.valeur;
    }
  } catch {
    // Table absente : on renvoie les valeurs par défaut (paiement indisponible
    // puisque le numéro Wave est vide), sans casser le reste de l'API.
    cache = { valeurs, at: Date.now() };
    return valeurs;
  }

  cache = { valeurs, at: Date.now() };
  return valeurs;
}

/**
 * Enregistre les réglages. Les valeurs sont vérifiées une par une : une saisie
 * farfelue dans la console ne doit jamais mettre le paiement en vrac.
 */
export async function ecrireReglages(patch = {}) {
  const aEcrire = [];

  if ('prix_debout' in patch) {
    const prix = Number(String(patch.prix_debout).replace(/[^\d]/g, ''));
    if (!Number.isInteger(prix) || prix < 100 || prix > 100000) {
      const e = new Error('Le prix doit être un nombre entier entre 100 et 100 000 FCFA.');
      e.code = 'PRIX_INVALIDE';
      throw e;
    }
    aEcrire.push(['prix_debout', String(prix)]);
  }

  if ('duree_jours' in patch) {
    const duree = Number(String(patch.duree_jours).replace(/[^\d]/g, ''));
    if (!Number.isInteger(duree) || duree < 1 || duree > 366) {
      const e = new Error('La durée doit être comprise entre 1 et 366 jours.');
      e.code = 'DUREE_INVALIDE';
      throw e;
    }
    aEcrire.push(['duree_jours', String(duree)]);
  }

  if ('wave_numero' in patch) {
    const n = numeroNu(patch.wave_numero);
    if (n && n.length !== 10) {
      const e = new Error('Le numéro Wave doit contenir 10 chiffres, par exemple 07 00 00 00 00.');
      e.code = 'NUMERO_INVALIDE';
      throw e;
    }
    aEcrire.push(['wave_numero', n]);
  }

  if ('wave_nom' in patch) {
    const nom = String(patch.wave_nom || '').trim().slice(0, 60);
    aEcrire.push(['wave_nom', nom]);
  }

  if ('prix_visite' in patch) {
    const prix = Number(String(patch.prix_visite).replace(/[^\d]/g, ''));
    if (!Number.isInteger(prix) || prix < 0 || prix > 100000) {
      const e = new Error("Le prix d'une visite doit être un nombre entier entre 0 et 100 000 FCFA.");
      e.code = 'PRIX_VISITE_INVALIDE';
      throw e;
    }
    aEcrire.push(['prix_visite', String(prix)]);
  }

  if ('paiement_actif' in patch) {
    const actif = ['oui', 'true', '1', true].includes(patch.paiement_actif) ? 'oui' : 'non';
    aEcrire.push(['paiement_actif', actif]);
  }

  for (const [cle, valeur] of aEcrire) {
    await query(
      `insert into public.reglages (cle, valeur, maj_le) values ($1, $2, now())
       on conflict (cle) do update set valeur = excluded.valeur, maj_le = now()`,
      [cle, valeur]
    );
  }

  return lireReglages(true);
}

/** Ce que l'application et la page Tarifs ont besoin de savoir. */
export async function offre() {
  const r = await lireReglages();
  const compte = numeroNu(r.wave_numero);
  return {
    prix: Number(r.prix_debout) || 700,
    devise: r.devise || 'FCFA',
    duree_jours: Number(r.duree_jours) || 30,
    moyen: 'wave',
    numero: compte,
    numero_lisible: numeroLisible(compte),
    nom: r.wave_nom || '',
    actif: r.paiement_actif === 'oui',
    // Deux façons d'être utilisable : le paiement automatique Wave Business,
    // ou le numéro à créditer à la main. Sans l'un des deux, on annonce
    // « bientôt » plutôt que d'inviter à payer dans le vide.
    disponible: r.paiement_actif === 'oui' && (waveDisponible() || compte.length === 10),
    auto: waveDisponible()
  };
}

/** Réinitialise le cache (tests). */
export function oublierReglages() {
  cache = { valeurs: null, at: 0 };
}
