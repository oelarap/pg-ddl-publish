import path from 'node:path';

/**
 * Ruta de salida "producción": `{folder}/release/release_dd_MM_yyyy_HH_mm_ss.sql`
 * (fecha/hora local del sistema).
 *
 * @param {string} folderAbs
 */
export function buildProdReleaseOutputPath(folderAbs) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const dd = p2(now.getDate());
  const MM = p2(now.getMonth() + 1);
  const yyyy = String(now.getFullYear());
  const HH = p2(now.getHours());
  const mm = p2(now.getMinutes());
  const ss = p2(now.getSeconds());
  const name = `release_${dd}_${MM}_${yyyy}_${HH}_${mm}_${ss}.sql`;
  return path.join(path.resolve(folderAbs), 'release', name);
}
