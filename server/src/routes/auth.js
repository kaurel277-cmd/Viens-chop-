import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import {
  signAccessToken, createSession,
  rotateSession, revokeSession, requireAuth
} from '../auth.js';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword, passwordProblem } from '../password.js';

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

    const accessToken = signAccessToken(user);
    const refreshToken = await createSession(user.id, req.headers['user-agent']);

    res.status(201).json({
      ok: true,
      is_new: true,
      access_token: accessToken,
      refresh_token: refreshToken,
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
      likes_left: req.isDebout ? null : Math.max(0, 3 - (u.likes_reset_at?.toISOString?.().slice(0, 10) === new Date().toISOString().slice(0, 10) ? u.likes_today : 0))
    }
  });
});
