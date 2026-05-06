import path from 'node:path';
import { runSqlFile } from './pg-exec.js';

const RETRYABLE_PG_CODES = new Set([
  '42883', // undefined_function
  '42P01', // undefined_table
  '42704', // undefined_object (incluye tipos)
  '42703', // undefined_column
]);

const IGNORABLE_PG_CODES = new Set([
  '42P07', // duplicate_table (incluye relation already exists)
  '42710', // duplicate_object
  '42723', // duplicate_function
  '42P06', // duplicate_schema
]);

/**
 * @param {unknown} err
 */
function getPgCode(err) {
  if (!err || typeof err !== 'object') return null;
  const maybe = /** @type {{ code?: unknown }} */ (err).code;
  return typeof maybe === 'string' ? maybe : null;
}

/**
 * @param {string[]} files
 * @param {object} opts
 * @param {string} opts.connectionString
 * @param {string} opts.schema
 * @param {string} opts.rootFolder
 * @param {'strict' | 'smart'} opts.resolver
 */
export async function executeDdlFiles(files, opts) {
  if (opts.resolver === 'strict') {
    for (const f of files) {
      console.error(`  · ${path.relative(opts.rootFolder, f)}`);
      await runSqlFile(opts.connectionString, opts.schema, f);
    }
    return;
  }

  const pending = [...files];
  let pass = 0;
  while (pending.length > 0) {
    pass += 1;
    console.error(`Ronda inteligente ${pass}: ${pending.length} pendiente(s)…`);
    let progressed = 0;
    const deferred = [];
    const hardFailures = [];

    for (const f of pending) {
      const rel = path.relative(opts.rootFolder, f);
      try {
        console.error(`  · ${rel}`);
        await runSqlFile(opts.connectionString, opts.schema, f);
        progressed += 1;
      } catch (e) {
        const code = getPgCode(e);
        if (code && IGNORABLE_PG_CODES.has(code)) {
          console.error(`    ↳ omitido (${code}, objeto ya existe)`);
          progressed += 1;
          continue;
        }
        if (code && RETRYABLE_PG_CODES.has(code)) {
          console.error(`    ↳ diferido (${code})`);
          deferred.push(f);
          continue;
        }
        hardFailures.push({ file: f, error: e });
      }
    }

    if (hardFailures.length > 0) {
      const first = hardFailures[0];
      throw new Error(
        `Error no recuperable ejecutando ${path.relative(opts.rootFolder, first.file)}.`,
        { cause: first.error instanceof Error ? first.error : undefined },
      );
    }

    if (deferred.length === 0) return;

    if (progressed === 0) {
      const list = deferred
        .map((f) => `- ${path.relative(opts.rootFolder, f)}`)
        .join('\n');
      throw new Error(
        `No fue posible resolver dependencias automáticamente.\nArchivos pendientes:\n${list}`,
      );
    }

    pending.splice(0, pending.length, ...deferred);
  }
}
