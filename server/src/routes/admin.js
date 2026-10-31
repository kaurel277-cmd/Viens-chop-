import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin, jetonAdminValide, creerJetonAdmin } from '../auth.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { aVerifications, aModeration, aAdminActions, aChatMedia, aPaiements } from '../capabilities.js';
import { lireReglages, ecrireReglages, offre } from '../reglages.js';

export const adminRouter = Router();

/* ---------------------------------------------------------------------------
   Console d'administration de Viens chop.

   Accès : un seul secret, ADMIN_TOKEN, défini sur Render. Pas de compte
   administrateur en base, donc rien à pirater côté site.
   --------------------------------------------------------------------------- */

async function journal(action, targetId, details) {
  try {
    if (!(await aAdminActions())) return;
    await query(
      'insert into public.admin_actions (action, target_id, details) values ($1, $2, $3)',
      [action, targetId || null, details ? JSON.stringify(details) : null]
    );
  } catch { /* le journal ne doit jamais empêcher une action */ }
}

/* ---------------------------------------------------------------------------
   GET /api/admin/etat — la console est-elle configurée ? (public, sans secret)
   --------------------------------------------------------------------------- */
adminRouter.get('/etat', async (_req, res) => {
  res.json({
    ok: true,
    configuree: !!config.adminToken,
    verifications: await aVerifications(),
    moderation: await aModeration(),
    chatMedia: await aChatMedia()
  });
});

/* ---------------------------------------------------------------------------
   POST /api/admin/login — { token }
   --------------------------------------------------------------------------- */
adminRouter.post('/login', (req, res, next) => {
  try {
    if (!config.adminToken) {
      throw new AppError(503, 'ADMIN_FERMEE', "ADMIN_TOKEN n'est pas défini : la console reste fermée.");
    }
    const { token } = req.body || {};
    if (!jetonAdminValide(token)) {
      throw new AppError(401, 'JETON_REFUSE', 'Mot de passe administrateur incorrect.');
    }
    res.json({ ok: true, token: creerJetonAdmin(), expires_in: config.adminTtl });
  } catch (err) { next(err); }
});

/* Tout ce qui suit exige le jeton administrateur. */
adminRouter.use(requireAdmin);

/* ---------------------------------------------------------------------------
   GET /api/admin/stats
   --------------------------------------------------------------------------- */
adminRouter.get('/stats', async (_req, res, next) => {
  try {
    const { rows: u } = await query('select count(*)::int as n from public.users');
    const { rows: r } = await query("select count(*)::int as n from public.reports where status <> 'closed'");
    let verif = 0;
    if (await aVerifications()) {
      const { rows } = await query("select count(*)::int as n from public.verifications where status = 'pending'");
      verif = rows[0].n;
    }
    let photos = 0;
    if (await aModeration()) {
      const { rows } = await query("select count(*)::int as n from public.photos where moderation_status = 'review'");
      photos = rows[0].n;
    }
    let paiements = 0;
    if (await aPaiements()) {
      const { rows } = await query("select count(*)::int as n from public.payments where status = 'pending'");
      paiements = rows[0].n;
    }
    const { rows: m } = await query('select count(*)::int as n from public.matches');
    // Fiches de lieux en attente de validation (0 si la migration n'est pas passée)
    let lieux = 0;
    try {
      const { rows } = await query("select count(*)::int as n from public.lieux where statut = 'en_attente'");
      lieux = rows[0].n;
    } catch { /* table absente : la console reste utilisable */ }
    res.json({ ok: true, stats: {
      comptes: u[0].n, signalements: r[0].n, verifications: verif,
      photos: photos, paiements: paiements, matchs: m[0].n, lieux: lieux
    } });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   SIGNALEMENTS
   --------------------------------------------------------------------------- */
adminRouter.get('/reports', async (req, res, next) => {
  try {
    const ouvert = req.query.status !== 'tous';
    const { rows } = await query(
      `select r.id, r.reason, r.details, r.status, r.created_at, r.resolved_at,
              a.pseudo as reporter_pseudo,
              t.id as target_id, t.pseudo as target_pseudo, t.main_photo_id as target_photo_id,
              (select count(*)::int from public.reports r2 where r2.target_id = r.target_id) as target_reports
         from public.reports r
         join public.users a on a.id = r.reporter_id
         join public.users t on t.id = r.target_id
        ${ouvert ? "where r.status <> 'closed'" : ''}
        order by r.created_at desc
        limit 200`
    );
    res.json({ ok: true, reports: rows });
  } catch (err) { next(err); }
});

adminRouter.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    const { rows } = await query(
      `update public.reports set status = 'closed', resolved_at = now()
        where id = $1 returning id, target_id`,
      [req.params.id]
    );
    if (!rows.length) throw new AppError(404, 'SIGNALEMENT_INTROUVABLE', 'Signalement introuvable.');
    await journal('report_close', rows[0].target_id, { report: rows[0].id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   VÉRIFICATIONS D'IDENTITÉ
   --------------------------------------------------------------------------- */
adminRouter.get('/verifications', async (req, res, next) => {
  try {
    if (!(await aVerifications())) return res.json({ ok: true, disponible: false, verifications: [] });
    const tous = req.query.status === 'tous';
    const { rows } = await query(
      `select v.id, v.status, v.created_at, v.reviewed_at, v.note,
              u.id as user_id, u.pseudo, u.age, u.commune, u.phone,
              u.main_photo_id,
              (v.selfie is not null) as has_selfie
         from public.verifications v
         join public.users u on u.id = v.user_id
        ${tous ? '' : "where v.status = 'pending'"}
        order by v.created_at asc
        limit 200`
    );
    res.json({ ok: true, disponible: true, verifications: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/verifications/:id/selfie', async (req, res, next) => {
  try {
    const { rows } = await query('select mime, selfie from public.verifications where id = $1', [req.params.id]);
    if (!rows.length || !rows[0].selfie) throw new AppError(404, 'SELFIE_INTROUVABLE', 'Selfie introuvable ou déjà effacé.');
    res.set('Content-Type', rows[0].mime);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(rows[0].selfie);
  } catch (err) { next(err); }
});

adminRouter.post('/verifications/:id/decision', async (req, res, next) => {
  try {
    const { decision, note } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError(400, 'DECISION_INVALIDE', 'Décision attendue : approved ou rejected.');
    }
    const { rows } = await query(
      `update public.verifications
          set status = $2, note = $3, reviewed_at = now(), selfie = null
        where id = $1 and status = 'pending'
        returning id, user_id`,
      [req.params.id, decision, (note || '').slice(0, 500) || null]
    );
    if (!rows.length) throw new AppError(404, 'VERIFICATION_INTROUVABLE', 'Demande introuvable ou déjà traitée.');

    if (decision === 'approved') {
      await query('update public.users set is_certified = true where id = $1', [rows[0].user_id]);
    }
    await journal('verification_' + decision, rows[0].user_id, { verification: rows[0].id, note: note || null });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   PHOTOS À VÉRIFIER
   --------------------------------------------------------------------------- */
adminRouter.get('/photos', async (req, res, next) => {
  try {
    if (!(await aModeration())) return res.json({ ok: true, disponible: false, photos: [] });
    const statut = ['ok', 'review', 'blocked'].includes(req.query.status) ? req.query.status : 'review';
    const { rows } = await query(
      `select p.id, p.position, p.bytes, p.created_at, p.moderation_status,
              p.moderation_score, p.moderation_note,
              u.id as user_id, u.pseudo, u.commune
         from public.photos p
         join public.users u on u.id = p.user_id
        where p.moderation_status = $1
        order by p.created_at desc
        limit 200`,
      [statut]
    );
    res.json({ ok: true, disponible: true, photos: rows.map(r => ({ ...r, url: '/api/photos/' + r.id })) });
  } catch (err) { next(err); }
});

adminRouter.post('/photos/:id/decision', async (req, res, next) => {
  try {
    if (!(await aModeration())) throw new AppError(503, 'MODERATION_INDISPONIBLE', 'La modération sera active après la migration SQL.');
    const { decision } = req.body || {};
    if (!['ok', 'blocked'].includes(decision)) {
      throw new AppError(400, 'DECISION_INVALIDE', 'Décision attendue : ok ou blocked.');
    }

    const { rows } = await query(
      `update public.photos set moderation_status = $2 where id = $1 returning id, user_id`,
      [req.params.id, decision]
    );
    if (!rows.length) throw new AppError(404, 'PHOTO_INTROUVABLE', 'Photo introuvable.');

    if (decision === 'blocked') {
      // La photo principale ne doit jamais pointer sur une photo retirée.
      await query(
        `update public.users set main_photo_id = (
           select id from public.photos
            where user_id = $1 and moderation_status <> 'blocked'
            order by position asc limit 1
         ) where id = $1`,
        [rows[0].user_id]
      );
    }
    await journal('photo_' + decision, rows[0].user_id, { photo: rows[0].id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/admin/journal — les 100 dernières actions
   --------------------------------------------------------------------------- */
adminRouter.get('/journal', async (_req, res, next) => {
  try {
    if (!(await aAdminActions())) return res.json({ ok: true, disponible: false, actions: [] });
    const { rows } = await query(
      'select id, action, target_id, details, created_at from public.admin_actions order by created_at desc limit 100'
    );
    res.json({ ok: true, disponible: true, actions: rows });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   PAIEMENTS DU MODE DEBOUT

   Circuit manuel : la personne envoie 700 FCFA par Wave, colle l'identifiant
   de la transaction dans l'application, et la demande apparaît ici. Valider =
   passer la ligne en « paid » : le déclencheur PostgreSQL active alors 30
   jours de Mode Debout, sans autre action.
   --------------------------------------------------------------------------- */

adminRouter.get('/paiements', async (req, res, next) => {
  try {
    if (!(await aPaiements())) {
      return res.json({ ok: true, disponible: false, paiements: [] });
    }
    const statut = String(req.query.statut || 'pending');
    const acceptes = ['pending', 'paid', 'rejected', 'failed', 'tous'];
    const filtre = acceptes.includes(statut) ? statut : 'pending';

    const { rows } = await query(
      `select p.id, p.provider, p.provider_ref, p.amount_fcfa, p.status,
              p.created_at, p.decided_at, p.note,
              u.id as user_id, u.pseudo, u.phone, u.plan, u.plan_expires_at
         from public.payments p
         join public.users u on u.id = p.user_id
        where ($1 = 'tous' or p.status = $1)
        order by p.created_at desc
        limit 200`,
      [filtre]
    );
    res.json({ ok: true, disponible: true, statut: filtre, paiements: rows });
  } catch (err) { next(err); }
});

adminRouter.post('/paiements/:id/decision', async (req, res, next) => {
  try {
    if (!(await aPaiements())) {
      throw new AppError(503, 'PAIEMENTS_INDISPONIBLES', 'Le paiement sera actif après la migration SQL.');
    }

    const { valider, note } = req.body || {};
    if (typeof valider !== 'boolean') {
      throw new AppError(400, 'DECISION_INVALIDE', 'Décision attendue : valider true ou false.');
    }

    const avant = await query(
      'select id, user_id, status, provider_ref from public.payments where id = $1',
      [req.params.id]
    );
    if (!avant.rowCount) throw new AppError(404, 'PAIEMENT_INTROUVABLE', 'Paiement introuvable.');
    if (avant.rows[0].status !== 'pending') {
      throw new AppError(409, 'DEJA_TRAITE', 'Cette demande a déjà été traitée.');
    }

    const { rows } = await query(
      `update public.payments
          set status = $2,
              note = $3,
              paid_at = case when $2 = 'paid' then now() else paid_at end
        where id = $1
        returning id, status, decided_at`,
      [req.params.id, valider ? 'paid' : 'rejected', String(note || '').slice(0, 300) || null]
    );

    const compte = await query(
      'select plan, plan_expires_at from public.users where id = $1',
      [avant.rows[0].user_id]
    );

    await journal(valider ? 'paiement_valide' : 'paiement_refuse', avant.rows[0].user_id, {
      paiement: avant.rows[0].id,
      reference: avant.rows[0].provider_ref,
      note: note || null
    });

    res.json({
      ok: true,
      paiement: rows[0],
      compte: compte.rows[0] || null
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   RÉGLAGES — prix, durée, numéro Wave qui reçoit l'argent
   --------------------------------------------------------------------------- */
adminRouter.get('/reglages', async (_req, res, next) => {
  try {
    const r = await lireReglages(true);
    const o = await offre();
    res.json({ ok: true, reglages: r, offre: o });
  } catch (err) { next(err); }
});

adminRouter.post('/reglages', async (req, res, next) => {
  try {
    const r = await ecrireReglages(req.body || {});
    const o = await offre();
    await journal('reglages_paiement', null, { prix: r.prix_debout, duree: r.duree_jours });
    res.json({ ok: true, reglages: r, offre: o });
  } catch (err) {
    if (err && ['PRIX_INVALIDE', 'DUREE_INVALIDE', 'NUMERO_INVALIDE', 'PRIX_VISITE_INVALIDE'].includes(err.code)) {
      return next(new AppError(400, err.code, err.message));
    }
    next(err);
  }
});

/* ---------------------------------------------------------------------------
   COINS CHILL — les fiches envoyées par les promoteurs
   --------------------------------------------------------------------------- */
adminRouter.get('/lieux', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `select l.id, l.nom, l.type, l.commune, l.quartier, l.repere, l.telephone,
              l.horaires, l.budget, l.ambiance, l.description, l.statut,
              l.motif_refus, l.certifie, l.code_visite, l.prix_visite,
              l.created_at, l.updated_at, l.published_at,
              p.nom_gerant, p.phone as promoteur_phone,
              (select count(*)::int from public.visites v where v.lieu_id = l.id) as visites,
              (select coalesce(sum(v.prix), 0)::int from public.visites v
                where v.lieu_id = l.id and not v.reglee) as montant_du,
              (select count(*)::int from public.visites v
                where v.lieu_id = l.id and not v.reglee) as a_regler
         from public.lieux l
         join public.promoteurs p on p.id = l.promoteur_id
        order by (l.statut = 'en_attente') desc, l.created_at desc
        limit 300`
    );
    res.json({ ok: true, lieux: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/suggestions', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `select id, role, nom, ville, type, phone, message, traite, created_at
         from public.suggestions_lieux order by traite asc, created_at desc limit 200`
    );
    res.json({ ok: true, suggestions: rows });
  } catch (err) { next(err); }
});

adminRouter.post('/suggestions/:id/traite', async (req, res, next) => {
  try {
    const { rows } = await query(
      'update public.suggestions_lieux set traite = true where id = $1 returning id',
      [req.params.id]
    );
    if (!rows.length) throw new AppError(404, 'SUGGESTION_INTROUVABLE', 'Suggestion introuvable.');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/lieux/:id/publier', async (req, res, next) => {
  try {
    const { rows } = await query(
      `update public.lieux
          set statut = 'publie', motif_refus = null, reviewed_at = now(),
              published_at = coalesce(published_at, now()), updated_at = now()
        where id = $1 returning id, nom`,
      [req.params.id]
    );
    if (!rows.length) throw new AppError(404, 'LIEU_INTROUVABLE', 'Lieu introuvable.');
    await journal('lieu_publie', rows[0].id, { nom: rows[0].nom });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/lieux/:id/refuser', async (req, res, next) => {
  try {
    const motif = String((req.body || {}).motif || '').trim().slice(0, 300) || 'Fiche incomplète.';
    const { rows } = await query(
      `update public.lieux
          set statut = 'refuse', motif_refus = $2, reviewed_at = now(), updated_at = now()
        where id = $1 returning id, nom`,
      [req.params.id, motif]
    );
    if (!rows.length) throw new AppError(404, 'LIEU_INTROUVABLE', 'Lieu introuvable.');
    await journal('lieu_refuse', rows[0].id, { nom: rows[0].nom, motif });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

adminRouter.post('/lieux/:id/certifie', async (req, res, next) => {
  try {
    const certifie = (req.body || {}).certifie !== false;
    const { rows } = await query(
      'update public.lieux set certifie = $2, updated_at = now() where id = $1 returning id, certifie',
      [req.params.id, certifie]
    );
    if (!rows.length) throw new AppError(404, 'LIEU_INTROUVABLE', 'Lieu introuvable.');
    await journal('lieu_certifie', rows[0].id, { certifie });
    res.json({ ok: true, certifie: rows[0].certifie });
  } catch (err) { next(err); }
});

/* Supprime définitivement un lieu (et ses visites). */
adminRouter.delete('/lieux/:id', async (req, res, next) => {
  try {
    const { rows: avant } = await query(
      `select l.id, l.nom, l.statut, p.phone as promoteur_phone,
              (select count(*)::int from public.visites v where v.lieu_id = l.id) as visites,
              (select coalesce(sum(v.prix), 0)::int from public.visites v
                where v.lieu_id = l.id and not v.reglee) as montant_du
         from public.lieux l join public.promoteurs p on p.id = l.promoteur_id
        where l.id = $1`,
      [req.params.id]
    );
    if (!avant.length) throw new AppError(404, 'LIEU_INTROUVABLE', 'Lieu introuvable.');

    await query('delete from public.lieux where id = $1', [req.params.id]);

    await journal('lieu_supprime', req.params.id, {
      nom: avant[0].nom, statut: avant[0].statut,
      visites: avant[0].visites, montant_du: avant[0].montant_du
    });

    res.json({ ok: true, supprime: avant[0].nom });
  } catch (err) { next(err); }
});

/* Marque les visites du lieu comme réglées (le gérant a payé). */
adminRouter.post('/lieux/:id/regler', async (req, res, next) => {
  try {
    const { rows } = await query(
      `update public.visites
          set reglee = true, regle_at = now()
        where lieu_id = $1 and not reglee
        returning prix`,
      [req.params.id]
    );
    const montant = rows.reduce((n, r) => n + r.prix, 0);
    if (rows.length) await journal('visites_reglees', req.params.id, { nombre: rows.length, montant });
    res.json({ ok: true, reglees: rows.length, montant });
  } catch (err) { next(err); }
});
