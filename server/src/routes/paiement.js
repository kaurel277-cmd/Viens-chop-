/* ---------------------------------------------------------------------------
   Paiement du Mode Debout.

   Deux vitesses, un seul circuit :

   1. MANUEL (actif tout de suite, aucun compte marchand)
      La personne envoie l'argent par Wave au numéro réglé dans la console,
      puis colle l'identifiant de transaction. La demande arrive « en attente ».
      L'administrateur valide → le déclencheur PostgreSQL active 30 jours.

   2. AUTOMATIQUE (prêt, branché dès que les clés existent)
      Le fournisseur (Wave Business, CinetPay…) appelle
      POST /api/paiement/webhook/:moyen avec une signature HMAC.
      Tant que PAIEMENT_WEBHOOK_SECRET n'est pas défini, la route répond
      simplement « pas encore disponible ».

   Dans les deux cas, c'est la MÊME ligne dans public.payments qui déclenche
   l'activation : le passage à l'automatique ne demande aucune migration.
   --------------------------------------------------------------------------- */
import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { offre as offrePaiement } from '../reglages.js';

export const paiementRouter = Router();

const REFERENCE_MIN = 6;
const REFERENCE_MAX = 40;

/** Identifiants Wave : lettres, chiffres et tirets. On range en majuscules. */
function normaliserReference(valeur) {
  return String(valeur || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

async function etatAbonnement(userId) {
  const { rows } = await query('select plan, plan_expires_at from public.users where id = $1', [userId]);
  const u = rows[0] || {};
  const fin = u.plan_expires_at ? new Date(u.plan_expires_at) : null;
  const debout = u.plan === 'debout' && (!fin || fin.getTime() > Date.now());
  return { debout, plan: debout ? 'debout' : 'coupe', fin: debout ? fin : null };
}

function ligne(j) {
  return {
    id: j.id,
    reference: j.provider_ref,
    montant: j.amount_fcfa,
    statut: j.status,
    cree_le: j.created_at,
    decide_le: j.decided_at,
    note: j.note || null
  };
}

/* ---------------------------------------------------------------------------
   GET /api/paiement/offre — prix, durée, numéro Wave à créditer.
   Public : la page Tarifs l'affiche même sans compte.
   --------------------------------------------------------------------------- */
paiementRouter.get('/offre', async (_req, res, next) => {
  try {
    const o = await offrePaiement();
    res.json({ ...o, auto: !!config.paiementWebhookSecret });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/paiement/moi — suis-je Debout, et où en est ma dernière demande ?
   --------------------------------------------------------------------------- */
paiementRouter.get('/moi', requireAuth, async (req, res, next) => {
  try {
    const abo = await etatAbonnement(req.user.id);
    // `decided_at` et `note` n'existent qu'après la migration « paiements ».
    // On les lit via to_jsonb : sans migration, elles valent simplement null
    // au lieu de faire échouer l'écran d'abonnement.
    const { rows } = await query(
      `select id, provider_ref, amount_fcfa, status, created_at,
              nullif(to_jsonb(p)->>'decided_at', '') as decided_at,
              to_jsonb(p)->>'note' as note
         from public.payments p
        where user_id = $1
        order by created_at desc
        limit 10`,
      [req.user.id]
    );
    const attente = rows.find(p => p.status === 'pending') || null;
    const o = await offrePaiement();

    res.json({
      debout: abo.debout,
      plan: abo.plan,
      fin: abo.fin,
      prix: o.prix,
      devise: o.devise,
      duree_jours: o.duree_jours,
      en_attente: attente ? ligne(attente) : null,
      historique: rows.filter(p => p.status !== 'pending').map(ligne)
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/paiement/declarer — { reference }
   La personne a payé, elle envoie la preuve. Le montant vient du serveur,
   jamais du navigateur : impossible de payer 1 FCFA pour un mois.
   --------------------------------------------------------------------------- */
paiementRouter.post('/declarer', requireAuth, async (req, res, next) => {
  try {
    const o = await offrePaiement();
    if (!o.disponible) {
      throw new AppError(503, 'PAIEMENT_INDISPONIBLE',
        "Le paiement n'est pas encore ouvert. Réessaie plus tard.");
    }

    const reference = normaliserReference(req.body && req.body.reference);
    if (reference.length < REFERENCE_MIN) {
      throw new AppError(400, 'REFERENCE_INVALIDE',
        "Il faut l'identifiant de la transaction Wave (au moins 6 caractères, chiffres et lettres).");
    }
    if (reference.length > REFERENCE_MAX) {
      throw new AppError(400, 'REFERENCE_INVALIDE',
        'Cet identifiant est trop long : recopie-le tel qu\'il apparaît dans ton message Wave.');
    }

    const attente = await query(
      `select id from public.payments where user_id = $1 and status = 'pending' limit 1`,
      [req.user.id]
    );
    if (attente.rowCount) {
      throw new AppError(409, 'DEMANDE_EN_ATTENTE',
        'Tu as déjà une demande en attente. On la vérifie sous peu.');
    }

    const { rows } = await query(
      `insert into public.payments (user_id, provider, provider_ref, amount_fcfa, plan, status)
       values ($1, $2, $3, $4, 'debout', 'pending')
       returning id, provider_ref, amount_fcfa, status, created_at`,
      [req.user.id, o.moyen, reference, o.prix]
    );

    res.status(201).json({
      ok: true,
      statut: 'en_attente',
      demande: ligne(rows[0]),
      message: 'Merci ! On vérifie ton paiement et ton Mode Debout s\'active tout seul.'
    });
  } catch (err) {
    if (err && err.code === '23505') {
      const contrainte = String(err.constraint || '');
      if (contrainte.includes('provider_ref')) {
        return next(new AppError(409, 'REFERENCE_DEJA_UTILISEE',
          'Cet identifiant a déjà servi. Vérifie que tu n\'as pas déjà envoyé la demande.'));
      }
      return next(new AppError(409, 'DEMANDE_EN_ATTENTE',
        'Tu as déjà une demande en attente. On la vérifie sous peu.'));
    }
    next(err);
  }
});

/* ---------------------------------------------------------------------------
   POST /api/paiement/webhook/:moyen — validation automatique (prête derrière)
   Signature attendue dans l'en-tête x-signature :
       hex( HMAC-SHA256( "reference|montant|statut", PAIEMENT_WEBHOOK_SECRET ) )
   --------------------------------------------------------------------------- */
function memeSignature(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

paiementRouter.post('/webhook/:moyen', async (req, res, next) => {
  try {
    if (!config.paiementWebhookSecret) {
      throw new AppError(503, 'PAIEMENT_AUTO_INDISPONIBLE',
        'Le paiement automatique n\'est pas encore branché.');
    }

    const corps = req.body || {};
    const reference = normaliserReference(corps.reference);
    const montant = Number(corps.montant || 0);
    const statut = ['paid', 'rejected'].includes(corps.statut) ? corps.statut : 'paid';

    const attendu = crypto
      .createHmac('sha256', config.paiementWebhookSecret)
      .update([reference, montant, statut].join('|'))
      .digest('hex');

    if (!memeSignature(req.get('x-signature'), attendu)) {
      throw new AppError(401, 'SIGNATURE_INVALIDE', 'Signature refusée.');
    }

    const { rows } = await query(
      `select id, amount_fcfa, status from public.payments where provider_ref = $1 limit 1`,
      [reference]
    );
    if (!rows.length) throw new AppError(404, 'PAIEMENT_INTROUVABLE', 'Paiement inconnu.');

    const paiement = rows[0];
    if (paiement.status === 'paid') {
      return res.json({ ok: true, deja: true });
    }
    if (Number(paiement.amount_fcfa) !== montant) {
      throw new AppError(409, 'MONTANT_DIFFERENT',
        'Le montant annoncé ne correspond pas au prix du Mode Debout.');
    }

    await query(
      `update public.payments
          set status = $2,
              note = coalesce(note, 'validé automatiquement')
        where id = $1`,
      [paiement.id, statut === 'paid' ? 'paid' : 'rejected']
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});
