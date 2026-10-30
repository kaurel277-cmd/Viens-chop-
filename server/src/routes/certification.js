import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { aVerifications } from '../capabilities.js';

export const certificationRouter = Router();

/* ---------------------------------------------------------------------------
   Vérification d'identité par selfie.

   Fonctionnement réel (aucune promesse en l'air) :
     1. la personne prend un selfie dans l'application ;
     2. le selfie est envoyé ici et gardé dans Neon, en petit format ;
     3. il apparaît dans la console d'administration, à côté de la photo de
        profil, et un humain compare les deux ;
     4. validé  -> users.is_certified = true, le badge « Vérifié » s'affiche ;
        refusé  -> la personne peut recommencer.
     5. dans les deux cas le selfie est effacé de la base (colonne selfie = NULL).

   Pourquoi pas une comparaison automatique : il n'existe pas de modèle
   gratuit fiable qui tourne sur l'offre gratuite de Render. Mieux vaut une
   vraie vérification humaine qu'un badge qui ne veut rien dire.
   --------------------------------------------------------------------------- */

const MAX_BYTES = 120 * 1024;
const MIMES = ['image/webp', 'image/jpeg'];

function decodeSelfie(data) {
  const clean = String(data || '').replace(/^data:[^;]+;base64,/, '');
  if (clean.length > 175000) throw new AppError(413, 'SELFIE_TROP_LOURDE', 'Selfie trop lourd (120 Ko maximum).');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new AppError(400, 'SELFIE_INVALIDE', 'Image illisible.');
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) throw new AppError(400, 'SELFIE_VIDE', 'Image vide.');
  if (buf.length > MAX_BYTES) throw new AppError(413, 'SELFIE_TROP_LOURDE', 'Selfie trop lourd (120 Ko maximum).');
  return buf;
}

/* ---------------------------------------------------------------------------
   GET /api/certification/me — où en est ma vérification ?
   --------------------------------------------------------------------------- */
certificationRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    if (!(await aVerifications())) {
      return res.json({ ok: true, disponible: false, status: 'indisponible', is_certified: !!req.user.is_certified });
    }
    const { rows } = await query(
      `select status, note, created_at, reviewed_at
         from public.verifications
        where user_id = $1
        order by created_at desc
        limit 1`,
      [req.user.id]
    );
    res.json({
      ok: true,
      disponible: true,
      status: req.user.is_certified ? 'approved' : (rows[0] ? rows[0].status : 'none'),
      derniere: rows[0] || null,
      is_certified: !!req.user.is_certified
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/certification/selfie — body { data (base64), mime }
   --------------------------------------------------------------------------- */
certificationRouter.post('/selfie', requireAuth, async (req, res, next) => {
  try {
    if (!(await aVerifications())) {
      throw new AppError(503, 'VERIFICATION_INDISPONIBLE',
        "La vérification s'active dès que la base est mise à jour.");
    }
    if (req.user.is_certified) {
      return res.json({ ok: true, status: 'approved', message: 'Ton profil est déjà vérifié.' });
    }

    const { data, mime } = req.body || {};
    if (!MIMES.includes(mime)) throw new AppError(400, 'FORMAT_INVALIDE', 'Formats acceptés : WebP ou JPEG.');
    const buf = decodeSelfie(data);

    const dejaEnAttente = await query(
      `select id from public.verifications where user_id = $1 and status = 'pending' limit 1`,
      [req.user.id]
    );

    if (dejaEnAttente.rows.length) {
      await query(
        `update public.verifications
            set mime = $2, bytes = $3, selfie = $4, created_at = now()
          where id = $1`,
        [dejaEnAttente.rows[0].id, mime, buf.length, buf]
      );
    } else {
      await query(
        `insert into public.verifications (user_id, mime, bytes, selfie)
         values ($1, $2, $3, $4)`,
        [req.user.id, mime, buf.length, buf]
      );
    }

    res.status(201).json({
      ok: true,
      status: 'pending',
      message: 'Selfie reçu. La vérification est faite à la main, sous 24 h.'
    });
  } catch (err) { next(err); }
});
