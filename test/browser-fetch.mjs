import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nonce = 'browser-test';

function commandExists(bin) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, bin)));
}
const browser = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(commandExists);
if (!browser) {
  console.error('No Chrome or Chromium binary on PATH');
  process.exit(1);
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const routes = {
  '/api/note': { status: 200, body: '<p id="note">Loaded from the server.</p>' },
  '/api/extra': { status: 200, body: '<p class="extra">Another line.</p>' },
  '/api/missing': { status: 503, body: '<script>globalThis.__pwned=1</script><p>nope</p>' },
  '/api/slow-a': { status: 200, body: '<p id="swap">One</p>', delay: 400 },
  '/api/slow-b': { status: 200, body: '<p id="swap">Two</p>' }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/save' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `script-src 'self'; style-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'`
      });
      res.end(`<p id="saved">Saved ${payload.title || ''}</p>`);
    });
    return;
  }
  const api = routes[url.pathname];
  if (api) {
    const send = () => {
      res.writeHead(api.status, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `script-src 'self'; style-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'`
      });
      res.end(api.body);
    };
    if (api.delay) setTimeout(send, api.delay);
    else send();
    return;
  }
  let file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let body = data;
    if (file.endsWith(`${path.sep}examples${path.sep}fetch${path.sep}index.html`) || file.endsWith(`${path.sep}examples${path.sep}directives${path.sep}index.html`)) {
      body = Buffer.from(data.toString('utf8').replace('<head>', `<head><meta name="csp-nonce" content="${nonce}">`));
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'content-security-policy': `script-src 'self'; style-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'`
    });
    res.end(body);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const chrome = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--user-data-dir=/tmp/basedom-fetch-${port}`,
  `--remote-debugging-port=${port + 1}`,
  'about:blank'
], { stdio: 'ignore', detached: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let version;
for (let i = 0; i < 40; i += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port + 1}/json/version`, { signal: AbortSignal.timeout(400) });
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch { /* chrome still starting */ }
  await sleep(100);
}
if (!version) {
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill(); }
  server.close();
  throw new Error('Chrome DevTools did not start');
}

const tabs = await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json();
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

let failed = null;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  const evalInPage = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  async function open(pathname) {
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
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${pathname}` });
    await loaded;
    await sleep(250);
  }

  await open('/examples/fetch/');
  let text = await evalInPage('document.body.innerText');
  if (!text.includes('Nothing loaded yet.')) throw new Error(`Fetch demo did not render:\n${text}`);
  await evalInPage(`document.querySelector('#slow-a').click()`);
  await sleep(40);
  const loading = await evalInPage(`({
    state: document.querySelector('#race').getAttribute('data-fetch-state'),
    busy: document.querySelector('#race').getAttribute('aria-busy'),
    indicator: document.querySelector('#status').classList.contains('x-requesting')
  })`);
  if (loading.state !== 'loading' || loading.busy !== 'true' || !loading.indicator) {
    throw new Error(`loading state failed: ${JSON.stringify(loading)}`);
  }
  await evalInPage(`document.querySelector('#slow-b').click()`);
  await sleep(500);
  const race = await evalInPage(`document.querySelector('#race').innerText`);
  if (race.trim() !== 'Two') throw new Error(`newer request did not win: ${race}`);

  await evalInPage(`document.querySelector('#load').click()`);
  await sleep(150);
  text = await evalInPage('document.body.innerText');
  if (!text.includes('Loaded from the server.') || text.includes('Nothing loaded yet.')) {
    throw new Error(`GET swap failed:\n${text}`);
  }
  await evalInPage(`
    const input = document.querySelector('input[name=title]');
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#save').requestSubmit();
  `);
  await sleep(150);
  text = await evalInPage('document.body.innerText');
  if (!text.includes('Saved Ada')) throw new Error(`POST swap failed:\n${text}`);
  await evalInPage(`document.querySelector('#add').click()`);
  await sleep(100);
  text = await evalInPage('document.body.innerText');
  if (!text.includes('Saved Ada') || !text.includes('Another line.')) throw new Error(`beforeend failed:\n${text}`);
  const image = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync('/opt/cursor/artifacts/basedom-fetch-swap.png', Buffer.from(image.data, 'base64'));
  await evalInPage(`document.querySelector('#bad').click()`);
  await sleep(100);
  const state = await evalInPage(`document.querySelector('#panel').getAttribute('data-fetch-state')`);
  const pwned = await evalInPage('globalThis.__pwned || 0');
  if (state !== 'error' || pwned !== 0) throw new Error(`error state failed: ${state} pwned=${pwned}`);

  await open('/examples/directives/');
  await evalInPage(`document.querySelector('#toggle').click()`);
  await sleep(50);
  const directives = await evalInPage(`({
    className: document.querySelector('#classed').className,
    style: document.querySelector('#painted').getAttribute('style'),
    shown: document.querySelector('#shown').style.display,
    alt: document.querySelector('#alt') && document.querySelector('#alt').textContent,
    pings: document.querySelector('#pings').textContent
  })`);
  if (directives.className !== 'is-on' || !String(directives.style).includes('rgb(0, 128, 0)') || directives.shown === 'none' || directives.alt !== 'Visible') {
    throw new Error(`directive page failed: ${JSON.stringify(directives)}`);
  }
  await evalInPage(`
    const input = document.querySelector('#name');
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#send').click();
  `);
  await sleep(50);
  const after = await evalInPage(`({ echo: document.querySelector('#echo').textContent, pings: document.querySelector('#pings').textContent })`);
  if (after.echo !== 'Ada' || after.pings !== '1') throw new Error(`model or emit failed: ${JSON.stringify(after)}`);
  console.log('fetch and directives ok');
} catch (error) {
  failed = error;
  console.error(error);
} finally {
  try { ws.close(); } catch { /* closed */ }
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill(); }
  server.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 50);
}
