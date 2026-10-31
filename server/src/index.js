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
import { photosRouter } from './routes/photos.js';
import { certificationRouter } from './routes/certification.js';
import { paiementRouter } from './routes/paiement.js';
import { adminRouter } from './routes/admin.js';
import { promoteursRouter, suggestionsRouter, visitesRouter, lieuxPublicRouter } from './routes/promoteurs.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
// Le reste de l'API reste à 100 Ko. Seule l'envoi de photo monte à 600 Ko
// (une image de 110 Ko pèse ~147 Ko une fois encodée en base64).
app.use('/api/photos', express.json({ limit: '600kb' }));
app.use('/api/certification', express.json({ limit: '600kb' }));
// La photo d'un lieu part aussi en base64 : 140 Ko décodés ≈ 190 Ko encodés.
app.use('/api/promoteurs', express.json({ limit: '600kb' }));
// Les médias de discussion montent à 3 Mo (vidéo). En base64 un fichier pèse
// ~4,1 Mo : on laisse 5 Mo de marge, sinon Express refuserait la vidéo avant
// même d'arriver à la route.
app.use('/api/matches', express.json({ limit: '5mb' }));
// Le webhook Wave est traité AVANT express.json() : sa signature porte sur le
// texte exact reçu. Il faut donc le garder tel quel (Buffer), et non un objet
// JSON re-sérialisé — sinon la vérification échouerait à chaque appel.
app.use('/api/paiement/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));

if (config.rateLimitEnabled) {
  // Plafond global : 300 requêtes / 15 min / IP
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  }));

  // Anti force brute sur la connexion par mot de passe : 20 essais / 15 min / IP
  app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: { code: 'TROP_D_ESSAIS', message: 'Trop d\'essais. Réessaie dans quelques minutes.' } }
  }));
  // Inscription : 10 comptes / heure / IP
  app.use('/api/auth/register', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.registerRateLimitMax,
    message: { error: { code: 'TROP_DE_COMPTES', message: 'Trop d\'inscriptions depuis ce réseau.' } }
  }));

  // Récupération de compte : 10 essais / 15 min / IP. Une clé de secours a
  // 10^17 combinaisons, mais on ne laisse pas non plus marteler la route.
  app.use('/api/auth/recuperation', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.recuperationRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TROP_D_ESSAIS', message: 'Trop d\'essais. Réessaie dans un quart d\'heure.' } }
  }));

  // Ouverture de paiement : 12 par quart d'heure, largement suffisant.
  app.use('/api/paiement/checkout', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.checkoutRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TROP_DE_DEMANDES', message: 'Trop de tentatives. Réessaie dans un quart d\'heure.' } }
  }));

  // Preuve de paiement : une personne n'a aucune raison d'en envoyer 20.
  app.use('/api/paiement/declarer', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.paiementRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TROP_DE_DEMANDES', message: 'Trop de demandes. Réessaie dans un quart d\'heure.' } }
  }));

}

app.use('/api/health', healthRouter);

app.use('/api/auth',    authRouter);
app.use('/api/users',   usersRouter);
app.use('/api/feed',    feedRouter);
app.use('/api/likes',   likesRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/safety',  safetyRouter);
app.use('/api/photos',  photosRouter);
app.use('/api/certification', certificationRouter);
app.use('/api/paiement',  paiementRouter);
app.use('/api/admin',   adminRouter);
app.use('/api/promoteurs', promoteursRouter);   // gérants de lieux (comptes séparés)
app.use('/api/visites',    visitesRouter);      // code du comptoir = une visite
app.use('/api/suggestions', suggestionsRouter); // un membre recommande un lieu
app.use('/api/lieux',      lieuxPublicRouter);   // la liste publique des Coins Chill

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
    console.log(`✅ Viens chop API sur http://0.0.0.0:${config.port}`);
  });
}
