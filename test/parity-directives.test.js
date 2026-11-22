import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc, defineExpose, emit } from '../sfc.js';
import { mount } from '../components.js';
import { registerComponent } from '../registry.js';
import '../directives-parity.js';

function place(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(view, host);
  return host;
}

describe('directive parity', () => {
  it('updates x-text and sanitizes x-html', () => {
    const [label, setLabel] = signal('Ada');
    const host = place(defineSfc({
      template: '<p id="text" x-text="label"></p><div id="html" x-html="raw"></div>',
      setup: () => ({ label, raw: '<b>Hi</b><img src="x" onerror="1"><script>bad</script>' })
    }));
    assert.equal(host.querySelector('#text').textContent, 'Ada');
    assert.equal(host.querySelector('#html script'), null);
    assert.equal(host.querySelector('#html img').hasAttribute('onerror'), false);
    assert.equal(host.querySelector('#html b').textContent, 'Hi');
    setLabel('Bea');
    assert.equal(host.querySelector('#text').textContent, 'Bea');
    host.remove();
  });

  it('leaves x-pre text uncompiled and removes x-cloak on mount', () => {
    const host = place(defineSfc({
      template: '<p x-pre>{{ name }}</p><span id="c" x-cloak>Shown</span>',
      setup: () => ({ name: 'Ada' })
    }));
    assert.equal(host.querySelector('p').textContent, '{{ name }}');
    assert.equal(host.querySelector('#c').hasAttribute('x-cloak'), false);
    assert.equal(host.querySelector('#c').textContent, 'Shown');
    host.remove();
  });

  it('does not update an x-once binding', () => {
    const [n, setN] = signal(1);
    const host = place(defineSfc({
      template: '<p x-once id="once">{{ n }}</p><p id="live">{{ n }}</p>',
      setup: () => ({ n })
    }));
    assert.equal(host.querySelector('#once').textContent, '1');
    setN(2);
    assert.equal(host.querySelector('#once').textContent, '1');
    assert.equal(host.querySelector('#live').textContent, '2');
    host.remove();
  });

  it('applies .prevent and .enter, and .number on x-model', () => {
    let submitted = 0;
    const [count, setCount] = signal(0);
    const [age, setAge] = signal(null);
    const host = place(defineSfc({
      template: '<form @submit.prevent="send"><input id="age" x-model.number="age"><button type="submit">Go</button></form><input id="key" @keydown.enter="add">',
      setup: () => ({
        age,
        setAge,
        send() { submitted += 1; },
        add() { setCount((value) => value + 1); }
      })
    }));
    const form = host.querySelector('form');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(submitted, 1);
    const ageInput = host.querySelector('#age');
    ageInput.value = '12';
    ageInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(age(), 12);
    const key = host.querySelector('#key');
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    assert.equal(count(), 1);
    host.remove();
  });

  it('iterates numbers and objects, and teleports a node', () => {
    const dock = document.createElement('div');
    dock.id = 'dock';
    document.body.appendChild(dock);
    const host = place(defineSfc({
      template: '<span x-for="n in 3">{{ n }}</span><i x-for="(value, key) in bag">{{ key }}{{ value }}</i><p x-teleport="#dock">Away</p>',
      setup: () => ({ bag: { a: 1 } })
    }));
    assert.equal(host.querySelectorAll('span').length, 3);
    assert.equal(host.querySelector('i').textContent, 'a1');
    assert.equal(dock.textContent, 'Away');
    assert.equal(host.querySelector('p'), null);
    host.remove();
    dock.remove();
  });

  it('applies stop, self, once, ctrl, lazy, trim, and a named model', async () => {
    const [text, setText] = signal('  Ada  ');
    const [title, setTitle] = signal('A');
    let clicks = 0;
    let parentClicks = 0;
    const Child = defineSfc({
      template: '<button type="button" id="child" @click="send">Child</button>',
      setup(props) {
        return { send() { emit('update:title', props.title() + '!'); } };
      }
    });
    await registerComponent('named', Child);
    const host = place(defineSfc({
      template: '<div id="box" @click="parent"><button type="button" id="stop" @click.stop="add">Stop</button></div><input id="lazy" x-model.lazy.trim="text"><button type="button" id="self" @click.self="add">Self</button><button type="button" id="once" @click.once="add">Once</button><input id="key" @keydown.ctrl.enter="add"><named :title="title" x-model:title="title"></named><p id="out">{{ title }}</p>',
      setup: () => ({
        text, setText, title, setTitle,
        add() { clicks += 1; },
        parent() { parentClicks += 1; }
      })
    }));
    host.querySelector('#stop').click();
    assert.equal(clicks, 1);
    assert.equal(parentClicks, 0);
    const lazy = host.querySelector('#lazy');
    lazy.value = '  Bea  ';
    lazy.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(text(), '  Ada  ');
    lazy.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(text(), 'Bea');
    host.querySelector('#once').click();
    host.querySelector('#once').click();
    assert.equal(clicks, 2);
    const key = host.querySelector('#key');
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    assert.equal(clicks, 3);
    host.querySelector('#child').click();
    assert.equal(host.querySelector('#out').textContent, 'A!');
    host.remove();
  });

  it('exposes a component ref and binds a named model', async () => {
    const Child = defineSfc({
      template: '<span id="child">{{ title }}</span>',
      setup(props) {
        defineExpose({ title: props.title });
        return { title: props.title };
      }
    });
    await registerComponent('kid', Child);
    const [title, setTitle] = signal('Ada');
    const host = place(defineSfc({
      template: '<kid x-ref="box" :title="title" x-model:title="title"></kid>',
      setup: () => ({ title, setTitle })
    }));
    assert.equal(host.querySelector('#child').textContent, 'Ada');
    host.remove();
  });
});
