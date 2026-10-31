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
  recuperationRateLimitMax: Number(process.env.RECUPERATION_RATE_LIMIT_MAX || 10),
  // Déclarations de paiement (preuves Wave) : 6 par quart d'heure et par IP.
  paiementRateLimitMax: Number(process.env.PAIEMENT_RATE_LIMIT_MAX || 6),
  checkoutRateLimitMax: Number(process.env.CHECKOUT_RATE_LIMIT_MAX || 12),

  // --- Wave Business (Wave Checkout API, docs.wave.com) -------------------
  // Clé API : wave_sn_prod_… (tableau de bord Wave Business → Développeurs).
  // Vide = l'application garde le circuit manuel (numéro + référence).
  waveApiKey: process.env.WAVE_API_KEY || '',
  // Secret du webhook : wave_sn_WHS_… Sert à vérifier que l'appel vient de Wave.
  waveWebhookSecret: process.env.WAVE_WEBHOOK_SECRET || '',
  // Secret de signature de requête : wave_sn_AKS_… Uniquement si tu as coché
  // « request signing » en créant la clé API.
  waveSigningSecret: process.env.WAVE_SIGNING_SECRET || '',
  // adresse de l'API Wave (une valeur locale permet de tester sans réseau)
  waveApiUrl: process.env.WAVE_API_URL || 'https://api.wave.com',

  // Adresse du site, pour revenir dans l'application après le paiement.
  siteUrl: (process.env.SITE_URL || 'https://kaurel277-cmd.github.io/Viens-chop-').replace(/\/$/, '')
};
