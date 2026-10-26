import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { AppError } from './errors.js';

/* ---------------------------------------------------------------------------
   Codes OTP et jetons — tout est haché avant d'atteindre la base.
   --------------------------------------------------------------------------- */

export function generateOtp() {
  // crypto.randomInt est cryptographiquement sûr (pas Math.random)
  const max = 10 ** config.otpLength;
  return String(crypto.randomInt(0, max)).padStart(config.otpLength, '0');
}

export function hashOtp(code) {
  return crypto.createHmac('sha256', config.otpPepper).update(code).digest('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, plan: user.plan },
    config.jwtSecret,
    { expiresIn: config.jwtTtl }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    throw new AppError(401, 'TOKEN_INVALIDE', 'Session expirée, reconnecte-toi.');
  }
}

/* ---------------------------------------------------------------------------
   Middleware : exige un Bearer token valide et charge l'utilisateur.
   --------------------------------------------------------------------------- */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'NON_AUTHENTIFIE', 'Authentification requise.');

    const payload = verifyAccessToken(token);
    const { rows } = await query(
      `select id, phone, pseudo, gender, seeking, age, birth_date, commune, artists,
              bio, photo_url, selfie_url, is_certified, plan, plan_expires_at,
              fake_call_last_used, likes_today, likes_reset_at, last_seen_at
         from public.users where id = $1`,
      [payload.sub]
    );
    if (!rows.length) throw new AppError(401, 'COMPTE_INTROUVABLE', 'Compte introuvable.');

    req.user = rows[0];
    req.isDebout = rows[0].plan === 'debout'
      && (!rows[0].plan_expires_at || new Date(rows[0].plan_expires_at) > new Date());
    next();
  } catch (err) {
    next(err);
  }
}

/* ---------------------------------------------------------------------------
   Refresh tokens : stockés hachés, révocables.
   --------------------------------------------------------------------------- */
export async function createSession(userId, userAgent) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.refreshTtlDays * 864e5);

  await query(
    `insert into public.sessions (user_id, token_hash, user_agent, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, hashToken(raw), userAgent?.slice(0, 300) || null, expires]
  );

  return raw;
}

export async function rotateSession(rawToken, userAgent) {
  const hash = hashToken(rawToken);
  const { rows } = await query(
    `update public.sessions
        set revoked_at = now()
      where token_hash = $1 and revoked_at is null and expires_at > now()
      returning user_id`,
    [hash]
  );
  if (!rows.length) throw new AppError(401, 'SESSION_INVALIDE', 'Session expirée, reconnecte-toi.');

  const userId = rows[0].user_id;
  const newToken = await createSession(userId, userAgent);
  return { userId, refreshToken: newToken };
}

export async function revokeSession(rawToken) {
  await query(
    `update public.sessions set revoked_at = now()
      where token_hash = $1 and revoked_at is null`,
    [hashToken(rawToken)]
  );
}
