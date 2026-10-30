/* ---------------------------------------------------------------------------
   Ce que la base sait faire, détecté une seule fois au démarrage.

   Pourquoi : le code est déployé avant que le SQL de migration soit exécuté
   dans Neon. Tant que la migration n'est pas passée, l'API ne doit pas
   planter : elle répond simplement « pas encore disponible » sur les routes
   concernées, et le reste du site continue de fonctionner.
   --------------------------------------------------------------------------- */
import { query } from './db.js';

const cache = { verifications: null, moderation: null, adminActions: null, chatMedia: null };

async function tableExiste(nom) {
  try {
    const { rows } = await query('select to_regclass($1) is not null as ok', ['public.' + nom]);
    return !!rows[0].ok;
  } catch {
    return false;
  }
}

export async function aVerifications() {
  if (cache.verifications === null) cache.verifications = await tableExiste('verifications');
  return cache.verifications;
}

export async function aAdminActions() {
  if (cache.adminActions === null) cache.adminActions = await tableExiste('admin_actions');
  return cache.adminActions;
}

export async function aModeration() {
  if (cache.moderation === null) {
    try {
      const { rows } = await query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'photos'
            and column_name = 'moderation_status' limit 1`
      );
      cache.moderation = rows.length > 0;
    } catch {
      cache.moderation = false;
    }
  }
  return cache.moderation;
}

export async function aChatMedia() {
  if (cache.chatMedia === null) cache.chatMedia = await tableExiste('chat_media');
  return cache.chatMedia;
}

/** Réinitialise le cache (utilisé par les tests). */
export function oublierCapacites() {
  cache.verifications = null;
  cache.moderation = null;
  cache.adminActions = null;
  cache.chatMedia = null;
}
