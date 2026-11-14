import { defineSfc, emit } from '../../sfc.js';
import { mount } from '../../components.js';
import { registerComponent } from '../../registry.js';
import { signal } from '../../state.js';

const [on, setOn] = signal(false);
const [draft, setDraft] = signal('');
const [pings, setPings] = signal(0);

const Child = defineSfc({
  template: '<button type="button" id="send" @click="send">Ping</button>',
  setup: () => ({ send() { emit('ping'); } })
});
await registerComponent('kid', Child);

const Page = defineSfc({
  template: `
    <main>
      <button type="button" id="toggle" @click="toggle">Toggle</button>
      <p id="classed" :class="on ? 'is-on' : 'is-off'">Class</p>
      <p id="painted" :style="on ? 'color: rgb(0, 128, 0)' : 'color: rgb(0, 0, 0)'">Style</p>
      <p id="shown" x-show="on">Shown</p>
      <p id="alt" x-if="on">Visible</p>
      <label>Name <input id="name" x-model="draft"></label>
      <p id="echo">{{ draft }}</p>
      <kid @ping="onPing"></kid>
      <p id="pings">{{ pings }}</p>
    </main>
  `,
  setup: () => ({
    on,
    draft,
    setDraft,
    pings,
    toggle() { setOn((value) => !value); },
    onPing() { setPings((value) => value + 1); }
  })
});

mount(Page, '#app');
