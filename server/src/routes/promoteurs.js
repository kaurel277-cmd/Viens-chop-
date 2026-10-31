import { Router } from 'express';
import { query } from '../db.js';
import { signPromoteurToken, requirePromoteur, requireAuth } from '../auth.js';
import { normalizePhone } from './auth.js';
import { hashPassword, verifyPassword, passwordProblem } from '../password.js';
import { AppError } from '../errors.js';
import { lireReglages } from '../reglages.js';
import { config } from '../config.js';

/* ---------------------------------------------------------------------------
   Espace promoteurs : les gérants de maquis, restos, cafés et lounges
   inscrivent leur établissement. Comptes strictement séparés des membres.

   Formule facturée : LA VISITE.
     - le gérant ne paie rien pour figurer ;
     - il paie chaque couple qui arrive avec l'app et saisit le code du lieu ;
     - un même membre ne compte qu'une visite par jour et par lieu.

   Rien ne se publie sans la validation de l'administrateur.
   --------------------------------------------------------------------------- */

export const promoteursRouter = Router();
export const suggestionsRouter = Router();
export const lieuxPublicRouter = Router();

const TYPES = ['maquis', 'restaurant', 'cafe', 'lounge', 'terrasse', 'autre'];
const AMBIANCES = ['calme', 'anime', 'terrasse', 'famille'];

const net = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
const entier = (v, min, max) => {
  const n = Number(String(v == null ? '' : v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};

/** Code du comptoir : 6 caractères, sans I, O, 0 ni 1 (lisibles à voix haute). */
function codeAleatoire() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

async function codeLibre() {
  for (let essai = 0; essai < 12; essai++) {
    const code = codeAleatoire();
    const { rows } = await query('select 1 from public.lieux where code_visite = $1', [code]);
    if (!rows.length) return code;
  }
  throw new AppError(503, 'CODE_IMPOSSIBLE', 'Réessaie dans un instant.');
}

/** Le prix d'une visite, réglable dans la console (500 FCFA par défaut). */
async function prixVisite() {
  const r = await lireReglages();
  return Number(r.prix_visite) || 500;
}

function lienArrivee() {
  return String(config.siteUrl || '').replace(/\/+$/, '') + '/arrivee.html';
}

/* ---------------------------------------------------------------------------
   POST /api/promoteurs/inscription — { nom_gerant, phone, password }
   --------------------------------------------------------------------------- */
promoteursRouter.post('/inscription', async (req, res, next) => {
  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone);
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide. Exemple : 07 00 00 00 00.');

    const nomGerant = net(body.nom_gerant, 80);
    if (nomGerant.length < 2) {
      throw new AppError(400, 'NOM_INVALIDE', 'Indique le nom du gérant (2 lettres minimum).');
    }

    const pb = passwordProblem(body.password);
    if (pb) throw new AppError(400, pb, 'Le mot de passe doit contenir au moins 6 caractères.');

    const existe = await query('select id from public.promoteurs where phone = $1', [phone]);
    if (existe.rows.length) {
      throw new AppError(409, 'TELEPHONE_DEJA_UTILISE', 'Ce numéro a déjà un espace promoteur. Connecte-toi.');
    }

    const { rows } = await query(
      `insert into public.promoteurs (phone, password_hash, nom_gerant)
       values ($1, $2, $3) returning id, phone, nom_gerant`,
      [phone, hashPassword(body.password), nomGerant]
    );

    res.status(201).json({
      ok: true,
      access_token: signPromoteurToken(rows[0]),
      promoteur: { id: rows[0].id, nom_gerant: rows[0].nom_gerant, phone: rows[0].phone }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/promoteurs/connexion — { phone, password }
   --------------------------------------------------------------------------- */
promoteursRouter.post('/connexion', async (req, res, next) => {
  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone);
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide.');

    const { rows } = await query(
      'select id, phone, nom_gerant, password_hash from public.promoteurs where phone = $1',
      [phone]
    );
    // Même message dans les deux cas : on n'apprend pas à un inconnu quels
    // numéros ont un compte.
    if (!rows.length || !verifyPassword(String(body.password || ''), rows[0].password_hash)) {
      throw new AppError(401, 'IDENTIFIANTS_INCORRECTS', 'Numéro ou mot de passe incorrect.');
    }

    await query('update public.promoteurs set last_login_at = now() where id = $1', [rows[0].id]);

    res.json({
      ok: true,
      access_token: signPromoteurToken(rows[0]),
      promoteur: { id: rows[0].id, nom_gerant: rows[0].nom_gerant, phone: rows[0].phone }
    });
  } catch (err) { next(err); }
});

/* Tout ce qui suit exige un jeton promoteur. */
promoteursRouter.use(requirePromoteur);

/* ---------------------------------------------------------------------------
   GET /api/promoteurs/moi — la fiche, son statut, et les visites reçues
   --------------------------------------------------------------------------- */
promoteursRouter.get('/moi', async (req, res, next) => {
  try {
    const { rows } = await query(
      `select id, nom, type, commune, quartier, repere, telephone, horaires, budget,
              ambiance, description, statut, motif_refus, certifie, code_visite,
              prix_visite, published_at, updated_at
         from public.lieux where promoteur_id = $1
        order by created_at asc limit 1`,
      [req.promoteur.id]
    );

    const lieu = rows[0] || null;
    let visites = { total: 0, du: 0, montant_du: 0, ce_mois: 0 };

    if (lieu) {
      const { rows: v } = await query(
        `select count(*)::int as total,
                count(*) filter (where not reglee)::int as impayees,
                coalesce(sum(prix) filter (where not reglee), 0)::int as montant_du,
                count(*) filter (where date_trunc('month', created_at) = date_trunc('month', now()))::int as ce_mois
           from public.visites where lieu_id = $1`,
        [lieu.id]
      );
      visites = {
        total: v[0].total,
        a_regler: v[0].impayees,
        montant_du: v[0].montant_du,
        ce_mois: v[0].ce_mois
      };
    }

    res.json({
      ok: true,
      promoteur: { nom_gerant: req.promoteur.nom_gerant, phone: req.promoteur.phone },
      lieu,
      visites,
      prix_visite: await prixVisite(),
      lien_arrivee: lienArrivee()
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/promoteurs/lieu — crée ou modifie la fiche
   Toute modification renvoie la fiche en vérification : une fiche publiée ne
   peut pas changer de nom ou d'adresse sans être relue.
   --------------------------------------------------------------------------- */
promoteursRouter.post('/lieu', async (req, res, next) => {
  try {
    const b = req.body || {};

    const nom = net(b.nom, 80);
    const commune = net(b.commune, 50);
    const telephone = normalizePhone(b.telephone);

    if (nom.length < 2) throw new AppError(400, 'NOM_INVALIDE', 'Indique le nom du lieu (2 lettres minimum).');
    if (commune.length < 2) throw new AppError(400, 'COMMUNE_INVALIDE', 'Indique la commune ou la ville.');
    if (!telephone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro du lieu invalide. Exemple : 07 00 00 00 00.');

    const type = TYPES.includes(b.type) ? b.type : 'autre';
    const ambiance = AMBIANCES.includes(b.ambiance) ? b.ambiance : null;
    const budget = b.budget === undefined || b.budget === '' || b.budget === null ? null : entier(b.budget, 0, 500000);

    const champs = {
      nom,
      type,
      commune,
      quartier: net(b.quartier, 80) || null,
      repere: net(b.repere, 200) || null,
      telephone,
      horaires: net(b.horaires, 120) || null,
      budget,
      ambiance,
      description: net(b.description, 400) || null
    };

    const existant = await query('select id from public.lieux where promoteur_id = $1 limit 1', [req.promoteur.id]);

    if (!existant.rows.length) {
      const prix = await prixVisite();
      const { rows } = await query(
        `insert into public.lieux
           (promoteur_id, nom, type, commune, quartier, repere, telephone,
            horaires, budget, ambiance, description, code_visite, prix_visite)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning id, statut, code_visite`,
        [req.promoteur.id, champs.nom, champs.type, champs.commune, champs.quartier,
         champs.repere, champs.telephone, champs.horaires, champs.budget,
         champs.ambiance, champs.description, await codeLibre(), prix]
      );
      return res.status(201).json({ ok: true, cree: true, lieu: rows[0] });
    }

    const { rows } = await query(
      `update public.lieux
          set nom = $2, type = $3, commune = $4, quartier = $5, repere = $6,
              telephone = $7, horaires = $8, budget = $9, ambiance = $10,
              description = $11,
              statut = 'en_attente', motif_refus = null, reviewed_at = null,
              updated_at = now()
        where promoteur_id = $1
        returning id, statut, code_visite`,
      [req.promoteur.id, champs.nom, champs.type, champs.commune, champs.quartier,
       champs.repere, champs.telephone, champs.horaires, champs.budget,
       champs.ambiance, champs.description]
    );

    res.json({ ok: true, cree: false, lieu: rows[0] });
  } catch (err) { next(err); }
});

/* ===========================================================================
   VISITES — le client saisit le code affiché au comptoir
   =========================================================================== */

export const visitesRouter = Router();

visitesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    // Plus de code à recopier : le client appuie sur « J'y suis arrivé »
    // depuis la fiche du lieu, on reçoit simplement son identifiant.
    const id = String((req.body && req.body.lieu_id) || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(400, 'LIEU_INVALIDE', 'Choisis un lieu dans la liste.');
    }

    const { rows } = await query(
      `select id, nom, commune, quartier, certifie
         from public.lieux where id = $1 and statut = 'publie'`,
      [id]
    );
    if (!rows.length) {
      throw new AppError(404, 'LIEU_INTROUVABLE', "Ce lieu n'est pas (ou plus) publié.");
    }
    const lieu = rows[0];

    const prix = await prixVisite();

    // Une seule visite comptée par jour et par lieu : le doublon est ignoré
    // (on conflict do nothing) et on le dit honnêtement à l'écran.
    const insert = await query(
      `insert into public.visites (lieu_id, user_id, prix)
       values ($1, $2, $3)
       on conflict (lieu_id, user_id, jour) do nothing
       returning id`,
      [lieu.id, req.user.id, prix]
    );

    res.json({
      ok: true,
      deja: insert.rows.length === 0,
      lieu: { nom: lieu.nom, commune: lieu.commune, quartier: lieu.quartier, certifie: lieu.certifie }
    });
  } catch (err) { next(err); }
});

/* ===========================================================================
   LA LISTE PUBLIQUE — les lieux validés par l'administrateur
   =========================================================================== */

lieuxPublicRouter.get('/', async (req, res, next) => {
  try {
    const commune = net(req.query.commune, 50);
    const quartier = net(req.query.quartier, 80);

    const { rows } = await query(
      `select nom, type, commune, quartier, repere, horaires, budget, ambiance,
              description, certifie, id
         from public.lieux
        where statut = 'publie'
          and ($1 = '' or commune = $1)
          and ($2 = '' or quartier = $2)
        order by certifie desc, nom asc
        limit 200`,
      [commune, quartier]
    );

    // Les communes qui ont au moins un lieu : la liste déroulante ne propose
    // que ce qui existe vraiment, sans jamais bloquer sur une liste vide.
    const { rows: communes } = await query(
      `select commune, count(*)::int as n from public.lieux
        where statut = 'publie' group by commune order by commune asc`
    );

    res.json({ ok: true, lieux: rows, communes });
  } catch (err) { next(err); }
});

/* ===========================================================================
   SUGGESTIONS — un membre recommande un lieu (page Coins Chill)
   =========================================================================== */
suggestionsRouter.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const nom = net(b.nom, 80);
    const ville = net(b.ville, 50);
    const phone = normalizePhone(b.phone);

    if (nom.length < 2) throw new AppError(400, 'NOM_INVALIDE', 'Indique le nom du lieu.');
    if (ville.length < 2) throw new AppError(400, 'VILLE_INVALIDE', 'Indique la commune ou la ville.');
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro invalide. Exemple : 07 00 00 00 00.');

    await query(
      `insert into public.suggestions_lieux (role, nom, ville, type, phone, message)
       values ($1, $2, $3, $4, $5, $6)`,
      [b.role === 'gerant' ? 'gerant' : 'membre', nom, ville, net(b.type, 30) || null, phone, net(b.message, 500) || null]
    );

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});
