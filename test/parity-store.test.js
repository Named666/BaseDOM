import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOwner, effect, ownedTimeout, runWithOwner } from '../state.js';
import { createStore, produce, readonly } from '../store.js';
import { createResource } from '../resource.js';
import { Show, For, Suspense } from '../control.js';
import { signal } from '../state.js';
import { defineRoute, resetRoutes } from '../router.js';
import { setRouteStatusText } from '../render.js';
import { markActiveLinks, saveScroll, restoreScroll } from '../navigation.js';

describe('store and helpers', () => {
  it('tracks a nested path without notifying an unrelated path', () => {
    const [state, setState] = createStore({ user: { name: 'Ada' }, count: 1 });
    let names = 0;
    let counts = 0;
    const stopName = effect(() => { state.user.name; names += 1; });
    const stopCount = effect(() => { state.count; counts += 1; });
    assert.equal(names, 1);
    assert.equal(counts, 1);
    setState(['user', 'name'], 'Bea');
    assert.equal(state.user.name, 'Bea');
    assert.equal(names, 2);
    assert.equal(counts, 1);
    setState(['count'], 2);
    assert.equal(counts, 2);
    assert.equal(names, 2);
    const locked = readonly(state);
    locked.count = 9;
    assert.equal(state.count, 2);
    produce(state, (draft) => { draft.user.name = 'Cleo'; });
    assert.equal(state.user.name, 'Cleo');
    assert.ok(names > 2);
    stopName();
    stopCount();
  });

  it('shows, lists, and suspends', async () => {
    const [open, setOpen] = signal(false);
    const shown = Show({ when: open, children: () => document.createTextNode('yes'), fallback: () => document.createTextNode('no') });
    document.body.appendChild(shown);
    assert.equal(shown.textContent, 'no');
    setOpen(true);
    assert.equal(shown.textContent, 'yes');
    const [items, setItems] = signal(['a']);
    const list = For({ each: items, children: (item) => document.createTextNode(item) });
    document.body.appendChild(list);
    assert.equal(list.textContent, 'a');
    setItems(['a', 'b']);
    assert.equal(list.textContent, 'ab');
    const [loading, setLoading] = signal(true);
    const resource = Object.assign(() => 'data', { loading });
    const suspense = Suspense({
      resource,
      fallback: () => document.createTextNode('wait'),
      children: () => document.createTextNode(resource())
    });
    document.body.appendChild(suspense);
    assert.equal(suspense.textContent, 'wait');
    setLoading(false);
    assert.equal(suspense.textContent, 'data');
    shown.remove();
    list.remove();
    suspense.remove();
  });

  it('suspends while a resource created in the subtree is loading', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const host = Suspense({
      fallback: () => document.createTextNode('wait'),
      children: () => {
        createResource(() => pending);
        return document.createTextNode('ready');
      }
    });
    document.body.appendChild(host);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(host.textContent, 'wait');
    release('ok');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(host.textContent, 'ready');
    host.remove();
  });

  it('reports a timer error to the boundary', async () => {
    let caught = null;
    const owner = createOwner();
    owner.boundary = (error) => { caught = error; };
    runWithOwner(owner, () => { ownedTimeout(() => { throw new Error('timer'); }, 5); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(caught && caught.message, 'timer');
  });
});

describe('router additions', () => {
  it('stores a redirect on route meta and marks the active link', () => {
    resetRoutes();
    const route = defineRoute({ path: '/old', component: () => document.createElement('p'), redirect: '/new', alias: '/also' });
    assert.equal(route.meta.redirect, '/new');
    setRouteStatusText({ loading: 'Please wait' });
    const link = document.createElement('a');
    link.setAttribute('x-link', '');
    link.setAttribute('href', '/new');
    link.setAttribute('x-exact', '');
    document.body.appendChild(link);
    history.replaceState({}, '', '/new');
    markActiveLinks();
    assert.equal(link.classList.contains('active'), true);
    assert.equal(link.getAttribute('aria-current'), 'page');
    const positions = { x: 0, y: 4 };
    window.scrollTo = (x, y) => { positions.x = x; positions.y = y; };
    saveScroll('/new', 0, 8);
    restoreScroll('/new');
    assert.equal(positions.y, 8);
    link.remove();
  });
});
