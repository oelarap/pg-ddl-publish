import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi, describe, it, beforeEach, expect } from 'vitest';

const genMock = vi.hoisted(() => vi.fn().mockResolvedValue({ sqlPath: '/x', sql: 'x' }));
const appMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../src/generate.js', () => ({
  generatePublication: (...a) => genMock(...a),
}));

vi.mock('../src/apply.js', () => ({
  applyPublicationAndPost: (...a) => appMock(...a),
}));

import { runCli } from '../src/cli-app.js';

describe('cli-app integration (mocked generate/apply)', () => {
  beforeEach(() => {
    genMock.mockClear();
    appMock.mockClear();
  });

  it('generate forwards strict resolver and calls generatePublication', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: path.join(tmp, 'out.sql'),
        }),
      );
      await runCli(['node', 'cli', 'generate', '-f', tmp, '-c', cfg, '--resolver', 'strict', '--unsafe']);
      expect(genMock).toHaveBeenCalledTimes(1);
      const arg = genMock.mock.calls[0][0];
      assert.equal(arg.resolver, 'strict');
      assert.equal(arg.unsafe, true);
      assert.equal(arg.folderAbs, path.resolve(tmp));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('generate --to-prod uses release output path', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: path.join(tmp, 'ignored.sql'),
        }),
      );
      await runCli(['node', 'cli', 'generate', '-f', tmp, '-c', cfg, '--to-prod']);
      const arg = genMock.mock.calls[0][0];
      assert.ok(arg.outputFileAbs.includes(path.join(path.resolve(tmp), 'release')));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('apply calls applyPublicationAndPost', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      const pub = path.join(tmp, 'pub.sql');
      await writeFile(pub, '-- DDL_EMPTY\n');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          schema: 'app',
        }),
      );
      await runCli(['node', 'cli', 'apply', '-f', tmp, '-p', pub, '-c', cfg]);
      expect(appMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('publish runs generate then apply', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: path.join(tmp, 'out.sql'),
        }),
      );
      await runCli(['node', 'cli', 'publish', '-f', tmp, '-c', cfg]);
      expect(genMock).toHaveBeenCalledTimes(1);
      expect(appMock).toHaveBeenCalledTimes(1);
      assert.equal(appMock.mock.calls[0][0].publicationPathAbs, genMock.mock.calls[0][0].outputFileAbs);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('publish uses config outputFile when --to-prod is omitted', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      const outSql = path.join(tmp, 'from-config.sql');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: outSql,
        }),
      );
      await runCli(['node', 'cli', 'publish', '-f', tmp, '-c', cfg]);
      assert.equal(genMock.mock.calls[0][0].outputFileAbs, path.resolve(outSql));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('publish --to-prod writes under folder/release', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: path.join(tmp, 'ignored.sql'),
        }),
      );
      await runCli(['node', 'cli', 'publish', '-f', tmp, '-c', cfg, '--to-prod']);
      assert.ok(genMock.mock.calls[0][0].outputFileAbs.includes(path.join(path.resolve(tmp), 'release')));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('publish forwards strict resolver to generatePublication', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-cli-'));
    try {
      const cfg = path.join(tmp, 'c.json');
      await writeFile(
        cfg,
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'app',
          outputFile: path.join(tmp, 'out.sql'),
        }),
      );
      await runCli(['node', 'cli', 'publish', '-f', tmp, '-c', cfg, '--resolver', 'strict']);
      assert.equal(genMock.mock.calls[0][0].resolver, 'strict');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
