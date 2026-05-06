import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { vi, describe, it, beforeEach } from 'vitest';

const runSqlFileMock = vi.hoisted(() => vi.fn());

vi.mock('../src/pg-exec.js', () => ({
  runSqlFile: (...args) => runSqlFileMock(...args),
}));

import { executeDdlFiles } from '../src/dependency-resolver.js';

const root = path.join(os.tmpdir(), 'pg-ddl-ddlroot');
const optsBase = {
  connectionString: 'postgresql://x',
  schema: 'app',
  rootFolder: root,
};

describe('dependency-resolver', () => {
  beforeEach(() => {
    runSqlFileMock.mockReset();
  });

  it('strict resolver propagates errors from runSqlFile', async () => {
    runSqlFileMock.mockRejectedValue(new Error('strict-fail'));
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'strict' }),
      /strict-fail/,
    );
  });

  it('strict resolver runs each file in order', async () => {
    const files = [path.join(root, 'a.sql'), path.join(root, 'b.sql')];
    runSqlFileMock.mockResolvedValue(undefined);
    await executeDdlFiles(files, { ...optsBase, resolver: 'strict' });
    assert.equal(runSqlFileMock.mock.calls.length, 2);
  });

  it('smart resolver completes in one pass', async () => {
    const files = [path.join(root, 'a.sql')];
    runSqlFileMock.mockResolvedValue(undefined);
    await executeDdlFiles(files, { ...optsBase, resolver: 'smart' });
    assert.equal(runSqlFileMock.mock.calls.length, 1);
  });

  it('smart resolver ignores duplicate_object class errors', async () => {
    const codes = ['42P07', '42710', '42723', '42P06'];
    for (const code of codes) {
      runSqlFileMock.mockReset();
      const err = new Error('dup');
      err.code = code;
      runSqlFileMock.mockRejectedValueOnce(err).mockResolvedValue(undefined);
      await executeDdlFiles([path.join(root, 'x.sql')], { ...optsBase, resolver: 'smart' });
      assert.equal(runSqlFileMock.mock.calls.length, 1);
    }
  });

  it('smart resolver defers retryable errors and finishes next round', async () => {
    const defer = new Error('defer');
    defer.code = '42883';
    runSqlFileMock
      .mockRejectedValueOnce(defer)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const files = [path.join(root, 'a.sql'), path.join(root, 'b.sql')];
    await executeDdlFiles(files, { ...optsBase, resolver: 'smart' });
    assert.ok(runSqlFileMock.mock.calls.length >= 3);
  });

  it('smart resolver throws on non-recoverable errors', async () => {
    const err = new Error('hard');
    err.code = '23505';
    runSqlFileMock.mockRejectedValue(err);
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /no recuperable/,
    );
  });

  it('smart resolver throws when nothing progresses', async () => {
    const defer = new Error('defer');
    defer.code = '42P01';
    runSqlFileMock.mockRejectedValue(defer);
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /No fue posible resolver dependencias/,
    );
  });

  it('smart resolver treats missing pg code as hard failure', async () => {
    runSqlFileMock.mockRejectedValueOnce(new Error('no code'));
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /no recuperable/,
    );
  });

  it('smart resolver treats non-string pg code as hard failure', async () => {
    const err = new Error('x');
    err.code = 42;
    runSqlFileMock.mockRejectedValueOnce(err);
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /no recuperable/,
    );
  });

  it('smart resolver treats thrown non-object as hard failure', async () => {
    runSqlFileMock.mockRejectedValueOnce('plain-string');
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /no recuperable/,
    );
  });

  it('smart resolver handles thrown null like missing pg code', async () => {
    runSqlFileMock.mockRejectedValueOnce(null);
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      /no recuperable/,
    );
  });

  it('Error cause omits non-Error values', async () => {
    runSqlFileMock.mockRejectedValueOnce({ code: '23505', message: 'x' });
    await assert.rejects(
      () => executeDdlFiles([path.join(root, 'a.sql')], { ...optsBase, resolver: 'smart' }),
      (e) => {
        assert.match(String(e.message), /no recuperable/);
        assert.equal(/** @type {Error} */ (e).cause, undefined);
        return true;
      },
    );
  });
});
