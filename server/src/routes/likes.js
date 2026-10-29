import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';

export const likesRouter = Router();

/* ---------------------------------------------------------------------------
   POST /api/likes — liker un profil
   Le quota de 3/jour est appliqué par un trigger PostgreSQL : même si cette
   route est contournée, la base refuse le 4ᵉ like.
   --------------------------------------------------------------------------- */
likesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.body || {};
    if (!user_id) throw new AppError(400, 'CIBLE_MANQUANTE', 'Profil ciblé manquant.');
    if (user_id === req.user.id) throw new AppError(400, 'AUTO_LIKE', 'Tu ne peux pas te liker toi-même.');

    const exists = await query('select 1 from public.users where id = $1', [user_id]);
    if (!exists.rowCount) throw new AppError(404, 'PROFIL_INTROUVABLE', 'Profil introuvable.');

    const { rows } = await query(
      `insert into public.likes (sender_id, receiver_id) values ($1, $2)
       returning id, created_at`,
      [req.user.id, user_id]
    );

    // Le trigger a pu créer un match
    const { rows: m } = await query(
      `select id, created_at from public.matches
        where (user_a = least($1::uuid, $2::uuid) and user_b = greatest($1::uuid, $2::uuid))`,
      [req.user.id, user_id]
    );

    const { rows: u } = await query(
      'select likes_today, likes_reset_at from public.users where id = $1',
      [req.user.id]
    );

    const today = u[0].likes_reset_at?.toISOString?.().slice(0, 10) === new Date().toISOString().slice(0, 10);
    const used = today ? u[0].likes_today : 0;

    res.status(201).json({
      ok: true,
      like: rows[0],
      matched: m.length > 0,
      match_id: m[0]?.id ?? null,
      likes_left: req.isDebout ? null : Math.max(0, 3 - used)
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   DELETE /api/likes/:id — annuler un like (pas de match en cours)
   --------------------------------------------------------------------------- */
likesRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      'delete from public.likes where id = $1 and sender_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) throw new AppError(404, 'LIKE_INTROUVABLE', 'Like introuvable.');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/likes/who-liked-me — la liste est offerte, la photo est un
   avantage Mode Debout (ce n'est pas un flou : rien n'est affiché si la
   photo n'est pas débloquée, et la photo du fil reste visible partout).
   --------------------------------------------------------------------------- */
likesRouter.get('/who-liked-me', requireAuth, async (req, res, next) => {
  try {
    // Requête directe (au lieu de la vue who_liked_me) pour utiliser les
    // photos stockées en base : main_photo_id -> /api/photos/<id>.
    // Photo réservée au Mode Debout ; aucun flou nulle part ailleurs.
    const { rows } = await query(
      `select l.id              as like_id,
              u.id              as user_id,
              u.pseudo,
              u.age,
              u.commune,
              u.artists,
              u.is_certified,
              case when $2 then u.main_photo_id end as photo_id,
              $2 as photo_visible,
              l.created_at
         from public.likes l
         join public.users u on u.id = l.sender_id
        where l.receiver_id = $1
        order by l.created_at desc
        limit 100`,
      [req.user.id, req.isDebout]
    );

    res.json({
      ok: true,
      is_debout: req.isDebout,
      likes: rows.map(r => ({
        ...r,
        photo_url: r.photo_id ? `/api/photos/${r.photo_id}` : null
      }))
    });
  } catch (err) { next(err); }
});
