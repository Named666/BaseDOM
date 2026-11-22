import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc } from '../sfc.js';
import { mount } from '../components.js';
import { evaluateExpression } from '../expression.js';
import { startApp } from '../boot.js';
import { defineRoute, resetRoutes } from '../router.js';
import { resetRenderState } from '../render.js';
import { currentRoute, setCurrentRoute } from '../navigation.js';
import '../directives-parity.js';

function place(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(view, host);
  return host;
}

describe('regression against main and master', { concurrency: false }, () => {
  it('renders a nested x-else without also showing the other branch', () => {
    const [show, setShow] = signal(false);
    const host = place(defineSfc({
      template: '<div><b x-if="show">yes</b><i x-else>no</i></div>',
      setup: () => ({ show })
    }));
    assert.equal(host.querySelectorAll('i').length, 1);
    assert.equal(host.querySelectorAll('b').length, 0);
    assert.equal(host.textContent, 'no');
    setShow(true);
    assert.equal(host.querySelectorAll('b').length, 1);
    assert.equal(host.querySelectorAll('i').length, 0);
    assert.equal(host.textContent, 'yes');
    host.remove();
  });

  it('keeps main signal, x-show, x-model, and @click behavior', () => {
    const [count, setCount] = signal(0);
    const [text, setText] = signal('');
    const [open, setOpen] = signal(true);
    const host = place(defineSfc({
      template: '<button type="button" @click="add">Add</button><p id="n">{{ count }}</p><input x-model="text"><p id="show" x-show="open">open</p>',
      setup: () => ({
        count,
        text,
        setText,
        open,
        add() { setCount((value) => value + 1); }
      })
    }));
    host.querySelector('button').click();
    assert.equal(host.querySelector('#n').textContent, '1');
    const input = host.querySelector('input');
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(text(), 'Ada');
    assert.equal(host.querySelector('#show').style.display, '');
    setOpen(false);
    assert.equal(host.querySelector('#show').style.display, 'none');
    host.remove();
  });

  it('evaluates object and array literals for class and style maps', () => {
    const [on, setOn] = signal(true);
    const value = evaluateExpression('{ active: isOn(), big, extra: [1, 2] }', { isOn: () => on(), big: true });
    assert.equal(value.active, true);
    assert.equal(value.big, true);
    assert.deepEqual(value.extra, [1, 2]);
    const host = place(defineSfc({
      template: '<p :class="{ active: isOn(), big }">Hi</p>',
      setup: () => ({ isOn: () => on(), big: true })
    }));
    assert.equal(host.querySelector('p').className, 'active big');
    setOn(false);
    assert.equal(host.querySelector('p').className, 'big');
    host.remove();
  });

  it('startApp renders the current URL into #app and does not set window.signal', async () => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    document.body.innerHTML = '<div id="app"></div><div id="other"></div>';
    history.replaceState({}, '', '/');
    const Home = defineSfc({ template: '<h1>Booted</h1>' });
    defineRoute({ path: '/', component: Home });
    startApp();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(document.querySelector('#app h1').textContent, 'Booted');
    assert.equal(document.querySelector('#other').childElementCount, 0);
    assert.equal(currentRoute(), '/');
    assert.equal(window.signal, undefined);
    assert.equal(window.computed, undefined);
    assert.equal(window.effect, undefined);
  });

  it('startApp waits for DOMContentLoaded while the document is loading', async () => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState({}, '', '/');
    defineRoute({ path: '/', component: defineSfc({ template: '<h1>Late</h1>' }) });
    const descriptor = Object.getOwnPropertyDescriptor(document, 'readyState')
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document), 'readyState');
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    try {
      startApp('#root');
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(document.querySelector('#root h1'), null);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(document.querySelector('#root h1').textContent, 'Late');
    } finally {
      if (descriptor) Object.defineProperty(document, 'readyState', descriptor);
      else delete document.readyState;
    }
  });
});
