import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import {
  signAccessToken, createSession,
  rotateSession, revokeSession, requireAuth
} from '../auth.js';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword, passwordProblem } from '../password.js';
import { aRecuperation } from '../capabilities.js';
import { genererCleSecours, normaliserCleSecours, cleSecoursBienFormee } from '../recuperation.js';

export const authRouter = Router();

/* ---------------------------------------------------------------------------
   Normalisation du numéro : on ne stocke que du E.164 (+2250701020304).
   --------------------------------------------------------------------------- */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return /^\+\d{8,15}$/.test(digits) ? digits : null;

  const local = digits.replace(/^225/, '');
  if (!/^\d{8,10}$/.test(local)) return null;
  return `+225${local}`;
}

/* ---------------------------------------------------------------------------
   POST /api/auth/register — inscription par mot de passe (sans SMS)

   Le mot de passe est haché avec scrypt. L'âge est recalculé par la base :
   le client ne peut pas mentir sur sa date de naissance.
   --------------------------------------------------------------------------- */
authRouter.post('/register', async (req, res, next) => {
  try {
    const { phone: rawPhone, password, birth_date: birthDate } = req.body || {};
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide.');

    const pb = passwordProblem(password);
    if (pb) throw new AppError(400, pb, 'Le mot de passe doit contenir au moins 6 caractères.');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) {
      throw new AppError(400, 'DATE_INVALIDE', 'Date de naissance invalide.');
    }

    const existing = await query('select id, password_hash from public.users where phone = $1', [phone]);
    if (existing.rows.length) {
      throw new AppError(409, 'TELEPHONE_DEJA_UTILISE', 'Ce numéro a déjà un compte. Connecte-toi.');
    }

    let inserted;
    try {
      inserted = await query(
        `insert into public.users (phone, pseudo, birth_date, commune, is_phone_verified, last_seen_at)
         values ($1, $2, $3, $4, true, now())
         returning id, pseudo, plan, plan_expires_at, age, is_adult`,
        [phone, 'membre' + Math.floor(Math.random() * 9000 + 1000), birthDate, 'Abidjan']
      );
    } catch (err) {
      // Le trigger de la base refuse les mineurs (check_violation)
      if (err.code === '23514' || /MINEUR_INTERDIT/.test(err.message || '')) {
        throw new AppError(403, 'MINEUR_INTERDIT', 'Inscription réservée aux 18 ans et plus.');
      }
      throw err;
    }

    const user = inserted.rows[0];
    await query('update public.users set password_hash = $2 where id = $1', [user.id, hashPassword(password)]);

    // Clé de secours : le seul moyen de récupérer un compte sans SMS ni email.
    // Elle est montrée une seule fois, ici, et hachée tout de suite après.
    let cleSecours = null;
    if (await aRecuperation()) {
      cleSecours = genererCleSecours();
      await query(
        `update public.users
            set recovery_hash = $2, recovery_created_at = now(), recovery_used_at = null
          where id = $1`,
        [user.id, hashPassword(normaliserCleSecours(cleSecours))]
      );
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await createSession(user.id, req.headers['user-agent']);

    res.status(201).json({
      ok: true,
      is_new: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      cle_secours: cleSecours,
      user: { id: user.id, pseudo: user.pseudo, plan: user.plan, age: user.age }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/login — numéro + mot de passe
   --------------------------------------------------------------------------- */
authRouter.post('/login', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const password = req.body?.password;
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide.');

    const { rows } = await query(
      `select id, pseudo, plan, plan_expires_at, password_hash
         from public.users where phone = $1`,
      [phone]
    );

    // Message identique dans les deux cas : on n'indique pas si le numéro existe.
    const refus = new AppError(401, 'IDENTIFIANTS_INCORRECTS', 'Numéro ou mot de passe incorrect.');
    if (!rows.length) throw refus;
    if (!verifyPassword(password, rows[0].password_hash)) throw refus;

    const user = rows[0];
    await query('update public.users set last_seen_at = now() where id = $1', [user.id]);

    const accessToken = signAccessToken(user);
    const refreshToken = await createSession(user.id, req.headers['user-agent']);

    res.json({
      ok: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, pseudo: user.pseudo, plan: user.plan }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/refresh
   --------------------------------------------------------------------------- */
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) throw new AppError(400, 'REFRESH_MANQUANT', 'Jeton de rafraîchissement manquant.');

    const { userId, refreshToken } = await rotateSession(refresh_token, req.headers['user-agent']);
    const { rows } = await query('select id, pseudo, plan from public.users where id = $1', [userId]);
    if (!rows.length) throw new AppError(401, 'COMPTE_INTROUVABLE', 'Compte introuvable.');

    res.json({
      ok: true,
      access_token: signAccessToken(rows[0]),
      refresh_token: refreshToken
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/logout
   --------------------------------------------------------------------------- */
authRouter.post('/logout', async (req, res, next) => {
  try {
    if (req.body?.refresh_token) await revokeSession(req.body.refresh_token);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/recuperation — « j'ai oublié mon mot de passe »

   Trois choses obligatoires : le numéro, la clé de secours, un nouveau mot de
   passe. Aucun SMS, aucun email : la clé EST la preuve d'identité.

   Réponse identique que le numéro existe ou non (« numéro ou clé
   incorrecte ») : on n'indique jamais si un compte existe.
   --------------------------------------------------------------------------- */
authRouter.post('/recuperation', async (req, res, next) => {
  try {
    if (!(await aRecuperation())) {
      throw new AppError(503, 'RECUPERATION_INDISPONIBLE',
        'La récupération de compte est en cours d\'activation. Réessaie plus tard.');
    }

    const phone = normalizePhone(req.body?.phone);
    const cle = req.body?.cle_secours ?? req.body?.cle;
    const nouveau = req.body?.password ?? req.body?.nouveau_mot_de_passe;

    const refus = new AppError(401, 'CLE_INVALIDE', 'Numéro ou clé de secours incorrecte.');
    if (!phone) throw refus;

    const pb = passwordProblem(nouveau);
    if (pb) throw new AppError(400, pb, 'Le nouveau mot de passe doit contenir au moins 6 caractères.');

    // Forme invalide : inutile d'interroger la base, mais même réponse.
    if (!cleSecoursBienFormee(cle)) throw refus;

    const cleHachee = normaliserCleSecours(cle);
    const { rows } = await query(
      `select id, pseudo, plan, plan_expires_at, recovery_hash, recovery_used_at
         from public.users where phone = $1`,
      [phone]
    );
    if (!rows.length) throw refus;

    const u = rows[0];

    // Une clé ne sert qu'une fois. On répond un message clair à la personne
    // qui retente avec sa vieille clé (ce n'est pas une attaque, c'est une
    // étourderie) — mais seulement après le bon numéro.
    if (u.recovery_used_at) {
      throw new AppError(401, 'CLE_DEJA_UTILISEE',
        'Cette clé de secours a déjà servi. Celle de ton profil est la plus récente.');
    }
    if (!u.recovery_hash) throw refus;
    if (!verifyPassword(cleHachee, u.recovery_hash)) throw refus;

    await query(
      `update public.users
          set password_hash = $2,
              recovery_hash = null,
              recovery_used_at = now()
        where id = $1`,
      [u.id, hashPassword(nouveau)]
    );

    // Toutes les autres sessions tombent : si quelqu'un d'autre était connecté,
    // il est éjecté.
    await query(
      'update public.sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
      [u.id]
    );

    const accessToken = signAccessToken(u);
    const refreshToken = await createSession(u.id, req.headers['user-agent']);

    res.json({
      ok: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      message: 'Mot de passe changé. Pense à générer une nouvelle clé de secours depuis ton profil.',
      user: { id: u.id, pseudo: u.pseudo, plan: u.plan }
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/cle-secours — générer (ou remplacer) sa clé de secours

   Connecté, et avec le mot de passe : quelqu'un qui tombe sur un téléphone
   déverrouillé ne peut pas se fabriquer une clé sans le connaître.
   --------------------------------------------------------------------------- */
authRouter.post('/cle-secours', requireAuth, async (req, res, next) => {
  try {
    if (!(await aRecuperation())) {
      throw new AppError(503, 'RECUPERATION_INDISPONIBLE',
        'La clé de secours sera disponible dès que la base sera mise à jour.');
    }

    const { rows } = await query('select password_hash from public.users where id = $1', [req.user.id]);
    if (!rows.length || !verifyPassword(req.body?.password, rows[0].password_hash)) {
      throw new AppError(401, 'MOT_DE_PASSE_INCORRECT', 'Mot de passe incorrect.');
    }

    const cle = genererCleSecours();
    await query(
      `update public.users
          set recovery_hash = $2, recovery_created_at = now(), recovery_used_at = null
        where id = $1`,
      [req.user.id, hashPassword(normaliserCleSecours(cle))]
    );

    // La clé en clair ne repart qu'ici, une seule fois : elle n'est jamais
    // renvoyée par une autre route.
    res.json({ ok: true, cle_secours: cle });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/changer-mot-de-passe — connecté, avec l'ancien mot de passe
   --------------------------------------------------------------------------- */
authRouter.post('/changer-mot-de-passe', requireAuth, async (req, res, next) => {
  try {
    const ancien = req.body?.ancien_mot_de_passe ?? req.body?.old_password;
    const nouveau = req.body?.password ?? req.body?.nouveau_mot_de_passe;

    const pb = passwordProblem(nouveau);
    if (pb) throw new AppError(400, pb, 'Le nouveau mot de passe doit contenir au moins 6 caractères.');

    const { rows } = await query('select password_hash from public.users where id = $1', [req.user.id]);
    if (!rows.length || !verifyPassword(ancien, rows[0].password_hash)) {
      throw new AppError(401, 'MOT_DE_PASSE_INCORRECT', 'Ancien mot de passe incorrect.');
    }
    if (String(ancien) === String(nouveau)) {
      throw new AppError(400, 'MEME_MOT_DE_PASSE', 'Choisis un mot de passe différent de l\'ancien.');
    }

    await query('update public.users set password_hash = $2 where id = $1',
      [req.user.id, hashPassword(nouveau)]);

    // On déconnecte les autres appareils, et on rend une session propre à
    // celui qui vient de faire la modification.
    await query(
      'update public.sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
      [req.user.id]
    );
    const accessToken = signAccessToken(req.user);
    const refreshToken = await createSession(req.user.id, req.headers['user-agent']);

    res.json({
      ok: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      message: 'Mot de passe changé. Les autres appareils ont été déconnectés.'
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   GET /api/auth/me
   --------------------------------------------------------------------------- */
authRouter.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  res.json({
    ok: true,
    user: {
      id: u.id,
      pseudo: u.pseudo,
      age: u.age,
      gender: u.gender,
      seeking: u.seeking,
      commune: u.commune,
      artists: u.artists,
      bio: u.bio,
      photo_url: u.photo_url,
      is_certified: u.is_certified,
      plan: req.isDebout ? 'debout' : 'coupe',
      plan_expires_at: u.plan_expires_at,
      a_cle_secours: !!u.a_cle_secours,
      cle_utilisee_le: u.recovery_used_at || null,
      likes_left: req.isDebout ? null : Math.max(0, 3 - (u.likes_reset_at?.toISOString?.().slice(0, 10) === new Date().toISOString().slice(0, 10) ? u.likes_today : 0))
    }
  });
});
