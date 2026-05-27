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

import { generatePublication, splitSqlStatements, reorderFunctionsBeforeTables } from '../src/generate.js';

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

describe('splitSqlStatements', () => {
  it('splits simple statements', () => {
    const stmts = splitSqlStatements('SELECT 1; SELECT 2;');
    assert.deepEqual(stmts, ['SELECT 1;', 'SELECT 2;']);
  });

  it('preserves dollar-quoted function bodies', () => {
    const sql = `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $function$ SELECT 1; $function$;`;
    const stmts = splitSqlStatements(sql);
    assert.equal(stmts.length, 1);
    assert.ok(stmts[0].includes('$function$'));
  });

  it('handles nested semicolons inside dollar-quoted strings', () => {
    const sql = `CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $$SELECT 'a;b';$$; ALTER TABLE t ADD c int;`;
    const stmts = splitSqlStatements(sql);
    assert.equal(stmts.length, 2);
    assert.ok(stmts[0].startsWith('CREATE FUNCTION'));
    assert.ok(stmts[1].startsWith('ALTER TABLE'));
  });

  it('handles single-quoted strings with embedded semicolons', () => {
    const stmts = splitSqlStatements(`INSERT INTO t VALUES ('a;b'); SELECT 1;`);
    assert.equal(stmts.length, 2);
  });

  it('handles escaped single quotes inside strings', () => {
    const stmts = splitSqlStatements(`INSERT INTO t VALUES ('it''s fine'); SELECT 2;`);
    assert.equal(stmts.length, 2);
    assert.ok(stmts[0].includes("it''s fine"));
  });

  it('ignores whitespace-only or empty input', () => {
    assert.deepEqual(splitSqlStatements(''), []);
    assert.deepEqual(splitSqlStatements('   \n  '), []);
  });
});

describe('reorderFunctionsBeforeTables', () => {
  it('returns sql unchanged when no functions', () => {
    const sql = 'CREATE TABLE t (id int);\nALTER TABLE t ADD c text;';
    assert.equal(reorderFunctionsBeforeTables(sql), sql);
  });

  it('moves CREATE FUNCTION before CREATE TABLE', () => {
    const fn = `CREATE FUNCTION f(text) RETURNS text LANGUAGE sql AS $$SELECT $1$$;`;
    const tbl = `CREATE TABLE u (id int, col text GENERATED ALWAYS AS (f(name)) STORED);`;
    const sql = `${tbl}\n${fn}`;
    const result = reorderFunctionsBeforeTables(sql);
    assert.ok(result.indexOf('CREATE FUNCTION') < result.indexOf('CREATE TABLE'));
  });

  it('moves CREATE OR REPLACE FUNCTION before CREATE TABLE', () => {
    const fn = `CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE sql AS $$SELECT 1$$;`;
    const tbl = `CREATE TABLE t (id int);`;
    const sql = `${tbl}\n${fn}`;
    const result = reorderFunctionsBeforeTables(sql);
    assert.ok(result.indexOf('CREATE OR REPLACE FUNCTION') < result.indexOf('CREATE TABLE'));
  });

  it('keeps non-function statements in original relative order', () => {
    const sql = [
      `CREATE TABLE a (id int);`,
      `ALTER TABLE a ADD c int;`,
      `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$SELECT 1$$;`,
      `CREATE TABLE b (id int);`,
    ].join('\n');
    const result = reorderFunctionsBeforeTables(sql);
    const fnIdx = result.indexOf('CREATE FUNCTION');
    const aIdx = result.indexOf('CREATE TABLE a');
    const alterIdx = result.indexOf('ALTER TABLE');
    const bIdx = result.indexOf('CREATE TABLE b');
    assert.ok(fnIdx < aIdx);
    assert.ok(aIdx < alterIdx);
    assert.ok(alterIdx < bIdx);
  });

  it('handles real-world migra pattern with dollar-quoted function', () => {
    const fn = [
      `CREATE OR REPLACE FUNCTION bd_dental.f_tsvector_nombre(text, text, text)`,
      ` RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE`,
      `AS $function$ SELECT to_tsvector('spanish', $1 || ' ' || $2) $function$;`,
    ].join('\n');
    const tbl = [
      `CREATE TABLE bd_dental.usuario (`,
      `  id serial4 NOT NULL,`,
      `  busqueda_nombre tsvector GENERATED ALWAYS AS (f_tsvector_nombre(nombre::text, ap::text, am::text)) STORED`,
      `);`,
    ].join('\n');
    const sql = `${tbl}\n${fn}`;
    const result = reorderFunctionsBeforeTables(sql);
    assert.ok(result.indexOf('f_tsvector_nombre') < result.indexOf('CREATE TABLE'));
  });
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
