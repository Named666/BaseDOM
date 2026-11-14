import fs from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true
  });
  return Object.keys(result.metafile.inputs);
}

function forbiddenImports(inputs) {
  return inputs.filter((file) => /(?:^|\/)(fetch|fetch-directives)\.js$/.test(file));
}

const screen = await bundle('sfc.js');
const screenForbidden = screen.filter((file) => /(?:^|\/)(router|navigation|fetch|fetch-directives|store|form|graph|hmr-runtime)\.js$/.test(file));
assert.deepEqual(screenForbidden, [], `screen runtime imported optional modules:\n${screenForbidden.join('\n')}`);
const devOnly = screen.filter((file) => /rollup|hmr-runtime|graph\.js/.test(file));
assert.deepEqual(devOnly, [], `screen runtime imported dev-only modules:\n${devOnly.join('\n')}`);

const entry = await bundle('index.js');
assert.deepEqual(forbiddenImports(entry), [], 'package entry imported the fetch layer');

const counterSources = ['examples/vite-counter/main.js', 'examples/vite-counter/Counter.html']
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
assert.equal(/fetch-directives|basedom\/fetch|x-get|x-post/.test(counterSources), false, 'counter example imports the fetch layer');
console.log(`core graph ok (${screen.length} modules)`);
