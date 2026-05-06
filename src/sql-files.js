import fg from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lista .sql bajo `root`, excluyendo `postScriptDirName` en cualquier nivel.
 * Orden estable (alfabético con sensibilidad numérica en segmentos).
 *
 * @param {string} rootAbs
 * @param {string} postScriptDirName
 * @param {string} preScriptDirName
 * @param {string[]} [excludeDdlGlobs] patrones relativos a root (ej. "secuencias/**"); se niegan en el glob
 * @returns {Promise<string[]>} rutas absolutas
 */
export async function listDdlSqlFiles(
  rootAbs,
  postScriptDirName,
  preScriptDirName,
  excludeDdlGlobs = [],
) {
  if (!fs.existsSync(rootAbs)) {
    throw new Error(`La carpeta no existe: ${rootAbs}`);
  }
  const stat = fs.statSync(rootAbs);
  if (!stat.isDirectory()) {
    throw new Error(`No es una carpeta: ${rootAbs}`);
  }

  const extraNeg = excludeDdlGlobs.map((g) => {
    const t = g.trim();
    if (!t) return null;
    return t.startsWith('!') ? t : `!${t}`;
  }).filter(Boolean);

  const rel = await fg.glob(
    [
      '**/*.sql',
      `!**/${postScriptDirName}/**`,
      `!**/${preScriptDirName}/**`,
      '!release/**',
      ...extraNeg,
    ],
    {
    cwd: rootAbs,
    onlyFiles: true,
    dot: false,
    absolute: false,
    },
  );

  rel.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );

  return rel.map((r) => path.join(rootAbs, r));
}

/**
 * @param {string} folderAbs
 * @param {string} postScriptDirName
 * @returns {Promise<string[]>} rutas absolutas, ordenadas
 */
export async function listPostScriptFiles(folderAbs, postScriptDirName) {
  return listNamedScriptFiles(folderAbs, postScriptDirName);
}

/**
 * @param {string} folderAbs
 * @param {string} preScriptDirName
 * @returns {Promise<string[]>} rutas absolutas, ordenadas
 */
export async function listPreScriptFiles(folderAbs, preScriptDirName) {
  return listNamedScriptFiles(folderAbs, preScriptDirName);
}

/**
 * @param {string} folderAbs
 * @param {string} dirName
 */
async function listNamedScriptFiles(folderAbs, dirName) {
  const dir = path.join(folderAbs, dirName);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const rel = await fg.glob(['**/*.sql'], {
    cwd: dir,
    onlyFiles: true,
    dot: false,
    absolute: false,
  });
  rel.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
  return rel.map((r) => path.join(dir, r));
}
