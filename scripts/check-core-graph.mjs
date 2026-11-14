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
const forbidden = inputs.filter((file) => /(?:^|\/)(router|navigation|fetch|fetch-directives|store|form|graph|hmr-runtime)\.js$/.test(file));
assert.deepEqual(forbidden, [], `screen runtime imported optional modules:\n${forbidden.join('\n')}`);
const devOnly = inputs.filter((file) => /rollup|hmr-runtime|graph\.js/.test(file));
assert.deepEqual(devOnly, [], `screen runtime imported dev-only modules:\n${devOnly.join('\n')}`);
console.log(`core graph ok (${inputs.length} modules)`);
