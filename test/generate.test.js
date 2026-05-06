import assert from 'node:assert/strict';
import { readFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi, describe, it, beforeEach } from 'vitest';

const migraMocks = vi.hoisted(() => {
  class UnsafeMigrationException extends Error {}
  const migraRun = vi.fn();
  return { UnsafeMigrationException, migraRun };
});

const mocks = vi.hoisted(() => ({
  listDdlSqlFiles: vi.fn(),
  listPreScriptFiles: vi.fn(),
  ensureDatabaseExists: vi.fn(),
  resetApplicationSchema: vi.fn(),
  runSqlFile: vi.fn(),
  executeDdlFiles: vi.fn(),
}));

vi.mock('../src/sql-files.js', () => ({
  listDdlSqlFiles: (...a) => mocks.listDdlSqlFiles(...a),
  listPreScriptFiles: (...a) => mocks.listPreScriptFiles(...a),
}));

vi.mock('../src/pg-exec.js', () => ({
  ensureDatabaseExists: (...a) => mocks.ensureDatabaseExists(...a),
  resetApplicationSchema: (...a) => mocks.resetApplicationSchema(...a),
  runSqlFile: (...a) => mocks.runSqlFile(...a),
}));

vi.mock('../src/dependency-resolver.js', () => ({
  executeDdlFiles: (...a) => mocks.executeDdlFiles(...a),
}));

vi.mock('@pgkit/migra', () => ({
  run: (...a) => migraMocks.migraRun(...a),
  UnsafeMigrationException: migraMocks.UnsafeMigrationException,
}));

import { generatePublication } from '../src/generate.js';

const baseOpts = (folderAbs, outFile) => ({
  folderAbs,
  targetUrl: 'postgresql://t',
  scratchUrl: 'postgresql://s',
  schema: 'app',
  preScriptDirName: 'pre_script',
  postScriptDirName: 'post_script',
  excludeDdlGlobs: [],
  outputFileAbs: outFile,
  unsafe: false,
  resolver: 'smart',
});

describe('generatePublication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDdlSqlFiles.mockResolvedValue([path.join('x', 'a.sql')]);
    mocks.listPreScriptFiles.mockResolvedValue([]);
    mocks.ensureDatabaseExists.mockResolvedValue(false);
    mocks.resetApplicationSchema.mockResolvedValue(undefined);
    mocks.runSqlFile.mockResolvedValue(undefined);
    mocks.executeDdlFiles.mockResolvedValue(undefined);
    migraMocks.migraRun.mockResolvedValue({ sql: 'ALTER TABLE t ADD c int;' });
  });

  it('continues when no ddl files (empty list)', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      mocks.listDdlSqlFiles.mockResolvedValue([]);
      await generatePublication(baseOpts(tmp, out));
      assert.ok(migraMocks.migraRun.mock.calls.length >= 1);
      const txt = await readFile(out, 'utf8');
      assert.match(txt, /Generado por pg-ddl-publish/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('marks scratch as newly created when ensureDatabaseExists returns true', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      mocks.ensureDatabaseExists.mockResolvedValue(true);
      await generatePublication(baseOpts(tmp, out));
      assert.equal(mocks.ensureDatabaseExists.mock.calls[0][0], 'postgresql://s');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('runs pre_script files on scratch when present', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      const pre = path.join(tmp, 'pre', 'p.sql');
      await mkdir(path.dirname(pre), { recursive: true });
      mocks.listPreScriptFiles.mockResolvedValue([pre]);
      await generatePublication(baseOpts(tmp, out));
      assert.ok(mocks.runSqlFile.mock.calls.some((c) => c[2] === pre));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('writes DDL_EMPTY when migra returns empty sql', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      migraMocks.migraRun.mockResolvedValue({ sql: '   \n  ' });
      await generatePublication(baseOpts(tmp, out));
      const txt = await readFile(out, 'utf8');
      assert.match(txt, /-- DDL_EMPTY/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('writes trimmed migration sql', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      migraMocks.migraRun.mockResolvedValue({ sql: '  SELECT 1;  ' });
      await generatePublication(baseOpts(tmp, out));
      const txt = await readFile(out, 'utf8');
      assert.match(txt, /SELECT 1;/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('wraps UnsafeMigrationException from migra', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      migraMocks.migraRun.mockRejectedValue(new migraMocks.UnsafeMigrationException('unsafe'));
      await assert.rejects(() => generatePublication(baseOpts(tmp, out)), /destructivos/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rethrows unexpected migra errors', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      migraMocks.migraRun.mockRejectedValue(new Error('network'));
      await assert.rejects(() => generatePublication(baseOpts(tmp, out)), /network/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('passes excludeDdlGlobs through to listDdlSqlFiles', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      const globs = ['secuencias/**'];
      await generatePublication({ ...baseOpts(tmp, out), excludeDdlGlobs: globs });
      assert.deepEqual(mocks.listDdlSqlFiles.mock.calls[0].slice(1, 4), [
        'post_script',
        'pre_script',
        globs,
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('coalesces missing excludeDdlGlobs to empty array', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      const opts = { ...baseOpts(tmp, out), excludeDdlGlobs: undefined };
      await generatePublication(opts);
      assert.deepEqual(mocks.listDdlSqlFiles.mock.calls[0][3], []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns sql path and sql string', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const out = path.join(tmp, 'out', 'pub.sql');
      const r = await generatePublication(baseOpts(tmp, out));
      assert.equal(r.sqlPath, out);
      assert.match(r.sql, /ALTER TABLE/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
