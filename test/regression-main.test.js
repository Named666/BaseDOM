import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc } from '../sfc.js';
import { mount } from '../components.js';
import { evaluateExpression } from '../expression.js';
import '../directives-parity.js';

function place(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(view, host);
  return host;
}

describe('regression against main and master', () => {
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
});
