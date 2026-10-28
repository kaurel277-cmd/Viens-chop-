import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { handlePgError, AppError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { feedRouter } from './routes/feed.js';
import { likesRouter } from './routes/likes.js';
import { matchesRouter } from './routes/matches.js';
import { safetyRouter } from './routes/safety.js';
import { healthRouter } from './routes/health.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));

if (config.rateLimitEnabled) {
  // Plafond global : 300 requêtes / 15 min / IP
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }));

  // Plafond resserré sur l'envoi de SMS (coût réel par message)
  app.use('/api/auth/otp', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.otpRateLimitMax,
    message: { error: { code: 'TROP_DE_DEMANDES', message: 'Trop de demandes de code. Réessaie plus tard.' } }
  }));
}

// /api/health = le processus répond. /api/health/db = la base répond vraiment.
app.use('/api/health', healthRouter);

app.use('/api/auth',    authRouter);
app.use('/api/users',   usersRouter);
app.use('/api/feed',    feedRouter);
app.use('/api/likes',   likesRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/safety',  safetyRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_INCONNUE', message: 'Route inconnue.' } });
});

// Gestion d'erreurs centralisée
app.use((err, _req, res, _next) => {
  const e = handlePgError(err);
  if (!(err instanceof AppError) && e.status === 500) {
    return res.status(500).json({ error: { code: 'ERREUR_SERVEUR', message: 'Une erreur est survenue.' } });
  }
  res.status(e.status).json({
    error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }
  });
});

// Démarrage (sauté pendant les tests)
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`✅ Viens chop API sur http://0.0.0.0:${config.port} (SMS: ${config.smsProvider})`);
  });
}
