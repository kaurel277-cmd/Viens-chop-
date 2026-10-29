import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';

export const matchesRouter = Router();

/* ---------------------------------------------------------------------------
   GET /api/matches — liste des matchs, avec dernier message et compteur
   --------------------------------------------------------------------------- */
matchesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select m.id,
              m.created_at,
              m.unlocked_at,
              (m.unlocked_at is not null) as photo_unlocked,
              case when m.user_a = $1 then m.user_b else m.user_a end as other_id,
              o.pseudo as other_pseudo,
              o.age    as other_age,
              o.commune as other_commune,
              o.is_certified as other_certified,
              -- Photo toujours visible : on doit voir la personne avant de liker
              case when o.main_photo_id is not null
                   then '/api/photos/' || o.main_photo_id::text end as other_photo_url,
              o.main_photo_id as other_photo_id,
              (select count(*) from public.messages msg where msg.match_id = m.id) as message_count,
              (select count(*) from public.messages msg
                where msg.match_id = m.id and msg.read_at is null and msg.sender_id <> $1) as unread,
              last.body as last_message,
              last.created_at as last_message_at
         from public.matches m
         join public.users o
           on o.id = case when m.user_a = $1 then m.user_b else m.user_a end
    left join lateral (
              select body, created_at from public.messages
               where match_id = m.id order by created_at desc limit 1
         ) last on true
        where $1 in (m.user_a, m.user_b)
          -- Une conversation avec une personne bloquée (dans un sens ou l'autre)
          -- disparaît des discussions, exactement comme elle disparaît du fil.
          and not exists (
                select 1 from public.blocks bl
                 where (bl.blocker_id = $1 and bl.blocked_id = o.id)
                    or (bl.blocker_id = o.id and bl.blocked_id = $1))
        order by coalesce(last.created_at, m.created_at) desc`,
      [req.user.id]
    );
    res.json({ ok: true, matches: rows });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/matches/:id/messages
   --------------------------------------------------------------------------- */
matchesRouter.get('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const match = await loadMatch(req.params.id, req.user.id);

    const { rows } = await query(
      `select id, sender_id, body, created_at, read_at
         from public.messages
        where match_id = $1
        order by created_at asc
        limit 200`,
      [match.id]
    );

    // Marque comme lus les messages reçus
    await query(
      `update public.messages set read_at = now()
        where match_id = $1 and sender_id <> $2 and read_at is null`,
      [match.id, req.user.id]
    );

    res.json({
      ok: true,
      match: {
        id: match.id,
        photo_unlocked: !!match.unlocked_at,
        messages_until_unlock: Math.max(0, 5 - rows.length)
      },
      messages: rows
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/matches/:id/messages
   Réponse bloquée si l'un des deux a bloqué l'autre.
   --------------------------------------------------------------------------- */
matchesRouter.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const match = await loadMatch(req.params.id, req.user.id);
    const body = String(req.body?.body || '').trim();

    if (!body) throw new AppError(400, 'MESSAGE_VIDE', 'Le message est vide.');
    if (body.length > 1000) throw new AppError(400, 'MESSAGE_TROP_LONG', '1000 caractères maximum.');

    const blocked = await query(
      `select 1 from public.blocks
        where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
      [req.user.id, match.other_id]
    );
    if (blocked.rowCount) throw new AppError(403, 'CONVERSATION_BLOQUEE', 'Cette conversation n\'est plus disponible.');

    const { rows } = await query(
      `insert into public.messages (match_id, sender_id, body)
       values ($1, $2, $3) returning id, sender_id, body, created_at`,
      [match.id, req.user.id, body]
    );

    const { rows: after } = await query(
      `select m.unlocked_at,
              (select count(*) from public.messages where match_id = m.id) as message_count
         from public.matches m where m.id = $1`,
      [match.id]
    );

    res.status(201).json({
      ok: true,
      message: rows[0],
      photo_unlocked: !!after[0].unlocked_at,
      messages_until_unlock: Math.max(0, 5 - Number(after[0].message_count))
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   Aide : charge un match en vérifiant que l'utilisateur y participe.
   --------------------------------------------------------------------------- */
async function loadMatch(matchId, userId) {
  const { rows } = await query(
    `select id, user_a, user_b, unlocked_at,
            case when user_a = $2 then user_b else user_a end as other_id
       from public.matches
      where id = $1 and $2 in (user_a, user_b)`,
    [matchId, userId]
  );
  if (!rows.length) throw new AppError(404, 'MATCH_INTROUVABLE', 'Match introuvable.');
  return rows[0];
}
