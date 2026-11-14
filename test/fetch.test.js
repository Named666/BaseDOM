import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { signal } from '../state.js';
import { defineSfc } from '../sfc.js';
import { mount, unmount } from '../components.js';
import { analyzeSfc } from '../graph.js';
import { installFetch } from '../fetch-directives.js';

installFetch();

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function ok(html, extra = {}) {
  return { ok: true, status: 200, text: async () => html, ...extra };
}

describe('HTML swap', { concurrency: false }, () => {
  let restore;
  beforeEach(() => {
    restore = globalThis.fetch;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    globalThis.fetch = restore;
    document.body.innerHTML = '';
  });

  it('strips scripts and handlers, then binds the fragment', async () => {
    globalThis.__pwned = 0;
    globalThis.fetch = async () => ok('<script>globalThis.__pwned = 1</script><img src="x" onerror="globalThis.__pwned = 1"><a href="javascript:alert(1)">x</a><p id="note">{{ name }}</p>');
    const el = host();
    const View = defineSfc({
      template: '<button type="button" x-get="/api/note" x-target="#panel">Load</button><div id="panel"></div>',
      setup: () => ({ name: 'Ada' })
    });
    mount(View, el);
    el.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const panel = el.querySelector('#panel');
    assert.equal(panel.querySelector('script'), null);
    assert.equal(panel.querySelector('img').hasAttribute('onerror'), false);
    assert.equal(panel.querySelector('a').hasAttribute('href'), false);
    assert.equal(panel.querySelector('#note').textContent, 'Ada');
    assert.equal(globalThis.__pwned, 0);
    unmount(el);
  });

  it('disposes the previous fragment when a new swap replaces it', async () => {
    const [tick, setTick] = signal(1);
    const replies = [
      '<p id="live">{{ tick }}</p>',
      '<p id="live">done</p>'
    ];
    globalThis.fetch = async () => ok(replies.shift());
    const el = host();
    const View = defineSfc({
      template: '<button type="button" x-get="/api/note" x-target="#panel">Load</button><div id="panel"></div>',
      setup: () => ({ tick })
    });
    mount(View, el);
    el.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = el.querySelector('#live');
    assert.equal(first.textContent, '1');
    setTick(2);
    assert.equal(first.textContent, '2');
    el.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    setTick(3);
    assert.equal(first.textContent, '2');
    assert.equal(el.querySelector('#panel').textContent, 'done');
    unmount(el);
  });

  it('aborts the previous request when the same target is fetched again', async () => {
    let releaseSecond;
    const second = new Promise((resolve) => { releaseSecond = resolve; });
    const seen = [];
    globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
      seen.push(url);
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
      if (seen.length === 1) return;
      second.then(() => resolve(ok('<p id="live">second</p>')));
    });
    const el = host();
    const View = defineSfc({
      template: '<button type="button" id="a" x-get="/api/one" x-target="#panel">A</button><button type="button" id="b" x-get="/api/two" x-target="#panel">B</button><div id="panel"></div>',
      setup: () => ({})
    });
    mount(View, el);
    el.querySelector('#a').click();
    el.querySelector('#b').click();
    releaseSecond();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(el.querySelector('#panel').textContent, 'second');
    assert.equal(seen.length, 2);
    unmount(el);
  });

  it('aborts an in-flight request when the trigger unmounts', async () => {
    let aborted = false;
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
    const el = host();
    const View = defineSfc({
      template: '<button type="button" x-get="/api/slow" x-target="#panel">Go</button><div id="panel"></div>',
      setup: () => ({})
    });
    mount(View, el);
    el.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    unmount(el);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aborted, true);
  });

  it('posts JSON, appends with beforeend, selects a node, and records an error without inserting it', async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      if (String(url).includes('missing')) return { ok: false, status: 503, text: async () => '<script>globalThis.__pwned=1</script>' };
      if (String(url).includes('save')) return ok('<p id="saved">Saved</p>');
      if (String(url).includes('extra')) return ok('<p class="extra">More</p>');
      if (String(url).includes('pick')) return ok('<div><p id="keep">Kept</p><p id="drop">No</p></div>');
      return ok('<p id="side" x-swap-oob="true">Side</p><p id="main">Main</p>');
    };
    const el = host();
    const View = defineSfc({
      template: `
        <p id="side">Old</p>
        <button type="button" id="load" x-get="/api/note" x-target="#panel">Load</button>
        <form id="save" x-post="/api/save" x-target="#panel" x-encoding="json">
          <input name="title" value="Ada">
          <button type="submit">Save</button>
        </form>
        <button type="button" id="add" x-get="/api/extra" x-target="#panel" x-swap="beforeend">Add</button>
        <button type="button" id="pick" x-get="/api/pick" x-target="#picked" x-select="#keep">Pick</button>
        <button type="button" id="bad" x-get="/api/missing" x-target="#panel">Bad</button>
        <div id="panel"></div>
        <div id="picked"></div>
      `,
      setup: () => ({})
    });
    mount(View, el);
    el.querySelector('#load').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(document.querySelector('#side').textContent, 'Side');
    assert.equal(el.querySelector('#main').textContent, 'Main');
    el.querySelector('#save').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const post = calls.find((call) => String(call.url).includes('save'));
    assert.equal(post.method, 'POST');
    assert.equal(JSON.parse(post.body).title, 'Ada');
    assert.equal(el.querySelector('#saved').textContent, 'Saved');
    el.querySelector('#add').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(el.querySelectorAll('.extra').length, 1);
    el.querySelector('#pick').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(el.querySelector('#picked').textContent, 'Kept');
    assert.equal(el.querySelector('#drop'), null);
    el.querySelector('#bad').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(el.querySelector('#panel').getAttribute('data-fetch-state'), 'error');
    assert.equal(el.querySelector('#panel').getAttribute('data-fetch-error'), '503');
    assert.equal(globalThis.__pwned, 0);
    unmount(el);
  });

  it('records fetch directives on the app graph', () => {
    const described = analyzeSfc(`<template>
      <button x-get="/api/note" x-target="#panel" x-swap="beforeend">Load</button>
      <button x-post="{{ url }}">Save</button>
    </template>`, 'panel.html');
    assert.equal(described.fetches[0].method, 'GET');
    assert.equal(described.fetches[0].url, '/api/note');
    assert.equal(described.fetches[0].unresolved, false);
    assert.equal(described.fetches[0].target, '#panel');
    assert.equal(described.fetches[0].swap, 'beforeend');
    assert.equal(described.fetches[1].method, 'POST');
    assert.equal(described.fetches[1].unresolved, true);
    assert.ok(described.fetches[0].loc.line >= 1);
  });
});
