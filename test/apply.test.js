import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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

import { applyPublicationAndPost } from '../src/apply.js';

describe('applyPublicationAndPost', () => {
  beforeEach(() => {
    pgMocks.queryMock.mockReset();
    pgMocks.queryMock.mockResolvedValue({ rowCount: 0 });
  });

  it('runs pre_script, applies publication in transaction, then post_script', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      await mkdir(path.join(tmp, 'pre_script'), { recursive: true });
      await mkdir(path.join(tmp, 'post_script'), { recursive: true });
      await writeFile(path.join(tmp, 'pre_script', '01.sql'), 'SELECT 1;', 'utf8');
      await writeFile(path.join(tmp, 'post_script', '99.sql'), 'SELECT 2;', 'utf8');
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, 'SELECT 3;', 'utf8');
      await applyPublicationAndPost({
        targetUrl: 'postgresql://localhost/x',
        schema: 'app',
        folderAbs: tmp,
        preScriptDirName: 'pre_script',
        postScriptDirName: 'post_script',
        publicationPathAbs: pub,
      });
      const calls = pgMocks.queryMock.mock.calls.map((c) => String(c[0]));
      assert.ok(calls.some((s) => s === 'BEGIN'));
      assert.ok(calls.some((s) => s === 'COMMIT'));
      assert.ok(calls.some((s) => s === 'SELECT 3;'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('skips DDL on target when publication is DDL_EMPTY', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, '-- header\n-- DDL_EMPTY\n', 'utf8');
      await applyPublicationAndPost({
        targetUrl: 'postgresql://localhost/x',
        schema: 'app',
        folderAbs: tmp,
        preScriptDirName: 'pre_script',
        postScriptDirName: 'post_script',
        publicationPathAbs: pub,
      });
      const calls = pgMocks.queryMock.mock.calls.map((c) => String(c[0]));
      assert.ok(!calls.includes('BEGIN'));
      assert.equal(calls.length, 1);
      assert.ok(calls[0].toUpperCase().includes('CREATE SCHEMA'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rolls back when publication query fails', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, 'SELECT BOOM;', 'utf8');
      pgMocks.queryMock.mockImplementation((q) => {
        const s = String(q);
        if (s === 'ROLLBACK') return {};
        if (s === 'BEGIN' || s.startsWith('SET search_path')) return { rowCount: 0 };
        if (s === 'SELECT BOOM;') throw new Error('exec failed');
        return { rowCount: 0 };
      });
      await assert.rejects(
        () =>
          applyPublicationAndPost({
            targetUrl: 'postgresql://localhost/x',
            schema: 'app',
            folderAbs: tmp,
            preScriptDirName: 'pre_script',
            postScriptDirName: 'post_script',
            publicationPathAbs: pub,
          }),
        /exec failed/,
      );
      assert.ok(pgMocks.queryMock.mock.calls.some((c) => String(c[0]) === 'ROLLBACK'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns early when post_script folder has no sql', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, '-- DDL_EMPTY\n', 'utf8');
      await mkdir(path.join(tmp, 'post_script'), { recursive: true });
      await applyPublicationAndPost({
        targetUrl: 'postgresql://localhost/x',
        schema: 'app',
        folderAbs: tmp,
        preScriptDirName: 'pre_script',
        postScriptDirName: 'post_script',
        publicationPathAbs: pub,
      });
      assert.equal(pgMocks.queryMock.mock.calls.length, 1); // solo CREATE SCHEMA
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('ROLLBACK failure is swallowed after query error', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-'));
    try {
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, 'BAD;', 'utf8');
      let sawRollback = false;
      pgMocks.queryMock.mockImplementation((q) => {
        const s = String(q);
        if (s === 'ROLLBACK') {
          sawRollback = true;
          throw new Error('rollback also failed');
        }
        if (s === 'BEGIN' || s.startsWith('SET search_path')) return { rowCount: 0 };
        if (s === 'BAD;') throw new Error('main failed');
        return { rowCount: 0 };
      });
      await assert.rejects(
        () =>
          applyPublicationAndPost({
            targetUrl: 'postgresql://localhost/x',
            schema: 'app',
            folderAbs: tmp,
            preScriptDirName: 'pre_script',
            postScriptDirName: 'post_script',
            publicationPathAbs: pub,
          }),
        /main failed/,
      );
      assert.equal(sawRollback, true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
