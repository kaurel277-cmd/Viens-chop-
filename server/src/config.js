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

  // Pepper appliqué aux codes OTP avant hachage (ne jamais changer en prod)
  otpPepper: required('OTP_PEPPER'),
  otpLength: Number(process.env.OTP_LENGTH || 6),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),

  // Fournisseur SMS : 'console' (dev), 'twilio', 'termii', 'orange'
  smsProvider: process.env.SMS_PROVIDER || 'console',
  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM
  },
  termii: {
    key: process.env.TERMII_API_KEY,
    from: process.env.TERMII_SENDER || 'ViensChop'
  },

  // Autorise l'origine du site statique
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // En développement uniquement : accepte le code 123456 et le renvoie dans la réponse
  devOtpBypass: !isProd && process.env.DEV_OTP_BYPASS === 'true',

  // Code OTP fixe pour la bêta : permet de tester sans fournisseur SMS.
  // ⚠️ À retirer avant l'ouverture publique (sinon n'importe qui entre).
  betaOtp: process.env.BETA_OTP || null,

  // Plafonds de requêtes (désactivés pendant les tests, ils ont leur propre test)
  rateLimitEnabled: process.env.NODE_ENV !== 'test',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  otpRateLimitMax: Number(process.env.OTP_RATE_LIMIT_MAX || 10),
  // Pendant la bêta, plusieurs comptes peuvent être créés depuis le même
  // réseau (cybercafé, partage de connexion). Réglable sur Render.
  registerRateLimitMax: Number(process.env.REGISTER_RATE_LIMIT_MAX || 40),
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX || 40)
};
