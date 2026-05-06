import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { listPostScriptFiles, listPreScriptFiles } from './sql-files.js';
import { runSqlFile } from './pg-exec.js';

const { Client, escapeIdentifier } = pg;

/**
 * @param {object} opts
 * @param {string} opts.targetUrl
 * @param {string} opts.schema
 * @param {string} opts.folderAbs
 * @param {string} opts.preScriptDirName
 * @param {string} opts.postScriptDirName
 * @param {string} opts.publicationPathAbs
 */
export async function applyPublicationAndPost(opts) {
  const preFiles = await listPreScriptFiles(opts.folderAbs, opts.preScriptDirName);
  if (preFiles.length > 0) {
    console.error(`Ejecutando pre_script (${preFiles.length} archivo(s))…`);
    for (const f of preFiles) {
      console.error(`  · ${path.relative(opts.folderAbs, f)}`);
      await runSqlFile(opts.targetUrl, opts.schema, f);
    }
  }

  const pub = await readFile(opts.publicationPathAbs, 'utf8');
  const skipDdl = /-- DDL_EMPTY\b/m.test(pub);

  const client = new Client({ connectionString: opts.targetUrl });
  await client.connect();
  try {
    if (!skipDdl) {
      console.error('Aplicando publicación en objetivo (transacción)…');
      await client.query('BEGIN');
      await client.query(
        `SET search_path TO ${escapeIdentifier(opts.schema)}, public`,
      );
      await client.query(pub);
      await client.query('COMMIT');
    } else {
      console.error('Publicación sin cambios de esquema (-- DDL_EMPTY); se omite DDL en objetivo.');
    }
  } catch (e) {
    if (!skipDdl) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }

  const postFiles = await listPostScriptFiles(opts.folderAbs, opts.postScriptDirName);
  if (postFiles.length === 0) {
    console.error('No hay scripts en post_script.');
    return;
  }
  console.error(`Ejecutando post_script (${postFiles.length} archivo(s))…`);
  for (const f of postFiles) {
    console.error(`  · ${path.relative(opts.folderAbs, f)}`);
    await runSqlFile(opts.targetUrl, opts.schema, f);
  }
}
