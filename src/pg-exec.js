import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { escapeIdentifier } = pg;

/**
 * Crea la base de datos destino si no existe.
 * Se conecta a la base administrativa "postgres" usando el mismo host/credenciales.
 *
 * @param {string} connectionString
 * @returns {Promise<boolean>} true si se creo, false si ya existia
 */
export async function ensureDatabaseExists(connectionString) {
  const url = new URL(connectionString);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) {
    throw new Error('La URL de conexion no contiene nombre de base de datos.');
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  adminUrl.hash = '';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    if (exists.rowCount && exists.rowCount > 0) {
      return false;
    }
    await client.query(`create database ${escapeIdentifier(dbName)}`);
    return true;
  } finally {
    await client.end();
  }
}

/**
 * @param {string} connectionString
 * @param {string} sql
 * @param {string} [label]
 */
export async function runSql(connectionString, sql, label = 'SQL') {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    err.message = `${label}: ${err.message}`;
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * @param {string} connectionString
 * @param {string} schemaIdent
 */
export async function resetApplicationSchema(connectionString, schemaIdent) {
  const sch = escapeIdentifier(schemaIdent);
  await runSql(
    connectionString,
    `
    DROP SCHEMA IF EXISTS ${sch} CASCADE;
    CREATE SCHEMA ${sch};
    `,
    `reset schema ${schemaIdent}`,
  );
}

/**
 * @param {string} connectionString
 * @param {string} schemaIdent
 * @param {string} filePath
 */
export async function runSqlFile(connectionString, schemaIdent, filePath) {
  const raw = await readFile(filePath, 'utf8');
  const body = raw.replace(/^\uFEFF/, '');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${escapeIdentifier(schemaIdent)}, public`);
    await client.query(body);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    err.message = `${filePath}: ${err.message}`;
    throw err;
  } finally {
    await client.end();
  }
}
