import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name} (voir server/.env.example)`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT || 3001),
  isProd,

  // Neon : deux chaînes possibles
  //  - DATABASE_URL        : pooler (recommandé, "-pooler" dans l'hôte)
  //  - DATABASE_URL_DIRECT : connexion directe, pour les migrations
  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtTtl: process.env.JWT_TTL || '15m',
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS || 30),

  // Autorise l'origine du site statique
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Console d'administration. Si ADMIN_TOKEN est vide, la console est
  // simplement fermée : aucun accès possible, aucune erreur au démarrage.
  adminToken: process.env.ADMIN_TOKEN || '',
  adminTtl: process.env.ADMIN_TTL || '8h',

  // Plafonds de requêtes (désactivés pendant les tests, ils ont leur propre test)
  rateLimitEnabled: process.env.NODE_ENV !== 'test',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  // Pendant la bêta, plusieurs comptes peuvent être créés depuis le même
  // réseau (cybercafé, partage de connexion). Réglable sur Render.
  registerRateLimitMax: Number(process.env.REGISTER_RATE_LIMIT_MAX || 40),
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 40),
  recuperationRateLimitMax: Number(process.env.RECUPERATION_RATE_LIMIT_MAX || 10)
};
