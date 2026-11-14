import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('basedom create', () => {
  it('copies the starter and names the package after the directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'basedom-create-'));
    const dest = path.join(root, 'demo');
    try {
      const result = spawnSync(process.execPath, ['scripts/create.mjs', dest], {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr);
      const pkg = JSON.parse(await readFile(path.join(dest, 'package.json'), 'utf8'));
      assert.equal(pkg.name, 'demo');
      const html = await readFile(path.join(dest, 'index.html'), 'utf8');
      assert.match(html, /<title>demo<\/title>/);
      const main = await readFile(path.join(dest, 'main.js'), 'utf8');
      assert.match(main, /from 'basedom'/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
