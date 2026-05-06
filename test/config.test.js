import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { assertSafeIdent, loadConfig } from '../src/config.js';

describe('config', () => {
  it('assertSafeIdent accepts valid schema names', () => {
    assertSafeIdent('public');
    assertSafeIdent('app');
    assertSafeIdent('my_schema');
    assertSafeIdent('MySchema');
  });

  it('assertSafeIdent rejects invalid identifiers', () => {
    assert.throws(() => assertSafeIdent('bad-name'), /no válido/);
    assert.throws(() => assertSafeIdent(''), /no válido/);
    assert.throws(() => assertSafeIdent('1schema'), /no válido/);
  });

  it('loadConfig merges user file over example', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-cfg-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.example.json'),
        JSON.stringify({
          targetUrl: 'postgresql://localhost/example_target',
          scratchUrl: 'postgresql://localhost/example_scratch',
          schema: 'public',
          excludeDdlGlobs: ['a/**'],
          folder: null,
        }),
      );
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({
          schema: 'app',
          folder: path.join(tmp, 'ddl'),
          excludeDdlGlobs: ['b/**'],
          outputFile: path.join(tmp, 'out', 'publicacion.sql'),
        }),
      );
      const cfgPath = path.join(tmp, 'ddl-publish.config.json');
      const cfg = await loadConfig(cfgPath, {});
      assert.equal(cfg.targetUrl, 'postgresql://localhost/example_target');
      assert.equal(cfg.scratchUrl, 'postgresql://localhost/example_scratch');
      assert.equal(cfg.schema, 'app');
      assert.deepEqual(cfg.excludeDdlGlobs, ['b/**']);
      assert.equal(cfg.folder, path.resolve(path.join(tmp, 'ddl')));
      assert.equal(cfg.outputFile, path.resolve(path.join(tmp, 'out', 'publicacion.sql')));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig apply mode does not require scratchUrl', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-apply-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({
          targetUrl: 'postgresql://localhost/only_target',
          schema: 'public',
        }),
      );
      const cfg = await loadConfig(path.join(tmp, 'ddl-publish.config.json'), {}, { requireScratch: false });
      assert.equal(cfg.targetUrl, 'postgresql://localhost/only_target');
      assert.equal(cfg.scratchUrl, undefined);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig CLI overrides env and file', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-ovr-'));
    const prevTarget = process.env.DDL_PUBLISH_TARGET_URL;
    const prevSchema = process.env.DDL_PUBLISH_SCHEMA;
    try {
      process.env.DDL_PUBLISH_TARGET_URL = 'postgresql://env/wins_file';
      process.env.DDL_PUBLISH_SCHEMA = 'from_env';
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({
          targetUrl: 'postgresql://file/target',
          scratchUrl: 'postgresql://file/scratch',
          schema: 'from_file',
        }),
      );
      const cfg = await loadConfig(path.join(tmp, 'ddl-publish.config.json'), {
        targetUrl: 'postgresql://cli/target',
        schema: 'cli_schema',
      });
      assert.equal(cfg.targetUrl, 'postgresql://cli/target');
      assert.equal(cfg.schema, 'cli_schema');
    } finally {
      if (prevTarget === undefined) delete process.env.DDL_PUBLISH_TARGET_URL;
      else process.env.DDL_PUBLISH_TARGET_URL = prevTarget;
      if (prevSchema === undefined) delete process.env.DDL_PUBLISH_SCHEMA;
      else process.env.DDL_PUBLISH_SCHEMA = prevSchema;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig uses DDL_PUBLISH_OUTPUT and defaults schema to public', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-env-out-'));
    const prev = process.env.DDL_PUBLISH_OUTPUT;
    try {
      process.env.DDL_PUBLISH_OUTPUT = path.join(tmp, 'from-env.sql');
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
        }),
      );
      const cfg = await loadConfig(path.join(tmp, 'ddl-publish.config.json'), {});
      assert.equal(cfg.schema, 'public');
      assert.equal(cfg.outputFile, path.resolve(path.join(tmp, 'from-env.sql')));
    } finally {
      if (prev === undefined) delete process.env.DDL_PUBLISH_OUTPUT;
      else process.env.DDL_PUBLISH_OUTPUT = prev;
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig ignores non-array excludeDdlGlobs in JSON', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-exc-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          excludeDdlGlobs: 'not-array',
        }),
      );
      const cfg = await loadConfig(path.join(tmp, 'ddl-publish.config.json'), {});
      assert.deepEqual(cfg.excludeDdlGlobs, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig throws when config JSON is invalid', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-badjson-'));
    try {
      await writeFile(path.join(tmp, 'ddl-publish.config.json'), '{', 'utf8');
      await assert.rejects(() => loadConfig(path.join(tmp, 'ddl-publish.config.json'), {}), SyntaxError);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig throws when targetUrl is missing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-notgt-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({ scratchUrl: 'postgresql://localhost/s', schema: 'public' }),
      );
      await assert.rejects(() => loadConfig(path.join(tmp, 'ddl-publish.config.json'), {}), /targetUrl/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig throws when scratchUrl is required but missing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-noscr-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.json'),
        JSON.stringify({ targetUrl: 'postgresql://localhost/t', schema: 'public' }),
      );
      await assert.rejects(() => loadConfig(path.join(tmp, 'ddl-publish.config.json'), {}), /scratchUrl/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('loadConfig falls back to example when user config file is missing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'pg-ddl-publish-warn-'));
    try {
      await writeFile(
        path.join(tmp, 'ddl-publish.config.example.json'),
        JSON.stringify({
          targetUrl: 'postgresql://localhost/t',
          scratchUrl: 'postgresql://localhost/s',
          schema: 'public',
        }),
      );
      const missing = path.join(tmp, 'ddl-publish.config.json');
      const folder = path.join(tmp, 'ddl');
      const cfg = await loadConfig(missing, { folder });
      assert.equal(cfg.targetUrl, 'postgresql://localhost/t');
      assert.equal(cfg.scratchUrl, 'postgresql://localhost/s');
      assert.equal(cfg.folder, path.resolve(folder));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
