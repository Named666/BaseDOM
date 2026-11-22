import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
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
const screenForbidden = screen.filter((file) => /(?:^|\/)(router|navigation|fetch|fetch-directives|directives-parity|store|form|graph|hmr-runtime)\.js$/.test(file));
assert.deepEqual(screenForbidden, [], `screen runtime imported optional modules:\n${screenForbidden.join('\n')}`);
const devOnly = screen.filter((file) => /rollup|hmr-runtime|graph\.js/.test(file));
assert.deepEqual(devOnly, [], `screen runtime imported dev-only modules:\n${devOnly.join('\n')}`);

const entry = await bundle('index.js');
assert.deepEqual(forbiddenImports(entry), [], 'package entry imported the fetch layer');

const counterSources = ['examples/vite-counter/main.js', 'examples/vite-counter/Counter.html']
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
assert.equal(/fetch-directives|directives-parity|basedom\/fetch|x-get|x-post/.test(counterSources), false, 'counter example imports an optional layer');

const built = spawnSync('npx', ['vite', 'build', '--config', 'examples/vite-counter/vite.config.js'], {
  encoding: 'utf8'
});
assert.equal(built.status, 0, built.stderr || built.stdout);
const asset = fs.readdirSync('dist/vite-counter/assets').find((file) => /^index-.*\.js$/.test(file));
const counterBytes = fs.readFileSync(`dist/vite-counter/assets/${asset}`);
const counterGzip = gzipSync(counterBytes).length;
assert.equal(counterBytes.includes('fetchAndSwap'), false, 'counter contains the fetch implementation');
assert.equal(counterBytes.includes('Failed to set initial currentRoute'), false, 'counter contains startApp');
assert.equal(counterBytes.includes('hasAttribute("x-teleport")'), false, 'counter contains optional directives');
assert.ok(counterGzip < 13000, `counter gzip ${counterGzip} exceeds 13 kB`);
console.log(`core graph ok (${screen.length} modules), counter ${counterBytes.length} bytes, gzip ${counterGzip}`);
