import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi, describe, it, beforeEach } from 'vitest';

const pgMocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class MockClient {
      async connect() {}
      async query(...args) {
        return pgMocks.queryMock(...args);
      }
      async end() {}
    },
    escapeIdentifier: (str) => `"${String(str).replace(/"/g, '""')}"`,
  },
}));

import { ensureDatabaseExists, runSql, resetApplicationSchema, runSqlFile } from '../src/pg-exec.js';

describe('pg-exec', () => {
  beforeEach(() => {
    pgMocks.queryMock.mockReset();
  });

  it('ensureDatabaseExists throws when database name is missing', async () => {
    await assert.rejects(() => ensureDatabaseExists('postgresql://localhost:5432/'), /nombre de base/);
  });

  it('ensureDatabaseExists returns false when database already exists', async () => {
    pgMocks.queryMock.mockResolvedValue({ rowCount: 1 });
    const created = await ensureDatabaseExists('postgresql://localhost:5432/mydb');
    assert.equal(created, false);
    assert.ok(pgMocks.queryMock.mock.calls[0][0].includes('pg_database'));
  });

  it('ensureDatabaseExists creates database and returns true', async () => {
    pgMocks.queryMock.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({});
    const created = await ensureDatabaseExists('postgresql://localhost:5432/newdb');
    assert.equal(created, true);
    assert.equal(pgMocks.queryMock.mock.calls.length, 2);
  });

  it('runSql runs query and prefixes errors with label', async () => {
    pgMocks.queryMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('fail'));
    await runSql('postgresql://x', 'SELECT 1', 'lbl');
    await assert.rejects(() => runSql('postgresql://x', 'BAD', 'lbl'), /lbl: fail/);
  });

  it('resetApplicationSchema drops and creates schema', async () => {
    pgMocks.queryMock.mockResolvedValue({});
    await resetApplicationSchema('postgresql://x', 'app');
    const sql = String(pgMocks.queryMock.mock.calls[0][0]);
    assert.match(sql, /DROP SCHEMA IF EXISTS "app"/);
    assert.match(sql, /CREATE SCHEMA "app"/);
  });

  it('runSqlFile strips BOM and runs file SQL', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const f = path.join(tmp, 'b.sql');
      await writeFile(f, '\uFEFFSELECT 1;', 'utf8');
      pgMocks.queryMock.mockResolvedValue({});
      await runSqlFile('postgresql://x', 'app', f);
      assert.ok(pgMocks.queryMock.mock.calls.some((c) => String(c[0]).includes('SET search_path')));
      const bodyCall = pgMocks.queryMock.mock.calls.find((c) => String(c[0]) === 'SELECT 1;');
      assert.ok(bodyCall);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('runSqlFile prefixes errors with file path', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const f = path.join(tmp, 'bad.sql');
      await writeFile(f, 'SELECT oops;', 'utf8');
      pgMocks.queryMock.mockImplementation((sql) => {
        if (String(sql).startsWith('SET search_path')) return {};
        throw new Error('syntax');
      });
      await assert.rejects(() => runSqlFile('postgresql://x', 'app', f), new RegExp(f.replace(/\\/g, '\\\\')));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
