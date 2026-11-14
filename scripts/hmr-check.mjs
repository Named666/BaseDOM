// Real Vite dev server check. Run with plain node, not the jsdom test loader.
// A template edit should update the mounted heading without a full page reload.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
await cp(path.join(root, 'examples/vite-counter'), dir, { recursive: true });
await rm(path.join(dir, 'vite.config.js'), { force: true });
const server = await createServer({
  configFile: false,
  root: dir,
  plugins: [basedom()],
  resolve: { alias: { basedom: root } },
  server: { host: '127.0.0.1', watch: { usePolling: true, interval: 50 } },
  logLevel: 'error'
});
await server.listen();
const port = server.config.server.port;
const chrome = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
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
      if (response.ok) {
        version = await response.json();
        break;
      }
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
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
      const timer = setTimeout(() => reject(new Error(`Chrome DevTools timed out: ${method}`)), 3000);
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
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  let before = '';
  for (let i = 0; i < 20; i += 1) {
    await sleep(100);
    before = await evalInPage(`document.querySelector('h1')?.textContent || ''`);
    if (before) break;
  }
  if (before !== 'BaseDOM counter') throw new Error(`Expected the counter title, got ${before}`);
  await evalInPage('window.__hmrMark = 1');
  const file = path.join(dir, 'Counter.html');
  const html = await readFile(file, 'utf8');
  await writeFile(file, html.replace('BaseDOM counter', 'BaseDOM updated'));
  let after = before;
  let mark = 0;
  for (let i = 0; i < 20; i += 1) {
    await sleep(150);
    after = await evalInPage(`document.querySelector('h1')?.textContent`);
    mark = await evalInPage('window.__hmrMark || 0');
    if (after === 'BaseDOM updated') break;
  }
  if (after !== 'BaseDOM updated') throw new Error(`HMR did not update the heading, got ${after}`);
  if (mark !== 1) throw new Error('The page fully reloaded instead of applying the module update');
  console.log('hmr ok');
  ws.close();
} finally {
  chrome.kill();
  await server.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await rm(`/tmp/basedom-chrome-${port}`, { recursive: true, force: true }).catch(() => {});
}
