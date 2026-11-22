// Real Vite dev-server checks for HMR. Run with plain node, not the jsdom loader.
// Signal state survives template and script edits. Style edits do not rerun setup.
// A compile error uses Vite's overlay and the next good save recovers in place.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import basedom from '../vite/plugin.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function commandExists(bin) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => existsSync(path.join(dir, bin)));
}

const browser = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(commandExists);
if (!browser) {
  console.log('skip: no chrome');
  process.exit(0);
}

const dir = await mkdtemp(path.join(tmpdir(), 'basedom-hmr-'));
const files = {
  'index.html': `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>HMR</title></head>
<body><div id="app"></div><script type="module" src="/main.js"></script></body></html>
`,
  'logic.js': 'export const step = 1;\n',
  'Counter.html': `<template>
  <section class="counter">
    <h1 class="title">{{ title }}</h1>
    <p class="count">{{ count }}</p>
    <button type="button" class="inc" @click="increment">Add</button>
  </section>
</template>
<script setup>
import { signal, effect } from 'basedom/state.js';
import { step } from './logic.js';
const title = 'Counter';
const [count, setCount] = signal(0);
function increment() { setCount((value) => value + step); }
window.__setups = (window.__setups || 0) + 1;
effect(() => { count(); window.__effectBinds = (window.__effectBinds || 0) + 1; });
</script>
<style>
.count { color: rgb(0, 0, 255); }
</style>
`,
  'Nest.html': `<template>
  <div class="nest">
    <counter></counter>
    <div class="list">
      <counter x-for="item in items" x-key="item"></counter>
    </div>
  </div>
</template>
<script setup>
const items = ['a', 'b'];
</script>
`,
  'Layout.html': `<template>
  <div>
    <header>App</header>
    <a href="#/lazy" x-link>Lazy</a>
    <main x-outlet></main>
  </div>
</template>
`,
  'Lazy.html': `<template>
  <section><h1 class="lazy-title">Lazy</h1><p class="lazy-count">{{ count }}</p><button type="button" class="lazy-inc" @click="increment">Add</button></section>
</template>
<script setup>
import { signal } from 'basedom/state.js';
const [count, setCount] = signal(0);
function increment() { setCount((value) => value + 1); }
</script>
`,
  'routes.js': `import { defineRoute, lazy } from 'basedom/router.js';
import Layout from './Layout.html';
import Nest from './Nest.html';
defineRoute({
  path: '/',
  component: Layout,
  children: [
    { path: '', component: Nest, meta: { title: 'Home' } },
    { path: 'lazy', component: lazy(() => import('./Lazy.html')), meta: { title: 'Lazy' } }
  ]
});
`,
  'main.js': `import './routes.js';
import Counter from './Counter.html';
import { registerComponent } from 'basedom/registry.js';
import { initialize } from 'basedom/render.js';
import { startRouter } from 'basedom/router.js';
import { navigate } from 'basedom/navigation.js';
await registerComponent('counter', Counter);
initialize('#app');
startRouter({ mode: 'hash' });
await navigate(location.hash || '/');
`
};

for (const [name, text] of Object.entries(files)) {
  await writeFile(path.join(dir, name), text);
}

const server = await createServer({
  configFile: false,
  root: dir,
  plugins: [basedom()],
  resolve: { alias: { basedom: root } },
  server: { host: '127.0.0.1', watch: { usePolling: true, interval: 40 } },
  logLevel: 'error'
});
await server.listen();
const port = server.config.server.port;
const chrome = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=/tmp/basedom-chrome-${port}`,
  `--remote-debugging-port=${port + 1}`,
  'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let version;
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port + 1}/json/version`, { signal: AbortSignal.timeout(400) });
      if (response.ok) { version = await response.json(); break; }
    } catch { /* chrome still starting */ }
    await sleep(80);
  }
  if (!version) throw new Error('Chrome DevTools did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port + 1}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools socket did not open')), 3000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
  });
  const pageLogs = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') pageLogs.push(JSON.stringify(message.params.exceptionDetails).slice(0, 500));
    if (message.method === 'Runtime.consoleAPICalled') {
      pageLogs.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' ').slice(0, 300));
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chrome DevTools timed out: ${method}`)), 4000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const evalInPage = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
    return result.result.value;
  };
  const page = (expression) => evalInPage(expression);
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  let counts = [];
  for (let i = 0; i < 30; i += 1) {
    await sleep(100);
    counts = await page(`[...document.querySelectorAll('.count')].map((node) => node.textContent)`);
    if (counts && counts.length === 3) break;
  }
  if (!counts || counts.length !== 3) {
    const info = await page(`({ href: location.href, html: document.documentElement.outerHTML.slice(0, 800) })`);
    throw new Error(`Expected 3 counters, got ${JSON.stringify(counts)} ${JSON.stringify(info)} logs=${pageLogs.join(' | ')}`);
  }
  await page('window.__hmrMark = 1');
  await page(`[...document.querySelectorAll('.inc')].forEach((button, index) => { for (let n = 0; n < index + 1; n += 1) button.click(); })`);
  await sleep(50);
  const before = await page(`({
    counts: [...document.querySelectorAll('.count')].map((node) => node.textContent),
    setups: window.__setups,
    binds: window.__effectBinds,
    title: document.querySelector('.title')?.textContent
  })`);
  if (before.counts.join(',') !== '1,2,3') throw new Error(`Unexpected counts ${before.counts}`);
  if (before.setups !== 3) throw new Error(`Setup ran ${before.setups} times`);

  const counterPath = path.join(dir, 'Counter.html');
  let counter = files['Counter.html'];
  const writeCounter = async (next) => {
    counter = next;
    await writeFile(counterPath, next);
  };
  const waitFor = async (read, expected, label) => {
    let last;
    for (let i = 0; i < 25; i += 1) {
      await sleep(120);
      last = await read();
      if (last === expected || (Array.isArray(expected) && JSON.stringify(last) === JSON.stringify(expected))) return last;
    }
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)} logs=${pageLogs.join(' | ')}`);
  };

  await writeCounter(counter.replace('>{{ title }}<', '>Edited {{ title }}<'));
  await waitFor(async () => page(`document.querySelector('.title')?.textContent`), 'Edited Counter', 'template edit');
  const afterTemplate = await page(`({
    counts: [...document.querySelectorAll('.count')].map((node) => node.textContent),
    setups: window.__setups,
    mark: window.__hmrMark || 0
  })`);
  if (afterTemplate.counts.join(',') !== '1,2,3') throw new Error(`Template edit reset counts ${afterTemplate.counts}`);
  if (afterTemplate.setups !== 3) throw new Error(`Template edit reran setup (${afterTemplate.setups})`);
  if (afterTemplate.mark !== 1) throw new Error('Template edit fully reloaded the page');

  for (let n = 1; n <= 5; n += 1) {
    await writeCounter(counter.replace(/Edited( \d+)? \{\{ title \}\}/, `Edited ${n} {{ title }}`));
    await waitFor(async () => page(`document.querySelector('.title')?.textContent`), `Edited ${n} Counter`, `edit ${n}`);
  }
  const bindsBeforeClick = await page('window.__effectBinds');
  await page(`document.querySelector('.inc').click()`);
  await sleep(40);
  const afterClicks = await page(`({
    first: document.querySelector('.count')?.textContent,
    setups: window.__setups,
    binds: window.__effectBinds,
    mark: window.__hmrMark || 0
  })`);
  if (afterClicks.first !== '2') throw new Error(`Duplicate listeners or lost state, first count is ${afterClicks.first}`);
  if (afterClicks.setups !== 3) throw new Error(`Five edits reran setup (${afterClicks.setups})`);
  if (afterClicks.binds !== bindsBeforeClick + 1) throw new Error(`Effects duplicated: ${bindsBeforeClick} -> ${afterClicks.binds}`);
  if (afterClicks.mark !== 1) throw new Error('Edits fully reloaded the page');

  await writeCounter(counter.replace('rgb(0, 0, 255)', 'rgb(0, 128, 0)'));
  await waitFor(
    async () => page(`getComputedStyle(document.querySelector('.count')).color`),
    'rgb(0, 128, 0)',
    'style edit'
  );
  const afterStyle = await page(`({ setups: window.__setups, count: document.querySelector('.count')?.textContent, mark: window.__hmrMark || 0 })`);
  if (afterStyle.setups !== 3 || afterStyle.count !== '2' || afterStyle.mark !== 1) {
    throw new Error(`Style edit disturbed state ${JSON.stringify(afterStyle)}`);
  }

  const depsBefore = await page('window.__BASEDOM_DEP__ || 0');
  await writeFile(path.join(dir, 'logic.js'), 'export const step = 2;\n');
  await waitFor(async () => page('window.__BASEDOM_DEP__ || 0'), depsBefore + 1, 'imported module');
  await page(`document.querySelectorAll('.inc')[1].click()`);
  await sleep(40);
  const afterDep = await page(`({
    count: document.querySelectorAll('.count')[1]?.textContent,
    setups: window.__setups,
    mark: window.__hmrMark || 0
  })`);
  if (afterDep.count !== '4') throw new Error(`Imported module edit did not preserve state or pick up the new binding (${afterDep.count}, step=${await page('window.__STEP__')})`);
  if (afterDep.mark !== 1) throw new Error(`Imported module edit reloaded the page ${JSON.stringify(afterDep)}`);

  await writeCounter(counter.replace("const title = 'Counter';", "const title = 'Saved';"));
  await waitFor(async () => page(`document.querySelector('.title')?.textContent`), 'Edited 5 Saved', 'script edit');
  const afterScript = await page(`({
    counts: [...document.querySelectorAll('.count')].map((node) => node.textContent),
    mark: window.__hmrMark || 0
  })`);
  if (afterScript.counts.join(',') !== '2,4,3') throw new Error(`Script edit dropped signal state ${afterScript.counts}`);
  if (afterScript.mark !== 1) throw new Error('Script edit fully reloaded the page');

  await page(`window.__notes = []; const orig = console.info; console.info = (...args) => { window.__notes.push(args.join(' ')); orig.apply(console, args); };`);
  await writeCounter(counter.replace(
    'const [count, setCount] = signal(0);',
    'const [count, setCount] = signal(0);\nconst [extra, setExtra] = signal(1);'
  ));
  await sleep(400);
  const note = await page(`(window.__notes || []).join('\\n')`);
  if (!String(note).includes('BD1020')) throw new Error(`Expected a shape-change note, got ${note}`);
  if ((await page('window.__hmrMark || 0')) !== 1) throw new Error('Shape change fully reloaded the page');

  await writeCounter(counter.replace('const [extra, setExtra] = signal(1);', 'const [extra, setExtra] = signal(;'));
  await waitFor(async () => page(`document.querySelector('vite-error-overlay') ? 'overlay' : ''`), 'overlay', 'compile error');
  const duringError = await page(`({
    mark: window.__hmrMark || 0,
    text: (document.querySelector('vite-error-overlay')?.shadowRoot?.textContent || '') + document.body.innerText
  })`);
  if (duringError.mark !== 1) throw new Error('Compile error reloaded the page');
  if (!duringError.text.includes('BD1021')) throw new Error('Error overlay did not show BD1021');
  const overlayShot = await send('Page.captureScreenshot', { format: 'png' });
  await mkdir('/opt/cursor/artifacts', { recursive: true });
  await writeFile('/opt/cursor/artifacts/basedom-hmr-error.png', Buffer.from(overlayShot.data, 'base64'));

  await writeCounter(counter.replace('const [extra, setExtra] = signal(;', "const [extra, setExtra] = signal(1);\n").replace('Edited 5 {{ title }}', 'Recovered {{ title }}'));
  await waitFor(async () => page(`document.querySelector('.title')?.textContent`), 'Recovered Saved', 'recovery');
  const recovered = await page(`({
    overlay: !!document.querySelector('vite-error-overlay'),
    mark: window.__hmrMark || 0
  })`);
  if (recovered.overlay) throw new Error('Error overlay stayed after a good save');
  const recoveredShot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile('/opt/cursor/artifacts/basedom-hmr-recovered.png', Buffer.from(recoveredShot.data, 'base64'));
  if (recovered.mark !== 1) throw new Error('Recovery fully reloaded the page');

  await page(`document.querySelector('a[href="#/lazy"]').click()`);
  await waitFor(async () => page(`document.querySelector('.lazy-count')?.textContent || ''`), '0', 'lazy screen');
  await page(`document.querySelector('.lazy-inc').click()`);
  await writeFile(path.join(dir, 'Lazy.html'), files['Lazy.html'].replace('>Lazy<', '>Lazy screen<'));
  await waitFor(async () => page(`document.querySelector('.lazy-title')?.textContent`), 'Lazy screen', 'lazy edit');
  const lazyState = await page(`({ count: document.querySelector('.lazy-count')?.textContent, mark: window.__hmrMark || 0 })`);
  if (lazyState.count !== '1' || lazyState.mark !== 1) throw new Error(`Lazy screen lost state ${JSON.stringify(lazyState)}`);

  await writeFile(path.join(dir, 'routes.js'), files['routes.js'].replace("title: 'Lazy'", "title: 'Later'"));
  await waitFor(async () => page('document.title'), 'Later', 'route table');
  if ((await page('window.__hmrMark || 0')) !== 1) throw new Error('Route edit fully reloaded the page');

  const graph = await (await fetch(`http://127.0.0.1:${port}/__basedom/graph`)).json();
  const counterGraph = (graph.components || []).find((item) => item.name === 'Counter');
  if (!counterGraph) throw new Error('Dev graph endpoint did not list Counter');
  if (!counterGraph.signals.some((item) => item.name === 'count')) throw new Error('Dev graph missed the count signal');
  const lazyRoute = JSON.stringify(graph.routes);
  if (!lazyRoute.includes('Lazy.html')) throw new Error('Dev graph missed the lazy route');

  console.log('hmr ok');
  ws.close();
} finally {
  chrome.kill();
  await server.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await rm(`/tmp/basedom-chrome-${port}`, { recursive: true, force: true }).catch(() => {});
}
