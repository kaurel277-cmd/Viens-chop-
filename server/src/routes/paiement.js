/* ---------------------------------------------------------------------------
   Paiement du Mode Debout — deux vitesses, un seul circuit.

   1. AUTOMATIQUE (Wave Business, chequeout hébergé par Wave)
      POST /api/paiement/checkout  → le serveur demande une session à Wave et
      renvoie `wave_launch_url`. La personne paie dans l'app Wave ; au retour,
      /api/paiement/verifier relit la session chez Wave, et le webhook
      checkout.session.completed confirme. Personne n'a rien à valider.

   2. MANUEL (secours, aucun compte marchand)
      La personne envoie l'argent sur le numéro réglé dans la console, puis
      colle l'identifiant de sa transaction Wave. L'administrateur valide.

   Dans les deux cas c'est la MÊME ligne de public.payments qui passe en
   « paid » : c'est le déclencheur PostgreSQL qui active les 30 jours.

   Règle d'or : le montant et l'état du paiement ne viennent JAMAIS du
   navigateur. Ils viennent du prix en base, et de la relecture de la session
   auprès de Wave.
   --------------------------------------------------------------------------- */
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { offre as offrePaiement } from '../reglages.js';
import {
  waveDisponible, creerSession, lireSession, signatureValide, sessionPayee
} from '../wave.js';
import { config } from '../config.js';

export const paiementRouter = Router();

const REFERENCE_MIN = 6;
const REFERENCE_MAX = 40;

/** Identifiants Wave (saisis à la main) : lettres, chiffres et tirets. */
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
    decide_le: j.decided_at || null,
    note: j.note || null,
    lien: j.checkout_url || null,
    transaction_wave: j.transaction_id || null
  };
}

function urlsRetour() {
  const base = config.siteUrl;
  return {
    successUrl: base + '/app.html?paiement=ok',
    errorUrl: base + '/app.html?paiement=echec'
  };
}

/* ---------------------------------------------------------------------------
   GET /api/paiement/offre — prix, durée, numéro Wave, paiement auto ?
   Public : la page Tarifs l'affiche même sans compte.
   --------------------------------------------------------------------------- */
paiementRouter.get('/offre', async (_req, res, next) => {
  try {
    const o = await offrePaiement();
    res.json({ ...o, auto: waveDisponible() });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/paiement/moi — suis-je Debout, où en est ma demande ?
   --------------------------------------------------------------------------- */
paiementRouter.get('/moi', requireAuth, async (req, res, next) => {
  try {
    const abo = await etatAbonnement(req.user.id);
    // `decided_at`, `note`, `checkout_url` et `transaction_id` n'existent
    // qu'après la migration « paiements » : on les lit via to_jsonb pour
    // qu'une base en retard ne casse jamais l'écran d'abonnement.
    const { rows } = await query(
      `select id, provider_ref, amount_fcfa, status, created_at,
              nullif(to_jsonb(p)->>'decided_at', '')  as decided_at,
              to_jsonb(p)->>'note'                   as note,
              to_jsonb(p)->>'checkout_url'           as checkout_url,
              to_jsonb(p)->>'transaction_id'         as transaction_id
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
      auto: waveDisponible(),
      en_attente: attente ? ligne(attente) : null,
      historique: rows.filter(p => p.status !== 'pending').map(ligne)
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/paiement/checkout — paiement automatique
   Crée (ou réutilise) une session Wave et renvoie le lien à ouvrir.
   --------------------------------------------------------------------------- */
paiementRouter.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    if (!waveDisponible()) {
      throw new AppError(503, 'PAIEMENT_AUTO_INDISPONIBLE',
        "Le paiement automatique n'est pas encore branché. Tu peux payer par Wave et envoyer la preuve.");
    }

    const o = await offrePaiement();
    if (!o.actif) {
      throw new AppError(503, 'PAIEMENT_INDISPONIBLE',
        "Le paiement n'est pas ouvert. Réessaie plus tard.");
    }

    const abo = await etatAbonnement(req.user.id);

    // Une session encore ouverte est réutilisée : pas de double paiement si la
    // personne revient sur l'écran ou appuie deux fois.
    const { rows: ouvertes } = await query(
      `select id, provider_ref, checkout_url, created_at
         from public.payments
        where user_id = $1 and status = 'pending'
          and provider_ref like 'cos-%'
          and created_at > now() - interval '23 hours'
        order by created_at desc limit 1`,
      [req.user.id]
    );
    if (ouvertes.length && ouvertes[0].checkout_url) {
      let session = null;
      try { session = await lireSession(ouvertes[0].provider_ref); } catch (e) { /* on recrée */ }
      if (session && session.checkout_status === 'open' && !sessionPayee(session)) {
        return res.json({ ok: true, reutilisee: true, url: ouvertes[0].checkout_url, expire: session.when_expires || null });
      }
      if (sessionPayee(session)) {
        // Payé mais le webhook n'est pas encore passé : on applique tout de suite.
        await marquerPaye(ouvertes[0].id, session);
        return res.json({ ok: true, deja_paye: true, debout: true });
      }
    }

    // Une demande manuelle en attente empêche d'ouvrir un second circuit.
    const { rows: manuelles } = await query(
      `select id from public.payments
        where user_id = $1 and status = 'pending'
          and (provider_ref is null or provider_ref not like 'cos-%')
        limit 1`,
      [req.user.id]
    );
    if (manuelles.length) {
      throw new AppError(409, 'DEMANDE_EN_ATTENTE',
        'Tu as déjà une demande en attente. On la vérifie sous peu.');
    }

    // 1. La ligne existe AVANT l'appel à Wave : c'est son identifiant qui sert
    //    de client_reference, donc de fil de rappel pour le webhook.
    const { rows: cree } = await query(
      `insert into public.payments (user_id, provider, amount_fcfa, plan, status)
       values ($1, 'wave', $2, 'debout', 'pending')
       returning id, amount_fcfa`,
      [req.user.id, o.prix]
    );
    const paiement = cree[0];

    // 2. On demande la session à Wave.
    let session;
    try {
      session = await creerSession({
        montant: o.prix,
        clientReference: paiement.id,
        ...urlsRetour()
      });
    } catch (err) {
      // Rien n'a été payé : on retire la ligne pour ne pas bloquer la personne.
      await query('delete from public.payments where id = $1', [paiement.id]).catch(() => {});
      if (err.code === 'WAVE_NON_CONFIGURE' || err.code === 'WAVE_INJOIGNABLE' || err.code === 'WAVE_ERREUR') {
        throw new AppError(503, 'WAVE_INDISPONIBLE',
          "Wave ne répond pas pour le moment. Tu peux payer sur le numéro affiché et envoyer la preuve.");
      }
      throw err;
    }

    if (!session || !session.wave_launch_url) {
      await query('delete from public.payments where id = $1', [paiement.id]).catch(() => {});
      throw new AppError(503, 'WAVE_INDISPONIBLE', "Wave n'a pas renvoyé de lien de paiement. Réessaie.");
    }

    // 3. On garde le lien : la personne peut reprendre son paiement plus tard.
    await query(
      `update public.payments
          set provider_ref = $2,
              note = $3
        where id = $1`,
      [paiement.id, session.id, 'session Wave ouverte']
    );
    await ajouterColonnes(paiement.id, session);

    res.status(201).json({
      ok: true,
      url: session.wave_launch_url,
      expire: session.when_expires || null,
      deja_debout: abo.debout
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/paiement/verifier — au retour de Wave
   On ne croit pas l'URL de retour : on redemande l'état à Wave. Le webhook
   peut arriver avant, après, ou jamais (Render endormi) — cette route rend
   l'activation certaine dès que le client revient dans l'app.
   --------------------------------------------------------------------------- */
paiementRouter.post('/verifier', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select id, provider_ref, amount_fcfa, status
         from public.payments
        where user_id = $1 and status = 'pending' and provider_ref like 'cos-%'
        order by created_at desc limit 1`,
      [req.user.id]
    );
    if (!rows.length) {
      const abo = await etatAbonnement(req.user.id);
      return res.json({ ok: true, statut: abo.debout ? 'debout' : 'aucune_demande', debout: abo.debout });
    }

    if (!waveDisponible()) {
      return res.json({ ok: true, statut: 'attente', debout: false });
    }

    let session = null;
    try { session = await lireSession(rows[0].provider_ref); } catch (e) { /* on réessaiera */ }

    if (sessionPayee(session)) {
      await marquerPaye(rows[0].id, session);
      const abo = await etatAbonnement(req.user.id);
      return res.json({ ok: true, statut: 'paye', debout: abo.debout, fin: abo.fin });
    }

    const expiree = session && (session.checkout_status === 'expired' ||
      (session.when_expires && new Date(session.when_expires) < new Date()));
    return res.json({ ok: true, statut: expiree ? 'expiree' : 'attente', debout: false });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/paiement/webhook/wave — confirmation envoyée par Wave
   En-tête Wave-Signature vérifié, puis l'état est RE-LU chez Wave : même un
   webhook parfaitement signé ne suffit pas, seule la session fait foi.
   --------------------------------------------------------------------------- */
paiementRouter.post('/webhook/wave', async (req, res) => {
  const corps = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

  if (!config.waveWebhookSecret) {
    return res.status(503).json({ error: { code: 'WEBHOOK_NON_CONFIGURE', message: 'Webhook non configuré.' } });
  }
  if (!signatureValide(req.get('Wave-Signature'), corps)) {
    console.warn('[wave] webhook refusé : signature invalide');
    return res.status(401).json({ error: { code: 'SIGNATURE_INVALIDE', message: 'Signature refusée.' } });
  }

  let evenement = null;
  try { evenement = JSON.parse(corps.toString('utf8')); } catch { /* ignoré */ }
  if (!evenement || !evenement.type) {
    return res.status(400).json({ error: { code: 'EVENEMENT_INVALIDE', message: 'Événement illisible.' } });
  }

  // Wave peut envoyer un événement de test depuis son tableau de bord.
  if (evenement.type === 'test.test_event') {
    return res.json({ ok: true, test: true });
  }

  const session = evenement.data || {};
  const sessionId = session.id || (evenement.data && evenement.data.checkout_id);
  const reference = session.client_reference || null;

  try {
    if (!sessionId) {
      return res.status(400).json({ error: { code: 'SESSION_MANQUANTE', message: 'Session absente.' } });
    }

    const { rows } = await query(
      `select id, user_id, status, amount_fcfa from public.payments
        where provider_ref = $1
           or ($2::text is not null and id = $2::uuid)
        limit 1`,
      [sessionId, reference]
    );
    if (!rows.length) {
      console.warn('[wave] webhook pour un paiement inconnu :', sessionId, reference);
      return res.json({ ok: true, ignore: true });
    }
    const paiement = rows[0];

    if (paiement.status === 'paid') return res.json({ ok: true, deja: true });

    if (evenement.type === 'checkout.session.payment_failed') {
      await query(
        `update public.payments set status = 'failed', note = $2 where id = $1 and status = 'pending'`,
        [paiement.id, 'paiement refusé par Wave']
      );
      return res.json({ ok: true });
    }

    if (evenement.type !== 'checkout.session.completed') {
      return res.json({ ok: true, ignore: true, type: evenement.type });
    }

    // Relecture auprès de Wave : c'est elle qui décide, pas le contenu reçu.
    const verite = await lireSession(sessionId);
    if (!sessionPayee(verite)) {
      return res.json({ ok: true, attente: true, statut: verite && verite.payment_status });
    }
    if (String(verite.amount) !== String(paiement.amount_fcfa) || (verite.currency && verite.currency !== 'XOF')) {
      console.error('[wave] montant inattendu', verite.amount, verite.currency, paiement.id);
      return res.status(409).json({ error: { code: 'MONTANT_DIFFERENT', message: 'Montant différent.' } });
    }

    await marquerPaye(paiement.id, verite);
    res.json({ ok: true });
  } catch (err) {
    console.error('[wave] erreur webhook :', err.message);
    // 500 = Wave réessaiera plus tard : on ne perd pas le paiement.
    res.status(500).json({ error: { code: 'ERREUR_WEBHOOK', message: 'Réessaie plus tard.' } });
  }
});

/** Passe la ligne en « paid » — le déclencheur PostgreSQL active les 30 jours. */
async function marquerPaye(paiementId, session) {
  await query(
    `update public.payments
        set status = 'paid',
            note = coalesce(nullif(note, ''), 'payé par Wave'),
            transaction_id = coalesce($2, transaction_id)
      where id = $1 and status = 'pending'`,
    [paiementId, session && session.transaction_id]
  ).catch(async () => {
    // Sans la migration : pas de colonne transaction_id, on ne perd pas le paiement.
    await query(`update public.payments set status = 'paid' where id = $1 and status = 'pending'`, [paiementId]);
  });
}

/** Colonnes propres au paiement automatique (absentes d'une base non migrée). */
async function ajouterColonnes(paiementId, session) {
  const essais = [
    `update public.payments set checkout_url = $2 where id = $1`,
    `update public.payments set transaction_id = null where id = $1`
  ];
  try {
    await query(essais[0], [paiementId, session.wave_launch_url]);
  } catch { /* base sans la colonne : le lien reste dans la réponse HTTP */ }
}

/* ---------------------------------------------------------------------------
   POST /api/paiement/declarer — circuit manuel : { reference }
   Le montant vient du serveur, jamais du navigateur.
   --------------------------------------------------------------------------- */
paiementRouter.post('/declarer', requireAuth, async (req, res, next) => {
  try {
    const o = await offrePaiement();
    if (!o.actif) {
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
      `select id, provider_ref from public.payments where user_id = $1 and status = 'pending' limit 1`,
      [req.user.id]
    );
    if (attente.rowCount) {
      const auto = String(attente.rows[0].provider_ref || '').startsWith('cos-');
      throw new AppError(409, 'DEMANDE_EN_ATTENTE', auto
        ? 'Un paiement Wave est déjà ouvert pour ton compte. Termine-le, ou attends qu\'il expire.'
        : 'Tu as déjà une demande en attente. On la vérifie sous peu.');
    }

    const { rows } = await query(
      `insert into public.payments (user_id, provider, provider_ref, amount_fcfa, plan, status)
       values ($1, 'wave', $2, $3, 'debout', 'pending')
       returning id, provider_ref, amount_fcfa, status, created_at`,
      [req.user.id, reference, o.prix]
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
