import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';

export const usersRouter = Router();

const SEEKING_RULE = { M: 'F', F: 'A' };

/* ---------------------------------------------------------------------------
   POST /api/users/me — finalise le profil juste après l'inscription
   --------------------------------------------------------------------------- */
usersRouter.post('/me', requireAuth, async (req, res, next) => {
  try {
    const { pseudo, birth_date, gender, commune, artists, bio } = req.body || {};

    if (pseudo !== undefined) {
      const p = String(pseudo).trim();
      if (p.length < 2 || p.length > 20) {
        throw new AppError(400, 'PSEUDO_INVALIDE', 'Le pseudo doit faire entre 2 et 20 caractères.');
      }
    }
    if (commune !== undefined && String(commune).trim().length < 2) {
      throw new AppError(400, 'COMMUNE_INVALIDE', 'Choisis une commune ou une ville.');
    }
    if (gender !== undefined && !['M', 'F'].includes(gender)) {
      throw new AppError(400, 'GENRE_INVALIDE', 'Genre invalide.');
    }
    if (artists !== undefined && (!Array.isArray(artists) || artists.length > 12)) {
      throw new AppError(400, 'ARTISTES_INVALIDE', '12 artistes maximum.');
    }

    // seeking n'est jamais fourni par le client : il est déduit côté serveur
    const seeking = gender ? SEEKING_RULE[gender] : undefined;

    const { rows } = await query(
      `update public.users set
         pseudo   = coalesce($2, pseudo),
         birth_date = coalesce($3::date, birth_date),
         gender   = coalesce($4, gender),
         seeking  = coalesce($5, seeking),
         commune  = coalesce($6, commune),
         artists  = coalesce($7::text[], artists),
         bio      = coalesce($8, bio)
       where id = $1
       returning id, pseudo, age, is_adult, gender, seeking, commune, artists, bio, plan`,
      [
        req.user.id,
        pseudo ?? null,
        birth_date ?? null,
        gender ?? null,
        seeking ?? null,
        commune ?? null,
        artists ?? null,
        bio ?? null
      ]
    );

    res.json({ ok: true, user: rows[0] });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/users/:id — profil public
   La photo n'est renvoyée que si un match existe ET qu'il est débloqué.
   --------------------------------------------------------------------------- */
usersRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select u.id, u.pseudo, u.age, u.gender, u.commune, u.artists, u.bio,
              u.is_certified, u.last_seen_at,
              exists (
                select 1 from public.matches m
                 where (m.user_a = u.id and m.user_b = $2 or m.user_b = u.id and m.user_a = $2)
                   and m.unlocked_at is not null
              ) as photo_unlocked
         from public.users u
        where u.id = $1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw new AppError(404, 'PROFIL_INTROUVABLE', 'Profil introuvable.');

    const profile = rows[0];
    if (profile.photo_unlocked) {
      const { rows: p } = await query('select photo_url from public.users where id = $1', [req.params.id]);
      profile.photo_url = p[0]?.photo_url ?? null;
    }
    delete profile.photo_unlocked;

    res.json({ ok: true, profile });
  } catch (err) { next(err); }
});
