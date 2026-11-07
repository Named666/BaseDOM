import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const result = await esbuild.build({
  entryPoints: ['sfc.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  metafile: true
});

const inputs = Object.keys(result.metafile.inputs);
const forbidden = inputs.filter((file) => /(?:^|\/)(router|navigation|fetch|fetch-directives|store|form)\.js$/.test(file));
assert.deepEqual(forbidden, [], `screen runtime imported optional modules:\n${forbidden.join('\n')}`);
console.log(`core graph ok (${inputs.length} modules)`);
