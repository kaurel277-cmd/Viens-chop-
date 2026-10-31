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
/* Photo d'un lieu : même circuit que les photos de profil des membres.
   140 Ko décodés : une photo de terrasse reste nette sur un téléphone. */
const PHOTO_MAX_BYTES = 140 * 1024;
const PHOTO_MIMES = ['image/webp', 'image/jpeg'];

/** Vérifie la signature réelle du fichier, pas seulement le type annoncé. */
function signaturePhoto(buf) {
  if (!buf || buf.length < 12) return null;
  const estJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (estJpeg) return 'image/jpeg';
  const estWebp = buf.slice(0, 4).toString('latin1') === 'RIFF' &&
                  buf.slice(8, 12).toString('latin1') === 'WEBP';
  if (estWebp) return 'image/webp';
  return null;
}

function decodePhoto(data, mime) {
  if (!PHOTO_MIMES.includes(mime)) {
    throw new AppError(400, 'FORMAT_INVALIDE', 'Formats acceptés : WebP ou JPEG.');
  }
  const clean = String(data || '').replace(/^data:[^;]+;base64,/, '');
  // 140 Ko décodés ≈ 187 000 caractères en base64
  if (clean.length > 200000) {
    throw new AppError(413, 'PHOTO_TROP_LOURDE', 'Photo trop lourde (140 Ko maximum).');
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) {
    throw new AppError(400, 'PHOTO_INVALIDE', 'Image illisible.');
  }
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) throw new AppError(400, 'PHOTO_VIDE', 'Image vide.');
  if (buf.length > PHOTO_MAX_BYTES) {
    throw new AppError(413, 'PHOTO_TROP_LOURDE', 'Photo trop lourde (140 Ko maximum).');
  }
  const reel = signaturePhoto(buf);
  if (!reel) throw new AppError(400, 'PHOTO_INVALIDE', "Ce fichier n'est pas une image WebP ou JPEG.");
  return { buf, mime: reel };
}

/** Le message quand la base n'a pas encore les colonnes photo. */
function photoIndisponible(err) {
  return err && err.code === '42703';   // colonne inexistante
}

const AMBIANCES = ['calme', 'anime', 'terrasse', 'famille'];

const net = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
/**
 * Met un nom de lieu en forme : « yopougon » → « Yopougon »,
 * « abidjan — port-bouët » → « Abidjan — Port-Bouët ». Les petits mots
 * (de, du, la, des…) restent en minuscules sauf en tête.
 * Sert à garder des communes et des quartiers comparables entre eux.
 */
const PETITS_MOTS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'en', 'sur', 'et', 'd', 'l']);
function enForme(v, max) {
  const propre = net(v, max);
  if (!propre) return '';
  const mots = propre.split(/(\s+)/);
  let rang = 0;
  return mots.map(mot => {
    if (/^\s+$/.test(mot) || !mot) return mot;
    const iMot = rang++;
    return mot.split('-').map((morceau, i) => {
      const bas = morceau.toLowerCase();
      const petit = iMot > 0 && i === 0 && PETITS_MOTS.has(bas);
      const [premier, ...suite] = Array.from(bas);
      return (petit ? bas : (premier || '').toUpperCase() + suite.join('')) + '';
    }).join('-');
  }).join('');
}

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
    const lire = async (avecPhoto) => await query(
      `select id, nom, type, commune, quartier, repere, telephone, horaires, budget,
              ambiance, description, statut, motif_refus, certifie, code_visite,
              prix_visite, published_at, updated_at` +
      (avecPhoto
        ? `,
              (photo is not null) as a_photo,
              extract(epoch from photo_at)::bigint as photo_v`
        : ``) +
      ` from public.lieux where promoteur_id = $1
        order by created_at asc limit 1`,
      [req.promoteur.id]
    );

    // Tant que MIGRATION-PHOTOS-LIEUX.sql n'est pas passée, on lit la fiche
    // sans les colonnes photo : l'espace promoteur reste utilisable.
    let rows;
    try {
      ({ rows } = await lire(true));
    } catch (err) {
      if (!photoIndisponible(err)) throw err;
      ({ rows } = await lire(false));
    }

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

    if (lieu && lieu.a_photo) {
      lieu.photo_url = '/api/lieux/' + lieu.id + '/photo?v=' + (lieu.photo_v || 0);
    }
    if (lieu) { delete lieu.a_photo; delete lieu.photo_v; }

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
    const commune = enForme(b.commune, 50);
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
      quartier: enForme(b.quartier, 80) || null,
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

/* ---------------------------------------------------------------------------
   La photo du lieu

   POST   /api/promoteurs/photo  { data, mime }   envoie ou remplace la photo
   DELETE /api/promoteurs/photo                   retire la photo

   La photo est stockée dans Neon, comme les photos de profil : le disque de
   Render est effacé à chaque déploiement.

   Envoyer une photo renvoie la fiche en vérification (même règle que pour le
   reste de la fiche) : une image publiée ne change pas sans être relue.
   --------------------------------------------------------------------------- */
promoteursRouter.post('/photo', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { buf, mime } = decodePhoto(b.data, b.mime);

    const { rows: fiche } = await query(
      'select id, statut from public.lieux where promoteur_id = $1 order by created_at asc limit 1',
      [req.promoteur.id]
    );
    if (!fiche.length) {
      throw new AppError(404, 'FICHE_ABSENTE', "Remplis d'abord la fiche de ton lieu, puis ajoute la photo.");
    }

    let statut = fiche[0].statut;
    try {
      const { rows } = await query(
        `update public.lieux
            set photo = $2, photo_mime = $3, photo_bytes = $4, photo_at = now(),
                statut = case when statut = 'publie' then 'en_attente' else statut end,
                reviewed_at = case when statut = 'publie' then null else reviewed_at end,
                updated_at = now()
          where id = $1
          returning statut, extract(epoch from photo_at)::bigint as v`,
        [fiche[0].id, buf, mime, buf.length]
      );
      statut = rows[0].statut;
      res.status(201).json({
        ok: true,
        photo: { url: '/api/lieux/' + fiche[0].id + '/photo?v=' + rows[0].v, bytes: buf.length, mime },
        statut
      });
    } catch (err) {
      if (!photoIndisponible(err)) throw err;
      throw new AppError(503, 'PHOTOS_NON_ACTIVEES',
        "L'envoi de photos sera actif dès que la base est mise à jour (voir database/MIGRATION-PHOTOS-LIEUX.sql).");
    }
  } catch (err) { next(err); }
});

promoteursRouter.delete('/photo', async (req, res, next) => {
  try {
    try {
      const { rows } = await query(
        `update public.lieux
            set photo = null, photo_mime = null, photo_bytes = null, photo_at = null,
                updated_at = now()
          where promoteur_id = $1
          returning id`,
        [req.promoteur.id]
      );
      if (!rows.length) throw new AppError(404, 'FICHE_ABSENTE', 'Aucune fiche à modifier.');
      res.json({ ok: true });
    } catch (err) {
      if (!photoIndisponible(err)) throw err;
      throw new AppError(503, 'PHOTOS_NON_ACTIVEES', "Les photos ne sont pas encore activées en base.");
    }
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

    const lire = async (avecPhoto) => await query(
      `select nom, type, commune, quartier, repere, horaires, budget, ambiance,
              description, certifie, id` +
      (avecPhoto ? `,
              (photo is not null) as photo,
              coalesce(extract(epoch from photo_at)::bigint, 0) as photo_v` : ``) +
      ` from public.lieux
        where statut = 'publie'
          and ($1 = '' or commune = $1)
          and ($2 = '' or quartier = $2)
        order by certifie desc, nom asc
        limit 200`,
      [commune, quartier]
    );

    // Sans les colonnes photo (migration pas encore passée), la liste
    // s'affiche quand même : aucune photo, simplement.
    let rows;
    try {
      ({ rows } = await lire(true));
    } catch (err) {
      if (!photoIndisponible(err)) throw err;
      ({ rows } = await lire(false));
    }

    // Les communes qui ont au moins un lieu : la liste déroulante ne propose
    // que ce qui existe vraiment, sans jamais bloquer sur une liste vide.
    const { rows: communes } = await query(
      `select commune, count(*)::int as n from public.lieux
        where statut = 'publie' group by commune order by commune asc`
    );

    res.json({ ok: true, lieux: rows, communes });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/lieux/:id/photo — sert la photo d'un lieu
   Pas de jeton : une balise <img> ne peut pas envoyer d'en-tête. L'identifiant
   est un UUID aléatoire, impossible à deviner (même règle que les photos de
   profil des membres).
   --------------------------------------------------------------------------- */
lieuxPublicRouter.get('/:id/photo', async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      throw new AppError(400, 'ID_INVALIDE', 'Identifiant invalide.');
    }
    let rows;
    try {
      ({ rows } = await query(
        'select photo_mime, photo from public.lieux where id = $1',
        [req.params.id]
      ));
    } catch (err) {
      if (!photoIndisponible(err)) throw err;
      rows = [];
    }
    if (!rows.length || !rows[0].photo) {
      throw new AppError(404, 'PHOTO_ABSENTE', "Ce lieu n'a pas de photo.");
    }
    res.set('Content-Type', rows[0].photo_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    // L'API (onrender.com) et le site (github.io) sont deux domaines
    // différents : sans cet en-tête, le navigateur refuse l'image
    // (helmet met « same-origin » par défaut).
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(rows[0].photo);
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
