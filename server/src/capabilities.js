/* ---------------------------------------------------------------------------
   Ce que la base sait faire.

   Pourquoi : le code est déployé avant que le SQL de migration soit exécuté
   dans Neon. Tant que la migration n'est pas passée, l'API ne doit pas
   planter : elle répond simplement « pas encore disponible » sur les routes
   concernées, et le reste du site continue de fonctionner.

   Détail important : une réponse « pas encore » n'est gardée que 30 secondes.
   Comme ça, la personne peut coller le SQL dans Neon et voir la fonctionnalité
   s'activer toute seule, sans redéployer quoi que ce soit.
   --------------------------------------------------------------------------- */
import { query } from './db.js';

const TTL_MS = 30 * 1000;

const cache = {
  verifications: null, verificationsAt: 0,
  moderation: null, moderationAt: 0,
  adminActions: null, adminActionsAt: 0,
  chatMedia: null, chatMediaAt: 0,
  recuperation: null, recuperationAt: 0
};

function encoreValable(valeur, at) {
  if (valeur === true) return true;                 // c'est en place, on garde
  return valeur !== null && Date.now() - at < TTL_MS;
}

async function tableExiste(nom) {
  try {
    const { rows } = await query('select to_regclass($1) is not null as ok', ['public.' + nom]);
    return !!rows[0].ok;
  } catch {
    return false;
  }
}

async function capacite(cle, detecter) {
  if (encoreValable(cache[cle], cache[cle + 'At'])) return cache[cle];
  const valeur = await detecter();
  cache[cle] = valeur;
  cache[cle + 'At'] = Date.now();
  return valeur;
}

export async function aVerifications() {
  return capacite('verifications', () => tableExiste('verifications'));
}

export async function aAdminActions() {
  return capacite('adminActions', () => tableExiste('admin_actions'));
}

export async function aModeration() {
  return capacite('moderation', async () => {
    try {
      const { rows } = await query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'photos'
            and column_name = 'moderation_status' limit 1`
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  });
}

export async function aChatMedia() {
  return capacite('chatMedia', () => tableExiste('chat_media'));
}

/* Colonne qui porte la clé de secours : sans elle, pas de « mot de passe
   oublié ». On regarde la colonne, pas une table, pour rester au plus près
   du SQL fourni. */
export async function aRecuperation() {
  return capacite('recuperation', async () => {
    try {
      const { rows } = await query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'users'
            and column_name = 'recovery_hash' limit 1`
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  });
}

/** Réinitialise le cache (utilisé par les tests). */
export function oublierCapacites() {
  Object.keys(cache).forEach(k => {
    if (!k.endsWith('At')) cache[k] = null;
  });
  Object.keys(cache).forEach(k => {
    if (k.endsWith('At')) cache[k] = 0;
  });
}
