import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { evaluerPhoto } from '../moderation.js';
import { aModeration } from '../capabilities.js';

export const photosRouter = Router();

/* ---------------------------------------------------------------------------
   Photos de profil — stockées dans Neon, en petit format.

   Pourquoi ici et pas sur Render : le disque de Render est effacé à chaque
   redéploiement. Neon garde les données.

   Budget : 3 photos × 120 Ko maximum par personne. Le navigateur compresse
   déjà à ~60–100 Ko avant l'envoi (assets/js/media.js).

   Les médias « vue unique » du chat ne passent JAMAIS par ici : ils ne sont
   pas stockés côté serveur, par choix de confidentialité.
   --------------------------------------------------------------------------- */

const MAX_BYTES = 110 * 1024;          // 110 Ko décodés
const MIMES = ['image/webp', 'image/jpeg'];
const MAX_PHOTOS = 3;

function decodeBase64(data) {
  const clean = String(data || '').replace(/^data:[^;]+;base64,/, '');
  // Vérification rapide avant de décoder : 110 Ko ≈ 147 000 caractères base64
  if (clean.length > 160000) throw new AppError(413, 'PHOTO_TROP_LOURDE', 'Photo trop lourde (110 Ko maximum).');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new AppError(400, 'PHOTO_INVALIDE', 'Image illisible.');
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) throw new AppError(400, 'PHOTO_VIDE', 'Image vide.');
  if (buf.length > MAX_BYTES) throw new AppError(413, 'PHOTO_TROP_LOURDE', 'Photo trop lourde (110 Ko maximum).');
  return buf;
}

/* ---------------------------------------------------------------------------
   POST /api/photos — ajoute ou remplace une photo
   body : { data: base64, mime, position: 0..2 }
   --------------------------------------------------------------------------- */
photosRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { data, mime, position, metrics } = req.body || {};
    const pos = Number.isInteger(position) ? position : 0;

    if (pos < 0 || pos > MAX_PHOTOS - 1) {
      throw new AppError(400, 'POSITION_INVALIDE', 'Emplacement de photo invalide.');
    }
    if (!MIMES.includes(mime)) {
      throw new AppError(400, 'FORMAT_INVALIDE', 'Formats acceptés : WebP ou JPEG.');
    }

    const buf = decodeBase64(data);

    const { rows: countRows } = await query(
      'select count(*)::int as n from public.photos where user_id = $1',
      [req.user.id]
    );
    const { rows: existing } = await query(
      'select id from public.photos where user_id = $1 and position = $2',
      [req.user.id, pos]
    );
    if (countRows[0].n >= MAX_PHOTOS && !existing.length) {
      throw new AppError(409, 'TROP_DE_PHOTOS', `${MAX_PHOTOS} photos maximum.`);
    }

    // Modération automatique : le verdict est calculé avant l'écriture.
    const verdict = evaluerPhoto(metrics);
    const modere = await aModeration();

    const { rows } = modere
      ? await query(
          `insert into public.photos (user_id, position, mime, bytes, data,
                                      moderation_status, moderation_score, moderation_note)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, position, bytes, created_at, moderation_status, moderation_note`,
          [req.user.id, pos, mime, buf.length, buf, verdict.status, verdict.score, verdict.note]
        )
      : await query(
          `insert into public.photos (user_id, position, mime, bytes, data)
           values ($1, $2, $3, $4, $5)
           returning id, position, bytes, created_at`,
          [req.user.id, pos, mime, buf.length, buf]
        );

    if (pos === 0) {
      await query('update public.users set main_photo_id = $2 where id = $1', [req.user.id, rows[0].id]);
    }

    res.status(201).json({
      ok: true,
      photo: {
        id: rows[0].id,
        position: rows[0].position,
        bytes: rows[0].bytes,
        url: photoUrl(rows[0].id),
        moderation: modere
          ? { status: rows[0].moderation_status, note: rows[0].moderation_note || null }
          : null
      }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/photos/me — mes photos (les plus récentes en premier)
   --------------------------------------------------------------------------- */
photosRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const modere = await aModeration();
    const { rows } = await query(
      modere
        ? `select id, position, bytes, created_at, moderation_status, moderation_note
             from public.photos where user_id = $1 order by position asc`
        : `select id, position, bytes, created_at from public.photos
            where user_id = $1 order by position asc`,
      [req.user.id]
    );
    res.json({ ok: true, photos: rows.map(r => ({ ...r, url: photoUrl(r.id) })) });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   DELETE /api/photos/:id
   --------------------------------------------------------------------------- */
photosRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'delete from public.photos where id = $1 and user_id = $2 returning id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw new AppError(404, 'PHOTO_INTROUVABLE', 'Photo introuvable.');

    await query(
      `update public.users set main_photo_id = (
         select id from public.photos where user_id = $1 order by position asc limit 1
       ) where id = $1`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/photos/:id — sert l'image
   L'identifiant est un UUID aléatoire, impossible à deviner.
   Pas de jeton : une balise <img> ne peut pas envoyer d'en-tête.
   --------------------------------------------------------------------------- */
photosRouter.get('/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      throw new AppError(400, 'ID_INVALIDE', 'Identifiant invalide.');
    }
    const modere = await aModeration();
    const { rows } = await query(
      modere
        ? `select mime, data, moderation_status from public.photos where id = $1`
        : `select mime, data, 'ok' as moderation_status from public.photos where id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw new AppError(404, 'PHOTO_INTROUVABLE', 'Photo introuvable.');
    // Une photo retirée par la modération n'est plus servie à personne.
    if (rows[0].moderation_status === 'blocked') {
      throw new AppError(404, 'PHOTO_RETIREE', 'Cette photo a été retirée.');
    }

    res.set('Content-Type', rows[0].mime);
    // 5 minutes et non 24 h : une photo retirée par la modération doit
    // disparaître vite des navigateurs qui l'ont déjà affichée.
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    // L'API et le site sont sur deux domaines différents : sans cet en-tête,
    // le navigateur refuse d'afficher l'image (helmet met same-origin).
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(rows[0].data);
  } catch (err) { next(err); }
});

export function photoUrl(id) {
  return `/api/photos/${id}`;
}
