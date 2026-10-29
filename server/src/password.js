import crypto from 'node:crypto';

/* ---------------------------------------------------------------------------
   Mots de passe — scrypt, sel aléatoire par compte.
   Format stocké : scrypt:N:salt_hex:hash_hex
   Le mot de passe lui-même n'est jamais écrit, ni en base, ni dans les logs.
   --------------------------------------------------------------------------- */

const N = 16384;          // coût (2^14) : ~40 ms sur un petit serveur
const KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: 8, p: 1 });
  return `scrypt:${N}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  if (!Number.isFinite(n) || n < 1024) return false;

  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, { N: n, r: 8, p: 1 });
  } catch {
    return false;
  }
  // Comparaison à temps constant
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function passwordProblem(password) {
  const p = String(password ?? '');
  if (p.length < 6) return 'MOT_DE_PASSE_COURT';
  if (p.length > 200) return 'MOT_DE_PASSE_TROP_LONG';
  return null;
}
