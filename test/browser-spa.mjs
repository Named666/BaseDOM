import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nonce = 'browser-test';

function commandExists(bin) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  return paths.some((dir) => fs.existsSync(path.join(dir, bin)));
}

const browser = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(commandExists);
if (!browser) {
  console.error('No Chrome or Chromium binary on PATH');
  process.exit(1);
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
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
    if (file.endsWith(`${path.sep}examples${path.sep}spa${path.sep}index.html`)) {
      body = Buffer.from(data.toString('utf8').replace('name="csp-nonce" content=""', `name="csp-nonce" content="${nonce}"`));
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
  `--user-data-dir=/tmp/basedom-browser-${port}`,
  `--remote-debugging-port=${port + 1}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let version;
for (let i = 0; i < 40; i += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port + 1}/json/version`);
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch { /* chrome still starting */ }
  await sleep(100);
}
if (!version) {
  chrome.kill();
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
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/examples/spa/` });
  await loaded;
  await sleep(400);
  const evalInPage = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const home = await evalInPage(`document.querySelector('h1')?.textContent`);
  if (home !== 'Home') throw new Error(`Expected Home under script-src 'self', got ${home}`);
  await evalInPage(`document.querySelector('a[href="#/contact"]').click()`);
  await sleep(250);
  const contact = await evalInPage(`({
    h1: document.querySelector('h1')?.textContent,
    focused: document.activeElement?.textContent,
    font: getComputedStyle(document.querySelector('header')).fontFamily
  })`);
  if (contact.h1 !== 'Contact') throw new Error(`Expected Contact, got ${contact.h1}`);
  if (contact.focused !== 'Contact') throw new Error(`Expected heading focus, got ${contact.focused}`);
  if (!String(contact.font).toLowerCase().includes('sans-serif') && !/arial|helvetica/i.test(contact.font)) {
    throw new Error(`Scoped CSS did not apply under the style nonce. font=${contact.font}. Browsers hide nonce attributes after insertion, so application of the stylesheet is the check.`);
  }
  await evalInPage(`{
    document.querySelector('#contact-name').value = '';
    document.querySelector('#contact-name').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
  }`);
  await sleep(50);
  const error = await evalInPage(`document.querySelector('.error')?.textContent`);
  if (error !== 'Name is required.') throw new Error(`Expected validation error, got ${error}`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync('/opt/cursor/artifacts/basedom-contact.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ home, contact, error }));
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
