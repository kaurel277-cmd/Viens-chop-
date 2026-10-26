import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import {
  generateOtp, hashOtp, signAccessToken, createSession,
  rotateSession, revokeSession, requireAuth
} from '../auth.js';
import { AppError } from '../errors.js';
import { sendSms } from '../sms.js';

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
   POST /api/auth/otp — envoie un code
   --------------------------------------------------------------------------- */
authRouter.post('/otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide.');

    // Antibruteforce porté par la base : 5 codes max par heure
    await query('select app.check_otp_rate_limit($1)', [phone]);

    const code = config.devOtpBypass ? '123456'.slice(0, config.otpLength) : generateOtp();
    const expires = new Date(Date.now() + config.otpTtlMinutes * 60_000);

    // Un seul code actif à la fois : les précédents sont invalidés
    await query(
      `update public.otp_codes set consumed_at = now()
        where phone = $1 and consumed_at is null`,
      [phone]
    );
    await query(
      `insert into public.otp_codes (phone, code_hash, expires_at) values ($1, $2, $3)`,
      [phone, hashOtp(code), expires]
    );

    await sendSms(phone, `Viens chop : ton code est ${code}. Il expire dans ${config.otpTtlMinutes} min.`);

    res.json({
      ok: true,
      expires_in: config.otpTtlMinutes * 60,
      // jamais renvoyé en production
      ...(config.devOtpBypass ? { dev_code: code } : {})
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------------------
   POST /api/auth/verify — vérifie le code, crée la session
   Retourne : access_token, refresh_token, et l'état du compte
   (is_new = true si l'inscription n'est pas terminée)
   --------------------------------------------------------------------------- */
authRouter.post('/verify', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!phone) throw new AppError(400, 'TELEPHONE_INVALIDE', 'Numéro de téléphone invalide.');
    if (!new RegExp(`^\\d{${config.otpLength}}$`).test(code)) {
      throw new AppError(400, 'CODE_INVALIDE', `Le code doit contenir ${config.otpLength} chiffres.`);
    }

    const { rows } = await query(
      `select id, code_hash, attempts, expires_at
         from public.otp_codes
        where phone = $1 and consumed_at is null
        order by created_at desc limit 1`,
      [phone]
    );
    if (!rows.length) throw new AppError(400, 'AUCUN_CODE', 'Aucun code en cours. Demande-en un nouveau.');

    const otp = rows[0];
    if (new Date(otp.expires_at) < new Date()) {
      throw new AppError(400, 'CODE_EXPIRE', 'Ce code a expiré. Demande-en un nouveau.');
    }
    if (otp.attempts >= 5) {
      throw new AppError(429, 'TROP_D_ESSAIS', 'Trop de tentatives. Demande un nouveau code.');
    }
    if (hashOtp(code) !== otp.code_hash) {
      await query('update public.otp_codes set attempts = attempts + 1 where id = $1', [otp.id]);
      throw new AppError(400, 'CODE_INCORRECT', 'Code incorrect.');
    }

    await query('update public.otp_codes set consumed_at = now() where id = $1', [otp.id]);

    const userRes = await query(
      `select id, pseudo, plan, plan_expires_at from public.users where phone = $1`,
      [phone]
    );

    let user = userRes.rows[0];
    const isNew = !user;

    if (!user) {
      // Compte créé immédiatement : la confirmation est automatique,
      // aucune validation par lien. Le profil est complété à l'étape suivante.
      const created = await query(
        `insert into public.users (phone, pseudo, birth_date, commune, is_phone_verified)
         values ($1, $2, $3, $4, true)
         returning id, pseudo, plan, plan_expires_at`,
        [phone, 'membre' + Math.floor(Math.random() * 9000 + 1000), '2000-01-01', 'Abidjan']
      );
      user = created.rows[0];
      // Le pseudo/birth_date provisoires sont remplacés par POST /api/users/me
    } else {
      await query('update public.users set is_phone_verified = true, last_seen_at = now() where id = $1', [user.id]);
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await createSession(user.id, req.headers['user-agent']);

    res.json({
      ok: true,
      is_new: isNew,
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
