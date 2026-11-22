import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc } from '../sfc.js';
import { onMount, onCleanup } from '../lifecycle.js';
import { callOnMountRecursive, callOnUnmountRecursive } from '../lifecycle.js';
import { renderComponent, createComponent } from '../components.js';
import { shouldInterceptLink } from '../navigation.js';

function place(element) {
  document.body.appendChild(element);
  callOnMountRecursive(element);
  return element;
}

describe('templates update the real DOM', () => {
  it('updates the same text node and escapes interpolated text', () => {
    const [message, setMessage] = signal('ok');
    const View = defineSfc({
      template: '<p>{{ message }}</p>',
      setup: () => ({ message })
    });
    const el = place(View());
    const text = el.firstChild;
    setMessage('<img src=x onerror=alert(1)>');
    assert.equal(el.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(el.querySelector('img'), null);
    assert.equal(el.firstChild, text);
    callOnUnmountRecursive(el);
    el.remove();
  });

  it('binds events, attributes, show, model, if, and keyed lists without a virtual DOM', () => {
    const [count, setCount] = signal(0);
    const [message, setMessage] = signal('Hello');
    const [items, setItems] = signal(['a', 'b']);
    const View = defineSfc({
      styles: 'p { color: rgb(1, 2, 3); }',
      template: `
        <section>
          <p class="count">{{ count }}</p>
          <button type="button" @click="increment">Add</button>
          <input x-model="message">
          <span class="msg">{{ message }}</span>
          <b x-show="count > 0">shown</b>
          <i x-if="count > 0">yes</i>
          <i x-else>no</i>
          <ul>
            <li x-for="item in items" x-key="item">{{ item }}</li>
          </ul>
        </section>
      `,
      setup: () => ({
        count,
        message,
        items,
        increment: () => setCount((value) => value + 1)
      })
    });
    const el = place(View());
    assert.equal(el.querySelector('.count').textContent, '0');
    assert.equal(el.querySelector('b').style.display, 'none');
    assert.equal(el.querySelectorAll('i')[0].textContent, 'no');
    const second = el.querySelectorAll('li')[1];
    el.querySelector('button').click();
    assert.equal(count(), 1);
    assert.equal(el.querySelector('.count').textContent, '1');
    assert.equal(el.querySelector('b').style.display, '');
    assert.equal(el.querySelectorAll('i')[0].textContent, 'yes');

    const input = el.querySelector('input');
    input.value = 'Hi';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(message(), 'Hi');
    setMessage('Yo');
    assert.equal(input.value, 'Yo');

    setItems(['b', 'a']);
    const lis = [...el.querySelectorAll('li')];
    assert.equal(lis[0], second);
    assert.equal(lis.map((node) => node.textContent).join(','), 'b,a');
    assert.match(document.head.textContent, /\.x-[a-z0-9]+ p/);
    callOnUnmountRecursive(el);
    el.remove();
  });

  it('gives each instance its own state and disposes bindings on unmount', () => {
    const View = defineSfc({
      template: '<button @click="inc">{{ count }}</button>',
      setup() {
        const [count, setCount] = signal(0);
        return { count, inc: () => setCount((value) => value + 1) };
      }
    });
    const a = place(View());
    const b = place(View());
    a.click();
    assert.equal(a.textContent, '1');
    assert.equal(b.textContent, '0');

    let runs = 0;
    const [on, setOn] = signal(true);
    const Gate = defineSfc({
      template: '<p x-if="flag()">x</p>',
      setup: () => ({
        flag() {
          runs += 1;
          return on();
        }
      })
    });
    const gate = place(Gate());
    assert.equal(gate.textContent, 'x');
    const after = runs;
    callOnUnmountRecursive(gate);
    gate.remove();
    setOn(false);
    setOn(true);
    assert.equal(runs, after);
    a.remove();
    b.remove();
  });

  it('runs onMount cleanup when the component unmounts', () => {
    let cleaned = false;
    const View = defineSfc({
      template: '<em>hi</em>',
      setup() {
        onMount(() => onCleanup(() => { cleaned = true; }));
        return {};
      }
    });
    const el = place(View());
    assert.equal(cleaned, false);
    callOnUnmountRecursive(el);
    assert.equal(cleaned, true);
  });

  it('replaces a previous renderComponent effect', () => {
    const [count, setCount] = signal(0);
    const calls = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderComponent(() => {
      calls.push(count());
      return createComponent('p', { children: String(count()) });
    }, host);
    setCount(1);
    assert.deepEqual(calls, [0, 1]);
    renderComponent(() => createComponent('p', { children: 'next' }), host);
    setCount(2);
    assert.deepEqual(calls, [0, 1]);
    assert.equal(host.textContent, 'next');
    host.remove();
  });

  it('intercepts only x-link anchors', () => {
    const local = document.createElement('a');
    local.setAttribute('href', '/about');
    local.setAttribute('x-link', '');
    const plain = document.createElement('a');
    plain.setAttribute('href', '/skip');
    const external = document.createElement('a');
    external.setAttribute('href', 'https://example.com/');
    external.setAttribute('x-link', '');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    assert.equal(shouldInterceptLink(local, event), true);
    assert.equal(shouldInterceptLink(plain, event), false);
    assert.equal(shouldInterceptLink(external, event), false);
  });
});
