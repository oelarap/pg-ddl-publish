import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { buildProdReleaseOutputPath } from '../src/release-path.js';

describe('release-path', () => {
  it('buildProdReleaseOutputPath is under folder/release and matches timestamp pattern', () => {
    const base = path.join(os.tmpdir(), 'pg-ddl-publish-release-test');
    const out = buildProdReleaseOutputPath(base);
    assert.ok(out.startsWith(path.join(base, 'release') + path.sep));
    assert.match(
      path.basename(out),
      /^release_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_\d{2}\.sql$/,
    );
  });
});
