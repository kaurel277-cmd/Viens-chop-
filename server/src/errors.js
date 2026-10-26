export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Traduit les exceptions levées par les triggers PostgreSQL en réponses HTTP.
const PG_MAP = [
  [/QUOTA_LIKES_ATTEINT/,    (m) => new AppError(429, 'QUOTA_LIKES', m)],
  [/QUOTA_FAUX_APPEL/,       (m) => new AppError(429, 'QUOTA_FAUX_APPEL', m)],
  [/TROP_DE_DEMANDES/,       (m) => new AppError(429, 'TROP_DE_DEMANDES', m)],
  [/MINEUR_INTERDIT/,        (m) => new AppError(403, 'MINEUR_INTERDIT', m)],
  [/ACCES_REFUSE/,           (m) => new AppError(403, 'ACCES_REFUSE', m)]
];

export function handlePgError(err) {
  if (err instanceof AppError) return err;

  if (err.code === '23505') {
    // Violation d'unicité : le message PostgreSQL est verbeux, on le traduit.
    if (err.constraint === 'users_phone_key') {
      return new AppError(409, 'TELEPHONE_DEJA_UTILISE', 'Ce numéro a déjà un compte.');
    }
    if (err.constraint === 'one_like_per_pair') {
      return new AppError(409, 'DEJA_LIKE', 'Tu as déjà liké ce profil.');
    }
    if (err.constraint === 'one_match_per_pair') {
      return new AppError(409, 'DEJA_MATCHE', 'Vous êtes déjà en match.');
    }
    return new AppError(409, 'CONFLIT', 'Cet enregistrement existe déjà.');
  }

  if (err.code === '23514' || err.code === 'P0001') {
    for (const [pattern, make] of PG_MAP) {
      if (pattern.test(err.message)) return make(err.message);
    }
    return new AppError(400, 'REGLE_METIER', err.message);
  }

  if (err.code === '42501') {
    return new AppError(403, 'ACCES_REFUSE', 'Action non autorisée.');
  }

  console.error('[api] erreur non gérée :', err);
  return new AppError(500, 'ERREUR_SERVEUR', 'Une erreur est survenue.');
}
