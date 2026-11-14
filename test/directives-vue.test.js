import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { defineSfc, emit } from '../sfc.js';
import { mount, createComponent } from '../components.js';
import { registerComponent } from '../registry.js';

function place(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(view, host);
  return host;
}

describe('template directives', () => {
  it('updates class and style bindings, x-show, and x-if', () => {
    const [on, setOn] = signal(false);
    const View = defineSfc({
      template: '<p id="classed" :class="on ? \'is-on\' : \'is-off\'">Class</p><p id="painted" :style="on ? \'color: rgb(0, 128, 0)\' : \'color: rgb(0, 0, 0)\'">Style</p><p id="shown" x-show="on">Shown</p><p id="alt" x-if="on">If</p>',
      setup: () => ({ on })
    });
    const host = place(View);
    const classed = host.querySelector('#classed');
    const painted = host.querySelector('#painted');
    assert.equal(classed.className, 'is-off');
    assert.match(painted.getAttribute('style'), /rgb\(0, 0, 0\)/);
    assert.equal(host.querySelector('#shown').style.display, 'none');
    assert.equal(host.querySelector('#alt'), null);
    setOn(true);
    assert.equal(classed.className, 'is-on');
    assert.match(painted.getAttribute('style'), /rgb\(0, 128, 0\)/);
    assert.equal(host.querySelector('#shown').style.display, '');
    assert.equal(host.querySelector('#alt').textContent, 'If');
    host.remove();
  });

  it('applies a class map and a style map when the value is an object', () => {
    const [on, setOn] = signal(true);
    const el = createComponent('p', {
      attrs: {
        class: { ready: on, idle: () => !on() },
        style: { color: () => (on() ? 'rgb(1, 2, 3)' : 'rgb(0, 0, 0)') }
      }
    });
    document.body.appendChild(el);
    assert.equal(el.className, 'ready');
    assert.equal(el.style.color, 'rgb(1, 2, 3)');
    setOn(false);
    assert.equal(el.className, 'idle');
    assert.equal(el.style.color, 'rgb(0, 0, 0)');
    el.remove();
  });

  it('keeps @ping on a component as emit, and @click on an element as a DOM listener', async () => {
    let native = 0;
    const Child = defineSfc({
      template: '<button type="button" id="send" @click="send">Send</button>',
      setup: () => ({ send() { emit('ping'); } })
    });
    await registerComponent('kid', Child);
    const [pings, setPings] = signal(0);
    const View = defineSfc({
      template: '<kid @ping="onPing"></kid><button type="button" id="local" @click="local">Local</button><p id="pings">{{ pings }}</p>',
      setup: () => ({
        pings,
        onPing() { setPings((value) => value + 1); },
        local() { native += 1; }
      })
    });
    const host = place(View);
    host.querySelector('#send').click();
    host.querySelector('#local').click();
    assert.equal(host.querySelector('#pings').textContent, '1');
    assert.equal(native, 1);
    host.remove();
  });
});
