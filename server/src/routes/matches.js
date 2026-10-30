import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { AppError } from '../errors.js';
import { aChatMedia } from '../capabilities.js';

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
/* ---------------------------------------------------------------------------
   MÉDIAS EN VUE UNIQUE (photos et vidéos échangées dans une discussion)

   Règle du produit : ce qui est envoyé ne peut être regardé qu'une fois.
   Côté serveur, ça veut dire :
     - le fichier est stocké dans Neon, pas sur l'appareil ;
     - seul l'autre participant peut l'ouvrir ;
     - dès la première ouverture, le contenu est effacé et la ligne est
       marquée « vue » : impossible de le rouvrir, même en rejouant la requête.
   --------------------------------------------------------------------------- */
const MEDIA_MAX = { photo: 400 * 1024, video: 3 * 1024 * 1024 };

function decodeMedia(data) {
  const clean = String(data || '').replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new AppError(400, 'MEDIA_INVALIDE', 'Fichier illisible.');
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) throw new AppError(400, 'MEDIA_VIDE', 'Fichier vide.');
  return buf;
}

matchesRouter.post('/:id/media', requireAuth, async (req, res, next) => {
  try {
    if (!(await aChatMedia())) {
      throw new AppError(503, 'CHAT_MEDIA_INDISPONIBLE',
        "L'envoi de photos et de vidéos s'active dès que la base est mise à jour.");
    }
    const match = await loadMatch(req.params.id, req.user.id);

    const bloque = await query(
      `select 1 from public.blocks
        where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
      [req.user.id, match.other_id]
    );
    if (bloque.rowCount) throw new AppError(403, 'CONVERSATION_BLOQUEE', "Cette conversation n'est plus disponible.");

    const { data, mime, kind } = req.body || {};
    if (!['photo', 'video'].includes(kind)) {
      throw new AppError(400, 'TYPE_INVALIDE', 'Type attendu : photo ou video.');
    }
    const buf = decodeMedia(data);
    if (buf.length > MEDIA_MAX[kind]) {
      throw new AppError(413, 'MEDIA_TROP_LOURD',
        kind === 'video' ? 'Vidéo trop lourde (3 Mo maximum).' : 'Photo trop lourde (400 Ko maximum).');
    }

    const { rows } = await query(
      `insert into public.chat_media (match_id, sender_id, kind, mime, bytes, data)
       values ($1, $2, $3, $4, $5, $6)
       returning id, kind, mime, bytes, created_at`,
      [match.id, req.user.id, kind, String(mime || 'image/jpeg').slice(0, 40), buf.length, buf]
    );

    res.status(201).json({ ok: true, media: rows[0] });
  } catch (err) { next(err); }
});

/* Liste des médias de la discussion (sans le contenu) */
matchesRouter.get('/:id/media', requireAuth, async (req, res, next) => {
  try {
    if (!(await aChatMedia())) return res.json({ ok: true, disponible: false, media: [] });
    const match = await loadMatch(req.params.id, req.user.id);

    const { rows } = await query(
      `select id, sender_id, kind, mime, bytes, created_at,
              (viewed_at is not null) as vue,
              (data is not null) as encore_disponible
         from public.chat_media
        where match_id = $1
        order by created_at asc
        limit 100`,
      [match.id]
    );
    res.json({ ok: true, disponible: true, media: rows, moi: req.user.id });
  } catch (err) { next(err); }
});

/* Ouverture : une seule fois, pour l'autre personne, puis le contenu disparaît */
matchesRouter.post('/:id/media/:mediaId/ouvrir', requireAuth, async (req, res, next) => {
  try {
    if (!(await aChatMedia())) throw new AppError(503, 'CHAT_MEDIA_INDISPONIBLE', "Indisponible pour le moment.");
    const match = await loadMatch(req.params.id, req.user.id);

    const { rows } = await query(
      `select id, sender_id, kind, mime, data, viewed_at
         from public.chat_media
        where id = $1 and match_id = $2`,
      [req.params.mediaId, match.id]
    );
    if (!rows.length) throw new AppError(404, 'MEDIA_INTROUVABLE', 'Média introuvable.');

    const m = rows[0];
    if (m.sender_id === req.user.id) {
      throw new AppError(403, 'MEDIA_DE_SOI', "C'est toi qui l'as envoyé.");
    }
    if (m.viewed_at || !m.data) {
      throw new AppError(410, 'MEDIA_DEJA_VU', 'Ce média a déjà été regardé.');
    }

    // On efface le contenu AVANT de répondre : même une deuxième requête
    // simultanée ne pourra plus le récupérer.
    await query(
      `update public.chat_media set viewed_at = now(), data = null where id = $1 and viewed_at is null`,
      [m.id]
    );

    res.json({ ok: true, kind: m.kind, mime: m.mime, data: m.data.toString('base64') });
  } catch (err) { next(err); }
});

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
