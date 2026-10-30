import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { AppError } from './errors.js';

/* ---------------------------------------------------------------------------
   Jetons et sessions — tout est haché avant d'atteindre la base.
   --------------------------------------------------------------------------- */

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
    // Les colonnes de la clé de secours sont lues via to_jsonb : si la
    // migration n'a pas encore été passée, elles valent simplement null au
    // lieu de faire échouer TOUTES les routes authentifiées (fil, profil,
    // matchs…). Une base en retard ne doit jamais bloquer l'application.
    const { rows } = await query(
      `select u.id, u.phone, u.pseudo, u.gender, u.seeking, u.age, u.birth_date,
              u.commune, u.artists, u.bio, u.photo_url, u.selfie_url, u.is_certified,
              u.plan, u.plan_expires_at, u.fake_call_last_used, u.likes_today,
              u.likes_reset_at, u.last_seen_at,
              (to_jsonb(u)->>'recovery_hash') is not null as a_cle_secours,
              nullif(to_jsonb(u)->>'recovery_used_at', '') as recovery_used_at
         from public.users u where u.id = $1`,
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
   Console d'administration — jeton unique, pas de compte utilisateur.

   Le propriétaire du site définit ADMIN_TOKEN sur Render. Il l'entre une fois
   dans admin.html, qui reçoit en échange un jeton de 8 h. Rien n'est stocké
   en base : si ADMIN_TOKEN change, tous les accès tombent.
   --------------------------------------------------------------------------- */
export function jetonAdminValide(candidat) {
  const attendu = config.adminToken;
  if (!attendu || !candidat) return false;
  const a = Buffer.from(String(candidat));
  const b = Buffer.from(String(attendu));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function creerJetonAdmin() {
  return jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: config.adminTtl });
}

export async function requireAdmin(req, _res, next) {
  try {
    if (!config.adminToken) {
      throw new AppError(503, 'ADMIN_FERMEE', "La console d'administration n'est pas configurée (ADMIN_TOKEN).");
    }
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'NON_AUTHENTIFIE', 'Jeton administrateur requis.');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new AppError(401, 'JETON_INVALIDE', 'Session administrateur expirée, reconnecte-toi.');
    }
    if (!payload || payload.role !== 'admin') {
      throw new AppError(403, 'ACCES_REFUSE', "Accès réservé à l'administration.");
    }
    req.isAdmin = true;
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
