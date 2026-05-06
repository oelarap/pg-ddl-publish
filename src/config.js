import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/i;

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeExcludeDdlGlobs(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === 'string' && x.trim().length > 0);
}

/**
 * @param {string} filePath
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJsonIfExists(filePath) {
  try {
    const txt = await readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
    return null;
  }
}

/**
 * @param {string} raw
 */
export function assertSafeIdent(raw) {
  if (!SCHEMA_RE.test(raw)) {
    throw new Error(`Identificador de esquema no válido: ${JSON.stringify(raw)}`);
  }
}

/**
 * @param {string} configPath
 * @param {Record<string, string | string[] | undefined>} [cliOverrides]
 * @param {{ requireScratch?: boolean }} [options]
 */
export async function loadConfig(configPath, cliOverrides = {}, options = {}) {
  const { requireScratch = true } = options;
  const resolvedConfig = path.resolve(configPath);
  const examplePath = path.join(path.dirname(resolvedConfig), 'ddl-publish.config.example.json');

  const fromExample = await readJsonIfExists(examplePath);
  const fromUser = await readJsonIfExists(resolvedConfig);

  /** @type {Record<string, unknown>} */
  let base = { ...(fromExample ?? {}), ...(fromUser ?? {}) };

  if (!fromUser && fromExample) {
    console.error(
      `Aviso: no existe ${resolvedConfig}; usando valores de ${path.basename(examplePath)} (copia el archivo para personalizar).`,
    );
  }

  const targetUrl =
    cliOverrides.targetUrl ?? process.env.DDL_PUBLISH_TARGET_URL ?? base.targetUrl;
  const scratchUrl =
    cliOverrides.scratchUrl ?? process.env.DDL_PUBLISH_SCRATCH_URL ?? base.scratchUrl;
  const schema =
    cliOverrides.schema ?? process.env.DDL_PUBLISH_SCHEMA ?? base.schema ?? 'public';
  const preScriptDirName =
    cliOverrides.preScriptDirName ?? base.preScriptDirName ?? 'pre_script';
  const postScriptDirName =
    cliOverrides.postScriptDirName ?? base.postScriptDirName ?? 'post_script';
  const outputFile =
    cliOverrides.outputFile ?? process.env.DDL_PUBLISH_OUTPUT ?? base.outputFile ?? './out/publicacion.sql';
  const folder = cliOverrides.folder ?? base.folder ?? null;

  const excludeDdlGlobs = [
    ...normalizeExcludeDdlGlobs(base.excludeDdlGlobs),
    ...normalizeExcludeDdlGlobs(cliOverrides.excludeDdlGlobs),
  ];

  if (!targetUrl) {
    throw new Error('Falta targetUrl (config, DDL_PUBLISH_TARGET_URL o --target-url).');
  }
  if (requireScratch && !scratchUrl) {
    throw new Error('Falta scratchUrl (config, DDL_PUBLISH_SCRATCH_URL o --scratch-url).');
  }
  assertSafeIdent(schema);

  return {
    targetUrl,
    scratchUrl,
    schema,
    preScriptDirName,
    postScriptDirName,
    excludeDdlGlobs,
    outputFile: path.resolve(outputFile),
    folder: folder ? path.resolve(folder) : null,
  };
}
