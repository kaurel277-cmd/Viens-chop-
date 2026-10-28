import pg from 'pg';
import { config } from './config.js';

/**
 * Neon exige SSL. Selon la version de `pg`, la chaîne `?sslmode=require`
 * déclenche un avertissement bruyant dans les logs (« SECURITY WARNING:
 * The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases
 * for 'verify-full' »). On indique explicitement le comportement voulu pour
 * garder des logs lisibles.
 */
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const mode = u.searchParams.get('sslmode');
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      // sémantique libpq : chiffrement sans vérification de la chaîne de
      // certification (comportement historique de Neon)
      u.searchParams.set('uselibpqcompat', 'true');
    }
    return u.toString();
  } catch {
    return raw;                       // chaîne non standard : on la laisse telle quelle
  }
}

const connectionString = normalizeUrl(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString,
  ssl: /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on('error', (err) => {
  console.error('[db] erreur de connexion inactive :', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Exécute plusieurs requêtes dans une transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
