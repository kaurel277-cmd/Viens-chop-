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
   La photo est visible par tous les inscrits : on doit voir la personne
   avant de la liker. (La règle « photo après 5 messages » a été retirée.)
   --------------------------------------------------------------------------- */
usersRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select u.id, u.pseudo, u.age, u.gender, u.commune, u.artists, u.bio,
              u.is_certified, u.last_seen_at,
              case when u.main_photo_id is not null
                   then '/api/photos/' || u.main_photo_id::text end as photo_url,
              (select count(*) from public.photos ph where ph.user_id = u.id)::int as photo_count
         from public.users u
        where u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw new AppError(404, 'PROFIL_INTROUVABLE', 'Profil introuvable.');

    res.json({ ok: true, profile: rows[0] });
  } catch (err) { next(err); }
});

