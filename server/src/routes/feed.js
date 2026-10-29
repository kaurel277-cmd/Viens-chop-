import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

export const feedRouter = Router();

/* ---------------------------------------------------------------------------
   GET /api/feed — profils à découvrir
   Règles :
     - même commune d'abord, puis le reste du pays
     - jamais soi-même, jamais un profil déjà liké/passé, jamais un bloqué
     - la photo n'est jamais exposée ici (elle se débloque au 5e message)
   --------------------------------------------------------------------------- */
feedRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const me = req.user;

    const { rows } = await query(
      `select u.id, u.pseudo, u.age, u.commune, u.artists, u.bio, u.is_certified,
              u.last_seen_at, u.main_photo_id,
              (u.main_photo_id is not null) as has_photo,
              (u.commune = $2) as same_commune,
              (select count(*) from public.likes l2
                where l2.sender_id = u.id and l2.receiver_id = $1) > 0 as likes_me
         from public.users u
        where u.id <> $1
          and u.gender = any ($3::text[])                       -- règle de "je cherche"
          and u.is_adult = true
          and not exists (select 1 from public.likes l
                           where l.sender_id = $1 and l.receiver_id = u.id)
          and not exists (select 1 from public.blocks b
                           where (b.blocker_id = $1 and b.blocked_id = u.id)
                              or (b.blocker_id = u.id and b.blocked_id = $1))
        order by (u.commune = $2) desc, u.last_seen_at desc nulls last, random()
        limit $4`,
      [me.id, me.commune, seekingFilter(me), limit]
    );

    res.json({ ok: true, profiles: rows });
  } catch (err) { next(err); }
});

// 'A' = tout le monde ; 'F' = uniquement des femmes ; 'M' = uniquement des hommes
function seekingFilter(user) {
  switch (user.seeking) {
    case 'F': return ['F'];
    case 'M': return ['M'];
    default:  return ['F', 'M'];
  }
}
