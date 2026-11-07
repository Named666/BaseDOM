import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc } from '../sfc.js';
import { mount } from '../components.js';
import { setStyleNonce } from '../components.js';
import { createForm } from '../form.js';
import { onMount, onCleanup, callOnUnmountRecursive } from '../lifecycle.js';
import { shouldInterceptLink } from '../navigation.js';
import { evaluateExpression } from '../expression.js';

function place(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(view, host);
  return host;
}

describe('native x-model', () => {
  it('binds text, checkbox, radio, select, and number inputs', () => {
    const [name, setName] = signal('Ada');
    const [agree, setAgree] = signal(false);
    const [plan, setPlan] = signal('free');
    const [topic, setTopic] = signal('bug');
    const [seats, setSeats] = signal(2);
    const View = defineSfc({
      template: `
        <form>
          <input id="name" x-model="name">
          <input id="agree" type="checkbox" x-model="agree">
          <input type="radio" name="plan" value="free" x-model="plan">
          <input type="radio" name="plan" value="pro" x-model="plan">
          <select id="topic" x-model="topic"><option value="hello">Hello</option><option value="bug">Bug</option></select>
          <input id="seats" type="number" x-model="seats">
        </form>
      `,
      setup: () => ({ name, setName, agree, setAgree, plan, setPlan, topic, setTopic, seats, setSeats })
    });
    const host = place(View);
    const form = host.querySelector('form');
    assert.equal(form.querySelector('#name').value, 'Ada');
    form.querySelector('#name').value = 'Grace';
    form.querySelector('#name').dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(name(), 'Grace');

    const box = form.querySelector('#agree');
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(agree(), true);

    const pro = form.querySelector('input[value="pro"]');
    pro.checked = true;
    pro.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(plan(), 'pro');
    assert.equal(form.querySelector('input[value="free"]').checked, false);

    const select = form.querySelector('#topic');
    assert.equal(select.value, 'bug');
    select.value = 'hello';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(topic(), 'hello');

    const seatsInput = form.querySelector('#seats');
    assert.equal(seatsInput.value, '2');
    seatsInput.value = '4';
    seatsInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(seats(), 4);
    seatsInput.value = '';
    seatsInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(seats(), null);
    host.remove();
  });

  it('keeps focus on the same keyed row input when the list reorders', () => {
    const [items, setItems] = signal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    const View = defineSfc({
      template: `<ul><li x-for="item in items" x-key="item.id"><input class="row"></li></ul>`,
      setup: () => ({ items })
    });
    const host = place(View);
    const second = host.querySelectorAll('input')[1];
    second.focus();
    setItems([{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }]);
    assert.equal(host.querySelector('input'), second);
    assert.equal(document.activeElement, second);
    host.remove();
  });
});

describe('createForm', () => {
  it('reads and writes fields, validates, and reports a rejected submit', async () => {
    const form = createForm({ email: '' });
    form.setValidator('email', [
      (value) => value ? null : 'Email is required',
      (value) => value.includes('@') ? null : 'Invalid email'
    ]);
    assert.equal(form.isValid(), false);
    assert.equal(form.errors().email, 'Email is required');
    form.fields.email('ada');
    assert.equal(form.fields.email(), 'ada');
    assert.equal(form.errors().email, 'Invalid email');
    form.fields.email('ada@example.com');
    assert.equal(form.isValid(), true);
    let submitted = null;
    await form.handleSubmit(async (values) => { submitted = values; throw new Error('nope'); })({ preventDefault() {} });
    assert.deepEqual(submitted, { email: 'ada@example.com' });
    assert.equal(form.submitError(), 'nope');
    assert.equal(form.isSubmitting(), false);
    form.reset();
    assert.equal(form.fields.email(), '');
    form.dispose();
  });
});

describe('lifecycle after teardown', () => {
  it('drops a late async write after unmount', async () => {
    let publish = () => {};
    const View = defineSfc({
      template: '<p>{{ text }}</p>',
      setup() {
        const [text, setText] = signal('start');
        onMount(() => {
          let active = true;
          onCleanup(() => { active = false; });
          publish = (value) => { if (active) setText(value); };
        });
        return { text };
      }
    });
    const host = place(View);
    assert.equal(host.textContent, 'start');
    callOnUnmountRecursive(host.firstElementChild);
    host.replaceChildren();
    publish('late');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(host.textContent, '');
    assert.equal(document.body.textContent.includes('late'), false);
  });
});

describe('developer errors and links', () => {
  it('reports a failed expression instead of succeeding quietly', () => {
    const messages = [];
    const original = console.error;
    console.error = (...args) => { messages.push(args.map(String).join(' ')); };
    try {
      const value = evaluateExpression('nope(', {}, {});
      assert.equal(value, undefined);
    } finally {
      console.error = original;
    }
    assert.match(messages.join('\n'), /expression failed: nope\(/);
  });

  it('does not intercept modified clicks, new tabs, or downloads', () => {
    const link = document.createElement('a');
    link.setAttribute('href', '/about');
    link.setAttribute('x-link', '');
    const base = { bubbles: true, cancelable: true, button: 0 };
    assert.equal(shouldInterceptLink(link, new MouseEvent('click', { ...base, metaKey: true })), false);
    link.setAttribute('target', '_blank');
    assert.equal(shouldInterceptLink(link, new MouseEvent('click', base)), false);
    link.removeAttribute('target');
    link.setAttribute('download', '');
    assert.equal(shouldInterceptLink(link, new MouseEvent('click', base)), false);
  });

  it('copies a CSP nonce onto scoped style tags', () => {
    setStyleNonce('browser-test');
    const View = defineSfc({
      template: '<p class="nonce-target">Hi</p>',
      styles: '.nonce-target { color: rgb(1, 2, 3); }'
    });
    const host = place(View);
    const tag = [...document.head.querySelectorAll('style')].find((node) => node.textContent.includes('nonce-target'));
    assert.ok(tag);
    assert.equal(tag.getAttribute('nonce'), 'browser-test');
    host.remove();
    setStyleNonce('');
  });
});
