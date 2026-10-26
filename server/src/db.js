import pg from 'pg';
import { config } from './config.js';

// Neon fournit deux URL :
//   - la chaîne "pooler" (hôte contenant -pooler) pour l'application ;
//   - la chaîne directe pour les migrations.
// `pg` fonctionne avec les deux ; on garde SSL activé (Neon l'exige).
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
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
