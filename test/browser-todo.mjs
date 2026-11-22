import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4181;
const debugPort = port + 1;

function commandExists(bin) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  return paths.some((dir) => fs.existsSync(path.join(dir, bin)));
}

const browser = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(commandExists);
if (!browser) {
  console.error('No Chrome or Chromium binary on PATH');
  process.exit(1);
}

const vite = spawn('npx', ['vite', '--config', 'examples/todo/vite.config.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
let viteLog = '';
vite.stdout.on('data', (chunk) => { viteLog += chunk; });
vite.stderr.on('data', (chunk) => { viteLog += chunk; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let i = 0; i < 50; i += 1) {
  if (viteLog.includes('Local:')) break;
  await sleep(100);
}
if (!viteLog.includes('Local:')) {
  vite.kill();
  throw new Error(`Vite did not start\n${viteLog}`);
}

const chrome = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--user-data-dir=/tmp/basedom-todo-${port}`,
  `--remote-debugging-port=${debugPort}`,
  'about:blank'
], { stdio: 'ignore', detached: true });

let version;
for (let i = 0; i < 40; i += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(400) });
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch { /* chrome still starting */ }
  await sleep(100);
}
if (!version) {
  chrome.kill();
  vite.kill();
  throw new Error('Chrome DevTools did not start');
}

const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
await new Promise((resolve) => ws.addEventListener('open', resolve));
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const shots = [];
let failed = null;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  const loaded = new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.loadEventFired') {
        ws.removeEventListener('message', onMessage);
        resolve();
      }
    };
    ws.addEventListener('message', onMessage);
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await loaded;
  await sleep(300);

  const evalInPage = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  async function shot(name) {
    const image = await send('Page.captureScreenshot', { format: 'png' });
    const file = `/opt/cursor/artifacts/${name}.png`;
    fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    shots.push(file);
  }

  const text = () => evalInPage('document.body.innerText');
  let body = await text();
  if (!body.includes('Write the list') || !body.includes('Open a todo') || !body.includes('All')) {
    throw new Error(`List did not render:\n${body}\n${viteLog}`);
  }

  await evalInPage(`document.querySelector('button[type=submit]').click()`);
  await sleep(50);
  body = await text();
  if (!body.includes('Title is required.')) throw new Error(`Empty submit did not validate:\n${body}`);
  await shot('basedom-todo-invalid');

  await evalInPage(`
    const input = document.querySelector('input[name=title]');
    input.value = 'Ship it';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
  `);
  await sleep(50);
  body = await text();
  if (!body.includes('Ship it') || body.includes('Title is required.')) {
    throw new Error(`Add did not clear the form:\n${body}`);
  }

  await evalInPage(`document.querySelector('a[href="/active"]').click()`);
  await sleep(100);
  body = await text();
  const heading = await evalInPage(`document.querySelector('h1') && document.querySelector('h1').textContent`);
  if (heading !== 'Active' || !body.includes('Write the list') || body.includes('Open a todo')) {
    throw new Error(`Active filter is wrong (${heading}):\n${body}`);
  }
  await shot('basedom-todo-list');

  const toggled = await evalInPage(`
    const row = [...document.querySelectorAll('article')].find((node) => node.textContent.includes('Write the list'));
    row.querySelector('input[type=checkbox]').click();
    document.body.innerText;
  `);
  await sleep(50);
  if (toggled.includes('Write the list')) throw new Error(`Toggle did not leave the active list:\n${toggled}`);

  await evalInPage(`document.querySelector('a[href="/"]').click()`);
  await sleep(50);
  await evalInPage(`
    const link = [...document.querySelectorAll('a')].find((node) => node.textContent.trim() === 'Open' && node.getAttribute('href') === '/todo/2');
    if (!link) throw new Error('missing detail link');
    link.click();
  `);
  await sleep(120);
  body = await text();
  if (!body.includes('Open a todo') || !body.includes('Done')) {
    throw new Error(`Detail page did not load:\n${body}\n${viteLog}`);
  }
  await shot('basedom-todo-detail');
  console.log('todo ok');
  console.log(shots.join('\n'));
  if (viteLog.includes('BD103')) console.log(viteLog);
} catch (error) {
  failed = error;
  console.error(error);
} finally {
  try { ws.close(); } catch { /* already closed */ }
  try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill(); }
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill(); }
  setTimeout(() => process.exit(failed ? 1 : 0), 50);
}
