import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { compileSfcToModule } from '../sfc-compile.js';
import { analyzeRoutes, analyzeSfc } from '../graph.js';
import { build, createServer } from 'vite';
import basedom from '../vite/plugin.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('app graph and HMR compile', () => {
  it('describes props, emits, slots, models, and routes from the compiler scan', () => {
    const source = `<template>
      <section>
        <p>{{ title }}</p>
        <input x-model="name">
        <slot></slot>
        <slot name="extra"></slot>
        <kid :count="count" @save="onSave"></kid>
      </section>
    </template>
    <script setup>
    import { signal } from './state.js';
    const props = defineProps({ title: { required: true }, name: { default: '' } });
    const [count, setCount] = signal(0);
    function onSave() { emit('save', props.title()); }
    </script>`;
    const described = analyzeSfc(source, 'screens/home.html');
    assert.equal(described.name, 'home');
    assert.deepEqual(described.props.map((item) => item.name), ['title', 'name']);
    assert.deepEqual(described.emits.map((item) => item.name), ['save']);
    assert.deepEqual(described.slots.map((item) => item.name), ['default', 'extra']);
    assert.deepEqual(described.models.map((item) => item.expression), ['name']);
    assert.equal(described.uses[0].props[0].name, 'count');
    assert.equal(described.uses[0].events[0].name, 'save');
    const routes = analyzeRoutes(`
      defineRoute({
        path: '/',
        component: layout,
        children: [
          { path: 'notes', component: lazy(() => loadComponent('./notes.html')), load: () => ({}) }
        ]
      });
    `, 'app.js');
    assert.equal(routes[0].path.value, '/');
    assert.equal(routes[0].children[0].path.value, 'notes');
    assert.equal(routes[0].children[0].component.lazy, true);
    assert.equal(routes[0].children[0].load.present, true);
  });

  it('compiles an accept handler that falls back to a full reload', () => {
    const code = compileSfcToModule('<template><p>{{ n }}</p></template><script setup>const n = 1;</script>', 'One.html');
    assert.match(code, /import\.meta\.hot\.accept/);
    assert.match(code, /import\.meta\.hot\.invalidate/);
    assert.match(code, /createHotComponent/);
    assert.doesNotMatch(code, /new Function/);
    const production = compileSfcToModule('<template><p>{{ n }}</p></template><script setup>const n = 1;</script>', 'One.html', { hmr: false });
    assert.doesNotMatch(production, /import\.meta\.hot/);
    assert.doesNotMatch(production, /hmr-runtime/);
  });

  it('serves the compiled module from a Vite dev server and emits the graph on build', async () => {
    const server = await createServer({
      root: path.join(root, 'examples/vite-counter'),
      plugins: [basedom()],
      resolve: { alias: { basedom: root } },
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'error'
    });
    try {
      const result = await server.transformRequest('/Counter.html');
      assert.match(result.code, /import\.meta\.hot\.accept/);
      assert.match(result.code, /defineSfc/);
    } finally {
      await server.close();
    }

    const outDir = await mkdtemp(path.join(tmpdir(), 'basedom-graph-'));
    try {
      await build({
        root: path.join(root, 'examples/vite-counter'),
        plugins: [basedom()],
        resolve: { alias: { basedom: root } },
        logLevel: 'error',
        build: { outDir, emptyOutDir: true }
      });
      const graph = JSON.parse(await readFile(path.join(outDir, 'basedom-graph.json'), 'utf8'));
      const screen = graph.components.find((item) => item.name === 'Counter');
      assert.ok(screen);
      assert.deepEqual(screen.models.map((item) => item.expression), ['message']);
      assert.ok(screen.bindings.includes('increment'));
      assert.ok(screen.signals.some((item) => item.name === 'count'));
      const built = await readFile(path.join(outDir, 'assets', (await import('node:fs')).readdirSync(path.join(outDir, 'assets')).find((name) => name.endsWith('.js'))), 'utf8');
      assert.doesNotMatch(built, /hmr-runtime|createHotComponent|__BASEDOM_HMR_TRACK__|BD1020/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('Vite HMR', { concurrency: false }, () => {
  it('updates a mounted SFC without a full page reload', { timeout: 90000 }, async () => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/hmr-check.mjs')], { stdio: 'inherit' });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
  });
});
