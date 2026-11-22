import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { compileSfcToModule } from '../sfc-compile.js';
import { callOnMountRecursive } from '../lifecycle.js';

describe('Vite SFC compile', () => {
  it('emits a module that imports the authored script and renders real DOM', async () => {
    const stateUrl = new URL('../state.js', import.meta.url).href;
    const source = `<template><p>{{ count }}</p></template>
<script setup>
import { signal } from ${JSON.stringify(stateUrl)};
const [count, setCount] = signal(2);
</script>
<style>p { color: rgb(0, 128, 0); }</style>`;
    const code = compileSfcToModule(source, 'Counter.html', {
      runtimeSpecifier: new URL('../sfc.js', import.meta.url).href
    });
    assert.match(code, /import \{ signal as __basedomSignal \}/);
    assert.doesNotMatch(code, /new Function/);
    assert.doesNotMatch(code, /data:text\/javascript/);
    assert.match(code, /defineSfc/);
    assert.doesNotMatch(code, /registerComponent/);

    const dir = await mkdtemp(path.join(tmpdir(), 'basedom-sfc-'));
    const file = path.join(dir, 'counter.js');
    try {
      await writeFile(file, code);
      const imported = await import(pathToFileURL(file).href);
      const el = imported.default();
      document.body.appendChild(el);
      callOnMountRecursive(el);
      assert.equal(el.textContent, '2');
      assert.equal(el.tagName, 'P');
      el.remove();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lets setup declare props without colliding with the setup argument', () => {
    const code = compileSfcToModule(`<template><p>{{ title }}</p></template>
<script setup>
import { defineProps } from 'basedom';
const props = defineProps({ title: { default: 'Ada' } });
const title = props.title;
</script>`, 'card.html', { runtimeSpecifier: 'basedom/sfc.js', hmr: false });
    assert.match(code, /function __setup\(__props\)/);
    assert.match(code, /const props = defineProps/);
  });

  it('registers an imported .html file under its file name', () => {
    const code = compileSfcToModule(`<template><todo-item></todo-item></template>
<script setup>
import '../components/todo-item.html';
</script>`, 'list.html', { runtimeSpecifier: 'basedom/sfc.js', hmr: false });
    assert.match(code, /import \{ registerComponent \} from "basedom\/registry.js"/);
    assert.match(code, /registerComponent\("todo-item", __bdView0\)/);
  });
});