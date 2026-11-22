import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effect, signal, watch } from '../state.js';
import { defineProps, defineSfc, emit } from '../sfc.js';
import { provide, inject } from '../context.js';
import { createResource } from '../resource.js';
import { registerComponent } from '../registry.js';
import { defineRoute, lazy, resetRoutes, startRouter } from '../router.js';
import { initialize, resetRenderState } from '../render.js';
import { navigate, setCurrentRoute } from '../navigation.js';

function silence(fn) {
  const original = console.error;
  const messages = [];
  console.error = (...args) => { messages.push(args.map(String).join(' ')); };
  try {
    return { messages, value: fn() };
  } finally {
    console.error = original;
  }
}

describe('live props and events', () => {
  it('keeps a declared prop live without remounting, and does not snapshot the accessor', async () => {
    const [count, setCount] = signal(1);
    let read;
    let first;
    const Kid = defineSfc({
      name: 'kid-live',
      template: '<p data-kid>{{ count }}</p>',
      setup() {
        const props = defineProps({ count: { default: 0 } });
        read = props.count;
        first = props.count();
        return { count: props.count };
      }
    });
    await registerComponent('kid-live', Kid);
    const Parent = defineSfc({
      template: '<section><kid-live :count="count"></kid-live></section>',
      setup: () => ({ count })
    });
    const el = Parent();
    document.body.appendChild(el);
    const kid = el.querySelector('[data-kid]');
    assert.equal(kid.textContent, '1');
    assert.equal(first, 1);
    setCount(2);
    assert.equal(kid.textContent, '2');
    assert.equal(el.querySelector('[data-kid]'), kid);
    assert.equal(read(), 2);
    assert.equal(first, 1);
    el.remove();
  });

  it('warns for a missing required prop and an unknown prop', async () => {
    const Kid = defineSfc({
      name: 'kid-warn',
      template: '<p>{{ title }}</p>',
      setup() {
        const props = defineProps({ title: { required: true } });
        return { title: props.title };
      }
    });
    await registerComponent('kid-warn', Kid);
    const Parent = defineSfc({
      template: '<kid-warn :extra="1"></kid-warn>',
      setup: () => ({})
    });
    const { messages } = silence(() => Parent());
    const text = messages.join('\n');
    assert.match(text, /BD1004/);
    assert.match(text, /Missing required prop "title"/);
    assert.match(text, /BD1005/);
    assert.match(text, /Unknown prop "extra"/);
  });

  it('delivers emit payload to the component listener and not as a DOM event', async () => {
    let domSaves = 0;
    const Kid = defineSfc({
      name: 'kid-emit',
      template: '<article><button type="button" class="go" @click="send">Go</button><span class="plain">Plain</span></article>',
      setup() {
        function send() { emit('save', { id: 4 }); }
        return { send };
      }
    });
    await registerComponent('kid-emit', Kid);
    const Parent = defineSfc({
      template: '<div><kid-emit @save="onSave"></kid-emit><p class="out">{{ saved }}</p></div>',
      setup() {
        const [saved, setSaved] = signal('');
        function onSave(value) { setSaved(String(value && value.id)); }
        return { onSave, saved };
      }
    });
    const el = Parent();
    document.body.appendChild(el);
    el.querySelector('article').addEventListener('save', () => { domSaves += 1; });
    el.querySelector('.plain').click();
    assert.equal(el.querySelector('.out').textContent, '');
    el.querySelector('.go').click();
    assert.equal(el.querySelector('.out').textContent, '4');
    assert.equal(domSaves, 0);
    el.remove();
  });

  it('does not treat a parent @click as a native listener on the root', async () => {
    let clicks = 0;
    const Kid = defineSfc({
      name: 'kid-native',
      template: '<button type="button" class="go">Go</button>'
    });
    await registerComponent('kid-native', Kid);
    const Parent = defineSfc({
      template: '<kid-native @click="onClick"></kid-native>',
      setup: () => ({ onClick() { clicks += 1; } })
    });
    const el = Parent();
    document.body.appendChild(el);
    const button = el.matches('button') ? el : el.querySelector('button');
    button.click();
    assert.equal(clicks, 0);
    el.remove();
  });
});

describe('slots, context, watch, and resource', () => {
  it('renders default, named, and scoped slots in the parent scope', async () => {
    const [label, setLabel] = signal('Ada');
    const [item, setItem] = signal('one');
    const Kid = defineSfc({
      name: 'kid-slot',
      template: '<article><slot></slot><slot name="extra"></slot><slot name="row" :item="item"></slot><p class="from-child">Child</p></article>',
      styles: 'p { color: rgb(1, 2, 3); }',
      setup: () => ({ item })
    });
    await registerComponent('kid-slot', Kid);
    const Parent = defineSfc({
      template: `<section>
        <kid-slot>
          <p class="from-default">{{ label }}</p>
          <p class="from-named" x-slot="extra">named {{ label }}</p>
          <em class="from-scoped" x-slot="row">{{ item }}-{{ label }}</em>
        </kid-slot>
      </section>`,
      setup: () => ({ label })
    });
    const el = Parent();
    document.body.appendChild(el);
    assert.equal(el.querySelector('.from-default').textContent, 'Ada');
    assert.equal(el.querySelector('.from-named').textContent, 'named Ada');
    assert.equal(el.querySelector('.from-scoped').textContent, 'one-Ada');
    assert.equal(el.querySelector('.from-default').getAttribute('data-basedom-slot'), '');
    assert.equal(el.querySelector('.from-child').hasAttribute('data-basedom-slot'), false);
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('\n');
    assert.match(css, /:not\(\[data-basedom-slot\]\)/);
    setLabel('Bea');
    setItem('two');
    assert.equal(el.querySelector('.from-default').textContent, 'Bea');
    assert.equal(el.querySelector('.from-named').textContent, 'named Bea');
    assert.equal(el.querySelector('.from-scoped').textContent, 'two-Bea');
    el.remove();
  });

  it('injects a signal from an ancestor and reports a missing key', async () => {
    const [theme, setTheme] = signal('plain');
    const Nested = defineSfc({
      name: 'kid-theme-live',
      template: '<i>{{ theme }}</i>',
      setup() { return { theme: inject('theme') }; }
    });
    await registerComponent('kid-theme-live', Nested);
    const Tree = defineSfc({
      template: '<section><kid-theme-live></kid-theme-live></section>',
      setup() {
        provide('theme', theme);
        return {};
      }
    });
    const el = Tree();
    document.body.appendChild(el);
    assert.equal(el.querySelector('i').textContent, 'plain');
    setTheme('ink');
    assert.equal(el.querySelector('i').textContent, 'ink');
    el.remove();
    assert.throws(() => defineSfc({ setup() { inject('missing'); } })(), /BD1006/);
    const fallback = defineSfc({
      template: '<p>{{ theme }}</p>',
      setup() { return { theme: inject('missing', 'defaulted') }; }
    })();
    assert.equal(fallback.textContent, 'defaulted');
  });

  it('cleans up a watcher when the source changes and when it stops', () => {
    const [n, setN] = signal(1);
    const seen = [];
    let cleanups = 0;
    const stop = watch(() => n(), (next, prev, onCleanup) => {
      seen.push([next, prev]);
      onCleanup(() => { cleanups += 1; });
    });
    assert.deepEqual(seen, []);
    setN(2);
    assert.deepEqual(seen, [[2, 1]]);
    assert.equal(cleanups, 0);
    setN(3);
    assert.equal(cleanups, 1);
    assert.deepEqual(seen[1], [3, 2]);
    stop();
    assert.equal(cleanups, 2);
    setN(4);
    assert.equal(seen.length, 2);

    const immediate = [];
    const stopNow = watch(() => n(), (next, prev) => { immediate.push([next, prev]); }, { immediate: true });
    assert.deepEqual(immediate[0], [4, undefined]);
    stopNow();
  });

  it('drops a stale resource response and aborts the previous signal', async () => {
    const [id, setId] = signal(1);
    let firstSignal;
    let resolveFirst;
    const data = createResource(() => id(), (value, ctx) => new Promise((resolve, reject) => {
      ctx.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
      if (value === 1) {
        firstSignal = ctx.signal;
        resolveFirst = () => resolve('one');
      } else {
        resolve('two');
      }
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(data.loading(), true);
    setId(2);
    assert.equal(firstSignal.aborted, true);
    resolveFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(data(), 'two');
    assert.equal(data.value(), 'two');
    assert.equal(data.loading(), false);
    data.dispose();
  });
});

describe('error boundary', { concurrency: false }, () => {
  it('shows fallback for a render error and keeps the layout mounted', async () => {
    const Boom = defineSfc({
      name: 'boom-render',
      template: '<p>nope</p>',
      setup() { throw new Error('render failed'); }
    });
    await registerComponent('boom-render', Boom);
    const Page = defineSfc({
      template: '<div><header>App</header><section x-boundary="This screen failed."><boom-render></boom-render></section></div>'
    });
    const { messages, value: el } = silence(() => Page());
    document.body.appendChild(el);
    assert.equal(el.querySelector('header').textContent, 'App');
    assert.match(el.querySelector('[role="alert"]').textContent, /This screen failed/);
    assert.match(el.textContent, /render failed/);
    assert.match(messages.join('\n'), /BD1007/);
    el.remove();
  });

  it('catches an effect error, resets, and does not claim the click itself was caught', async () => {
    let clicks = 0;
    const Kid = defineSfc({
      name: 'boom-effect',
      template: '<button type="button" class="go" @click="fail">{{ label }}</button>',
      setup() {
        const [label, setLabel] = signal('ok');
        effect(() => {
          if (label() === 'bad') throw new Error('effect failed');
        });
        return {
          label,
          fail() {
            clicks += 1;
            setLabel('bad');
          }
        };
      }
    });
    await registerComponent('boom-effect', Kid);
    const Page = defineSfc({
      template: '<div><header>App</header><section x-boundary="This screen failed."><boom-effect></boom-effect></section></div>'
    });
    const el = silence(() => Page()).value;
    document.body.appendChild(el);
    assert.equal(el.querySelector('.go').textContent, 'ok');
    silence(() => { el.querySelector('.go').click(); });
    assert.equal(clicks, 1);
    assert.equal(el.querySelector('header').textContent, 'App');
    assert.match(el.textContent, /effect failed/);
    silence(() => { el.querySelector('[data-boundary-reset]').click(); });
    assert.equal(el.querySelector('.go').textContent, 'ok');
    el.remove();
  });

  it('keeps the layout mounted when a child screen throws', async () => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    window.scrollTo = () => {};
    document.body.innerHTML = '<div id="app"></div>';
    const Layout = defineSfc({
      template: '<div><header>App</header><main x-boundary="This screen failed." x-outlet></main></div>'
    });
    const Home = defineSfc({ template: '<h1>Home</h1>' });
    const Boom = defineSfc({
      template: '<h1>Boom</h1>',
      setup() { throw new Error('screen failed'); }
    });
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: Home },
        { path: 'boom', component: Boom }
      ]
    });
    initialize('#app');
    startRouter();
    await navigate('/');
    const header = document.querySelector('header');
    await navigate('/boom');
    assert.equal(document.querySelector('header'), header);
    assert.match(document.body.textContent, /This screen failed/);
    assert.match(document.body.textContent, /screen failed/);
    assert.doesNotMatch(document.body.textContent, /Navigation Error/);
  });
});

describe('lazy screens and route load', { concurrency: false }, () => {
  it('shows loading, then the loaded data, and drops a superseded load', async () => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    window.scrollTo = () => {};
    document.body.innerHTML = '<div id="app"></div>';
    const Layout = defineSfc({
      template: '<div><header>App</header><main x-outlet></main></div>'
    });
    const Home = defineSfc({ template: '<h1>Home</h1>' });
    const Notes = defineSfc({
      template: '<h1>{{ heading }}</h1>',
      setup(props) {
        return { heading: props.routeData.heading };
      }
    });
    let release;
    let ran = 0;
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: Home },
        {
          path: 'notes',
          component: lazy(async () => Notes),
          load({ signal }) {
            ran += 1;
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve({ heading: 'Notes' }), 40);
              release = () => resolve({ heading: 'Notes' });
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              });
            });
          }
        },
        { path: 'about', component: defineSfc({ template: '<h1>About</h1>' }) }
      ]
    });
    initialize('#app');
    startRouter();
    await navigate('/');
    const header = document.querySelector('header');
    const pending = navigate('/notes');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(document.querySelector('main').textContent, /Loading/);
    assert.equal(document.querySelector('header'), header);
    release();
    await pending;
    assert.equal(document.querySelector('h1').textContent, 'Notes');
    assert.equal(document.querySelector('header'), header);

    let finished = 0;
    resetRoutes();
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: Home },
        {
          path: 'slow',
          component: Notes,
          load({ signal }) {
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => { finished += 1; resolve({ heading: 'Slow' }); }, 50);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              });
            });
          }
        },
        { path: 'about', component: defineSfc({ template: '<h1>About</h1>' }) }
      ]
    });
    const first = navigate('/slow');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = navigate('/about');
    await first;
    await second;
    assert.equal(document.querySelector('h1').textContent, 'About');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(finished, 0);
    assert.equal(ran, 1);
  });

  it('renders a load error inside the layout and still renders 404 there', async () => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    window.scrollTo = () => {};
    document.body.innerHTML = '<div id="app"></div>';
    const Layout = defineSfc({
      template: '<div><header>App</header><main x-outlet></main></div>'
    });
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: defineSfc({ template: '<h1>Home</h1>' }) },
        { path: 'bad', component: defineSfc({ template: '<h1>Bad</h1>' }), load() { throw new Error('load failed'); } }
      ]
    });
    initialize('#app');
    startRouter();
    await navigate('/');
    const header = document.querySelector('header');
    await navigate('/bad');
    assert.equal(document.querySelector('header'), header);
    assert.match(document.querySelector('[data-route-state="error"]').textContent, /load failed/);
    await navigate('/missing');
    assert.equal(document.querySelector('header'), header);
    assert.match(document.querySelector('main').textContent, /404/);
  });
});
