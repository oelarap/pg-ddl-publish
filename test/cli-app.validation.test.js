import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { vi, describe, it, beforeEach } from 'vitest';

const loadConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../src/config.js', () => ({
  loadConfig: (...a) => loadConfigMock(...a),
}));

vi.mock('../src/generate.js', () => ({
  generatePublication: vi.fn(),
}));

vi.mock('../src/apply.js', () => ({
  applyPublicationAndPost: vi.fn(),
}));

import { runCli } from '../src/cli-app.js';

const baseCfg = () => ({
  targetUrl: 'postgresql://localhost/t',
  scratchUrl: 'postgresql://localhost/s',
  schema: 'public',
  preScriptDirName: 'pre_script',
  postScriptDirName: 'post_script',
  excludeDdlGlobs: [],
  outputFile: path.join(os.tmpdir(), 'out-cli.sql'),
});

describe('cli-app validation (mocked loadConfig)', () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
  });

  it('generate throws when folder is missing in resolved config', async () => {
    loadConfigMock.mockResolvedValue({ ...baseCfg(), folder: null });
    await assert.rejects(
      runCli(['node', 'cli', 'generate', '-f', path.join(os.tmpdir(), 'any'), '-c', '/x.json']),
      /generate requiere/,
    );
  });

  it('apply throws when folder is missing in resolved config', async () => {
    loadConfigMock.mockResolvedValue({ ...baseCfg(), folder: null });
    await assert.rejects(
      runCli(['node', 'cli', 'apply', '-f', path.join(os.tmpdir(), 'any'), '-p', '/p.sql', '-c', '/x.json']),
      /apply requiere/,
    );
  });

  it('publish throws when folder is missing in resolved config', async () => {
    loadConfigMock.mockResolvedValue({ ...baseCfg(), folder: null });
    await assert.rejects(
      runCli(['node', 'cli', 'publish', '-f', path.join(os.tmpdir(), 'any'), '-c', '/x.json']),
      /publish requiere/,
    );
  });
});
