import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  listDdlSqlFiles,
  listPostScriptFiles,
  listPreScriptFiles,
} from '../src/sql-files.js';

describe('sql-files', () => {
  it('listDdlSqlFiles throws if root does not exist', async () => {
    const p = path.join(os.tmpdir(), 'pg-ddl-publish-missing-' + Date.now());
    await assert.rejects(() => listDdlSqlFiles(p, 'post_script', 'pre_script'), /no existe/);
  });

  it('listDdlSqlFiles throws if root is not a directory', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const file = path.join(tmp, 'notadir');
      await writeFile(file, 'x');
      await assert.rejects(
        () => listDdlSqlFiles(file, 'post_script', 'pre_script'),
        /No es una carpeta/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listDdlSqlFiles excludes pre_script, post_script, release and applies exclude globs', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await mkdir(path.join(tmp, 'tablas'), { recursive: true });
      await mkdir(path.join(tmp, 'secuencias'), { recursive: true });
      await mkdir(path.join(tmp, 'pre_script'), { recursive: true });
      await mkdir(path.join(tmp, 'post_script'), { recursive: true });
      await mkdir(path.join(tmp, 'release'), { recursive: true });
      await writeFile(path.join(tmp, 'tablas', 'a.sql'), '');
      await writeFile(path.join(tmp, 'secuencias', 's.sql'), '');
      await writeFile(path.join(tmp, 'pre_script', 'p.sql'), '');
      await writeFile(path.join(tmp, 'post_script', 'x.sql'), '');
      await writeFile(path.join(tmp, 'release', 'old.sql'), '');
      const files = await listDdlSqlFiles(tmp, 'post_script', 'pre_script', [
        'secuencias/**',
        '   ',
        '!tablas/**',
      ]);
      assert.deepEqual(files, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listDdlSqlFiles sorts with numeric segments', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await writeFile(path.join(tmp, '2.sql'), '');
      await writeFile(path.join(tmp, '10.sql'), '');
      await writeFile(path.join(tmp, '1.sql'), '');
      const files = await listDdlSqlFiles(tmp, 'post_script', 'pre_script');
      assert.deepEqual(
        files.map((f) => path.basename(f)),
        ['1.sql', '2.sql', '10.sql'],
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listDdlSqlFiles ignores whitespace-only exclude patterns', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await writeFile(path.join(tmp, 'only.sql'), '');
      const files = await listDdlSqlFiles(tmp, 'post_script', 'pre_script', ['  ', '']);
      assert.equal(files.length, 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listDdlSqlFiles keeps leading ! in user exclude globs', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await mkdir(path.join(tmp, 'keep'), { recursive: true });
      await mkdir(path.join(tmp, 'drop'), { recursive: true });
      await writeFile(path.join(tmp, 'keep', 'k.sql'), '');
      await writeFile(path.join(tmp, 'drop', 'd.sql'), '');
      const files = await listDdlSqlFiles(tmp, 'post_script', 'pre_script', ['!keep/**']);
      assert.deepEqual(files.map((f) => path.basename(f)), ['d.sql']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listPreScriptFiles returns empty if dir missing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const files = await listPreScriptFiles(tmp, 'pre_script');
      assert.deepEqual(files, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('listPreScriptFiles and listPostScriptFiles list nested sql in order', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await mkdir(path.join(tmp, 'pre_script', 'sub'), { recursive: true });
      await writeFile(path.join(tmp, 'pre_script', 'b.sql'), '');
      await writeFile(path.join(tmp, 'pre_script', 'sub', 'a.sql'), '');
      const pre = await listPreScriptFiles(tmp, 'pre_script');
      assert.deepEqual(
        pre.map((f) => path.relative(tmp, f)),
        [path.join('pre_script', 'b.sql'), path.join('pre_script', 'sub', 'a.sql')],
      );

      await mkdir(path.join(tmp, 'post_script'), { recursive: true });
      await writeFile(path.join(tmp, 'post_script', 'z.sql'), '');
      const post = await listPostScriptFiles(tmp, 'post_script');
      assert.equal(post.length, 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
