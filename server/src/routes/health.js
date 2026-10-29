import { Router } from 'express';
import { query, pool } from '../db.js';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  // `features` permet au site de savoir ce que ce déploiement sait faire.
  // Sans ça, le navigateur essaie une route absente et reçoit une erreur.
  res.json({
    ok: true,
    service: 'viens-chop-api',
    features: ['password-auth', 'photos'],
    time: new Date().toISOString()
  });
});

/* ---------------------------------------------------------------------------
   GET /api/health/db — diagnostic de la base de données
   Ne révèle aucun secret : seulement des codes d'erreur classés.
   --------------------------------------------------------------------------- */
healthRouter.get('/db', async (_req, res) => {
  const report = {
    ok: false,
    etapes: {},
    conseils: []
  };

  // 0. La variable est-elle présente et de la bonne forme ?
  const url = config.databaseUrl || '';
  report.etapes.variable_presente = url.length > 0;
  report.etapes.chaine_pooled = url.includes('-pooler');
  report.etapes.ssl_demande = url.includes('sslmode=require');
  report.etapes.hote = (url.match(/@([^/:]+)/) || [])[1] || null;   // hôte seul, jamais le mot de passe

  // 1. Connexion
  try {
    const t0 = Date.now();
    await query('select 1');
    report.etapes.connexion = `OK (${Date.now() - t0} ms)`;
  } catch (err) {
    report.etapes.connexion = 'ÉCHEC';
    report.erreur = classify(err);

    if (report.erreur === 'MOT_DE_PASSE_REFUSE') {
      report.conseils.push(
        'Deux causes possibles : (1) la chaîne est tronquée au copier-coller — recopie-la en entier depuis Neon → Connect → Pooled connection ; ' +
        '(2) le projet Neon est en pause, supprimé, ou l\'identifiant du point d\'accès (ep-…) ne correspond plus. ' +
        'Vérifie que le projet apparaît bien comme « Active » sur console.neon.tech.'
      );
    } else if (report.erreur === 'HOTE_INTROUVABLE' || report.erreur === 'SERVEUR_INJOIGNABLE') {
      report.conseils.push('L\'adresse du serveur est fausse : recopie la chaîne « Pooled connection » depuis Neon → Connect.');
    } else if (report.erreur === 'DELAI_DEPASSE') {
      report.conseils.push('Le serveur ne répond pas : sur l\'offre gratuite Neon, une base endormie met quelques secondes à se réveiller. Recharge la page.');
    } else if (report.erreur === 'SSL_REQUIS') {
      report.conseils.push('La chaîne doit se terminer par ?sslmode=require.');
    } else if (report.erreur === 'BASE_INTROUVABLE') {
      report.conseils.push('La base indiquée n\'existe pas : sur Neon, elle s\'appelle neondb par défaut.');
    } else {
      report.conseils.push('Vérifie que DATABASE_URL correspond à la chaîne « Pooled connection » de Neon.');
    }
    return res.status(503).json(report);
  }

  // 2. Les tables existent-elles ?
  try {
    const { rows } = await query(`
      select
        to_regclass('public.users')      is not null as users,
        to_regclass('public.otp_codes')  is not null as otp_codes,
        to_regclass('public.likes')      is not null as likes,
        to_regclass('public.matches')    is not null as matches,
        to_regclass('public.messages')   is not null as messages,
        to_regclass('public.sessions')   is not null as sessions
    `);
    const t = rows[0];
    report.etapes.tables = t;

    if (!t.users || !t.otp_codes) {
      report.erreur = 'SCHEMA_ABSENT';
      report.conseils.push(
        'Les tables n\'existent pas : exécute database/neon-schema.sql dans Neon → SQL Editor, puis relance cette page.'
      );
      return res.status(503).json(report);
    }
  } catch (err) {
    report.etapes.tables = 'ÉCHEC';
    report.erreur = classify(err);
    return res.status(503).json(report);
  }

  // 3. Les triggers (les règles métier) sont-ils en place ?
  try {
    const { rows } = await query(
      `select count(*)::int as n from pg_trigger
        where not tgisinternal and tgname in
        ('users_age_adult','likes_quota','likes_create_match','messages_unlock',
         'messages_check_sender','users_fakecall_quota','payments_activate')`
    );
    report.etapes.triggers_regles = `${rows[0].n} / 7`;
    if (rows[0].n < 7) {
      report.erreur = 'SCHEMA_INCOMPLET';
      report.conseils.push('Le schéma n\'a été appliqué qu\'en partie : réexécute database/neon-schema.sql en entier.');
      return res.status(503).json(report);
    }
  } catch (err) {
    report.etapes.triggers_regles = 'ÉCHEC';
    report.erreur = classify(err);
    return res.status(503).json(report);
  }

  // 4. Les fonctions applicatives répondent-elles ?
  try {
    const { rows } = await query('select app.has_debout($1, $2) as d', ['coupe', null]);
    report.etapes.fonctions = rows[0].d === false ? 'OK' : 'RÉPONSE_INATTENDUE';
  } catch (err) {
    report.etapes.fonctions = 'ÉCHEC';
    report.erreur = 'FONCTIONS_ABSENTES';
    report.conseils.push('Le schéma `app` est absent : réexécute database/neon-schema.sql en entier.');
    return res.status(503).json(report);
  }

  // 5. Combien de comptes réels en base ?
  try {
    const { rows } = await query('select count(*)::int as n from public.users');
    report.etapes.comptes = rows[0].n;
  } catch { report.etapes.comptes = 'inconnu'; }

  report.ok = true;
  res.json(report);
});

/* Classe une erreur PostgreSQL sans jamais exposer la chaîne de connexion.
   On se fie d'abord aux codes officiels (err.code), plus fiables que le texte. */
function classify(err) {
  const code = String(err.code || '');
  const m = String(err.message || '').toLowerCase();

  // Codes SQLSTATE de PostgreSQL
  if (code === '28P01' || code === '28000') return 'MOT_DE_PASSE_REFUSE';
  if (code === '3D000') return 'BASE_INTROUVABLE';
  if (code === '42501') return 'DROITS_INSUFFISANTS';
  if (code === '57P03') return 'BASE_EN_DEMARRAGE';
  if (code === 'ETIMEDOUT') return 'DELAI_DEPASSE';

  // Codes réseau de Node
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'HOTE_INTROUVABLE';
  if (code === 'ECONNREFUSED') return 'SERVEUR_INJOIGNABLE';
  if (code === 'ECONNRESET') return 'CONNEXION_COUPEE';

  // Repli sur le texte
  if (m.includes('password authentication') || m.includes('authentication failed')) return 'MOT_DE_PASSE_REFUSE';
  if (m.includes('enotfound') || m.includes('getaddrinfo')) return 'HOTE_INTROUVABLE';
  if (m.includes('econnrefused')) return 'SERVEUR_INJOIGNABLE';
  if (m.includes('timeout') || m.includes('timed out')) return 'DELAI_DEPASSE';
  if (m.includes('does not exist') && m.includes('database')) return 'BASE_INTROUVABLE';
  if (m.includes('permission denied')) return 'DROITS_INSUFFISANTS';
  if (m.includes('ssl')) return 'SSL_REQUIS';
  return 'ERREUR_INCONNUE';
}

export function dbPoolTotal() {
  return pool.totalCount;
}
