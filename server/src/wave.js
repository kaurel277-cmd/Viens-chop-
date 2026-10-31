/* ---------------------------------------------------------------------------
   Client de l'API Wave (Wave Checkout), d'après la documentation officielle
   docs.wave.com :

     POST https://api.wave.com/v1/checkout/sessions      → créer un paiement
     GET  https://api.wave.com/v1/checkout/sessions/:id  → relire son état

   En-tête : Authorization: Bearer wave_sn_prod_…
   Réponse : { id: "cos-…", wave_launch_url: "https://pay.wave.com/c/cos-…",
               payment_status: "succeeded" | "processing" | "failed",
               checkout_status: "open" | "complete" | "expired",
               amount, currency, client_reference, transaction_id }

   Deux secrets différents chez Wave, à ne pas confondre :
     - la clé API            wave_sn_prod_…   → signer NOS appels
     - le secret du webhook  wave_sn_WHS_…    → vérifier LEURS appels

   Rien n'est codé en dur : sans WAVE_API_KEY, tout le module se met en
   veille et l'application garde le circuit manuel (numéro + référence).
   --------------------------------------------------------------------------- */
import crypto from 'node:crypto';
import { config } from './config.js';

const BASE_DEFAUT = 'https://api.wave.com';

export function waveDisponible() {
  return !!config.waveApiKey;
}

function base() {
  return (config.waveApiUrl || BASE_DEFAUT).replace(/\/$/, '');
}

/**
 * Appel à l'API Wave. Le corps est envoyé tel quel (texte) : si un secret de
 * signature de requête est configuré, la signature porte sur ce texte exact.
 */
async function appelWave(chemin, options = {}) {
  if (!waveDisponible()) {
    const e = new Error("L'API Wave n'est pas configurée (WAVE_API_KEY manque).");
    e.code = 'WAVE_NON_CONFIGURE';
    throw e;
  }

  const methode = options.method || 'GET';
  const corps = options.body === undefined ? '' : JSON.stringify(options.body);
  const entetes = {
    Authorization: 'Bearer ' + config.waveApiKey,
    'Content-Type': 'application/json'
  };

  // Signature de requête : optionnelle chez Wave (case « request signing »).
  if (config.waveSigningSecret) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', config.waveSigningSecret)
      .update(String(t) + corps)
      .digest('hex');
    entetes['Wave-Signature'] = 't=' + t + ',v1=' + v1;
  }

  let rep;
  try {
    rep = await fetch(base() + chemin, {
      method: methode,
      headers: entetes,
      body: corps || undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    const e = new Error("Impossible de joindre Wave pour le moment.");
    e.code = 'WAVE_INJOIGNABLE';
    throw e;
  }

  const texte = await rep.text();
  let donnees = null;
  try { donnees = texte ? JSON.parse(texte) : null; } catch { donnees = null; }

  if (!rep.ok) {
    const e = new Error((donnees && donnees.message) || 'Wave a refusé la demande.');
    e.code = 'WAVE_ERREUR';
    e.statut = rep.status;
    e.details = donnees;
    console.error('[wave] erreur', rep.status, texte.slice(0, 300));
    throw e;
  }

  return donnees;
}

/**
 * Crée une session de paiement.
 * `clientReference` = l'identifiant de NOTRE paiement : c'est lui qui permet
 * de recoller le webhook à la bonne ligne, sans jamais faire confiance au
 * montant annoncé par le navigateur.
 */
export function creerSession({ montant, clientReference, successUrl, errorUrl }) {
  return appelWave('/v1/checkout/sessions', {
    method: 'POST',
    body: {
      amount: String(montant),
      currency: 'XOF',
      client_reference: clientReference,
      success_url: successUrl,
      error_url: errorUrl
    }
  });
}

export function lireSession(id) {
  return appelWave('/v1/checkout/sessions/' + encodeURIComponent(id));
}

/**
 * Vérifie l'en-tête Wave-Signature.
 *
 * Format : « t=1667920421,v1=53c97169… » (plusieurs v1= possibles pendant une
 * rotation de clé). La signature est un HMAC-SHA256 du texte
 *     timestamp + corps brut
 * avec le secret de webhook.
 *
 * Le corps doit être EXACTEMENT celui reçu : on ne re-sérialise jamais le JSON,
 * sinon la signature ne correspond plus. C'est pour cette raison que la route
 * webhook est branchée avant express.json() et reçoit un Buffer.
 */
export function signatureValide(entete, corpsBrut) {
  const secret = config.waveWebhookSecret;
  if (!secret) return false;
  if (!entete || typeof entete !== 'string') return false;

  const morceaux = entete.split(',');
  const horodatage = (morceaux.find(m => m.trim().startsWith('t=')) || '').split('=')[1];
  const signatures = morceaux
    .filter(m => m.trim().startsWith('v1='))
    .map(m => m.trim().split('=')[1])
    .filter(Boolean);

  if (!horodatage || !signatures.length) return false;

  const texte = corpsBrut.toString('utf8');

  // La documentation Wave concatène sans séparateur. On accepte aussi la
  // variante avec un point, que certaines bibliothèques produisent : dans les
  // deux cas il faut connaître le secret, donc cela n'ouvre aucune porte.
  const candidats = [
    crypto.createHmac('sha256', secret).update(horodatage + texte).digest('hex'),
    crypto.createHmac('sha256', secret).update(horodatage + '.' + texte).digest('hex')
  ];

  // Comparaison à temps constant, en acceptant les majuscules.
  const fournies = signatures.map(s => s.toLowerCase());
  return candidats.some(e => fournies.some(f => {
    const a = Buffer.from(e, 'utf8');
    const b = Buffer.from(f, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }));
}

/** Un paiement est-il réellement encaissé ? (relecture serveur-à-serveur) */
export function sessionPayee(session) {
  return !!session && session.payment_status === 'succeeded';
}
