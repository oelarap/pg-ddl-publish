import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, UnsafeMigrationException } from '@pgkit/migra';
import { listDdlSqlFiles, listPreScriptFiles } from './sql-files.js';
import { ensureDatabaseExists, resetApplicationSchema, runSqlFile } from './pg-exec.js';
import { executeDdlFiles } from './dependency-resolver.js';

/**
 * @param {object} opts
 * @param {string} opts.folderAbs
 * @param {string} opts.targetUrl
 * @param {string} opts.scratchUrl
 * @param {string} opts.schema
 * @param {string} opts.preScriptDirName
 * @param {string} opts.postScriptDirName
 * @param {string[]} [opts.excludeDdlGlobs]
 * @param {string} opts.outputFileAbs
 * @param {boolean} opts.unsafe
 * @param {'strict' | 'smart'} opts.resolver
 */
export async function generatePublication(opts) {
  const files = await listDdlSqlFiles(
    opts.folderAbs,
    opts.postScriptDirName,
    opts.preScriptDirName,
    opts.excludeDdlGlobs ?? [],
  );
  const preFiles = await listPreScriptFiles(opts.folderAbs, opts.preScriptDirName);
  if (files.length === 0) {
    console.warn('No se encontraron archivos .sql (excluyendo pre_script/post_script).');
  }

  console.error(`Reconstruyendo estado deseado en scratch (${files.length} archivo(s))…`);
  const created = await ensureDatabaseExists(opts.scratchUrl);
  if (created) {
    console.error('Base scratch no existia; fue creada automaticamente.');
  }
  await resetApplicationSchema(opts.scratchUrl, opts.schema);
  if (preFiles.length > 0) {
    console.error(`Ejecutando pre_script en scratch (${preFiles.length} archivo(s))…`);
    for (const f of preFiles) {
      console.error(`  · ${path.relative(opts.folderAbs, f)}`);
      await runSqlFile(opts.scratchUrl, opts.schema, f);
    }
  }
  await executeDdlFiles(files, {
    connectionString: opts.scratchUrl,
    schema: opts.schema,
    rootFolder: opts.folderAbs,
    resolver: opts.resolver,
  });

  console.error('Comparando base objetivo con scratch (migra)…');
  let sql;
  try {
    const migration = await run(opts.targetUrl, opts.scratchUrl, {
      schema: opts.schema,
      unsafe: opts.unsafe,
      ignoreExtensionVersions: true,
    });
    sql = migration.sql.trim();
  } catch (e) {
    if (e instanceof UnsafeMigrationException) {
      throw new Error(
        'Migra detectó cambios destructivos (p. ej. DROP). Ejecuta de nuevo con --unsafe si es intencional.',
        { cause: e },
      );
    }
    throw e;
  }

  await mkdir(path.dirname(opts.outputFileAbs), { recursive: true });
  const header = `-- Generado por pg-ddl-publish
-- Origen carpeta: ${opts.folderAbs}
-- Esquema: ${opts.schema}
-- NO ejecutar a ciegas: revisar antes en producción.

`;
  const body = sql ? `${sql}\n` : '-- DDL_EMPTY\n';
  await writeFile(opts.outputFileAbs, `${header}${body}`, 'utf8');
  console.error(`Escrito: ${opts.outputFileAbs}`);
  return { sqlPath: opts.outputFileAbs, sql };
}
