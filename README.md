# BaseDOM

Real-DOM HTML components. A screen is one `.html` file. Signals write the nodes you authored. There is no virtual DOM, no JSX, and no runtime dependency.

## Create an app

```bash
npm create basedom my-app
```

`npm create basedom` runs `basedom create`. The same command is `npx basedom create my-app`. Then:

```bash
cd my-app
npm install
npm run dev
```

That starts Vite with one counter component. The rest of this page is how you grow it into a small app: a list, filters, a route with a param, an async page, a form, and a child component. The finished version is `examples/todo`.

## One component

```html
<template>
  <p>{{ count }} <button type="button" @click="increment">Add</button></p>
</template>
<script setup>
import { signal } from 'basedom';
const [count, setCount] = signal(0);
function increment() { setCount((value) => value + 1); }
</script>
```

`setup` runs once. The names it declares are the template's scope. `{{ count }}` reads the signal. `@click` calls the function with the event. `:checked` and other `:attr` bindings write the DOM when the value changes.

Scoped CSS applies to the component's elements and skips slotted content. A rule for the root element uses `&`, because other selectors are prefixed as descendants:

```css
& { max-width: 36rem; margin: 2rem auto; }
header { display: flex; }
```

`x-model` on a text, checkbox, radio, select, or number control reads and writes a signal. Return both halves (`draft` and `setDraft`) from setup. An empty string is not a number; a number input stores `null` until it parses.

```html
<input x-model="draft">
<p class="error">{{ error }}</p>
```

```js
const [draft, setDraft] = signal('');
const [error, setError] = signal('');
function add(event) {
  event.preventDefault();
  if (!draft().trim()) {
    setError('Title is required.');
    return;
  }
  setError('');
}
```

`x-if`, `x-else`, `x-show`, and `x-for` are the control flow. A list that can reorder needs `x-key`:

```html
<li x-for="todo in visible" x-key="todo.id">{{ todo.title }}</li>
```

Shared state is a module of signals. Import it from any screen. There is no separate store.

## A child component

The file name is the tag. `todo-item.html` is `<todo-item>`. Import the file from the parent. You do not register it yourself.

```html
<todo-item :title="todo.title" :done="todo.done" @remove="onRemove">
  <a x-slot="meta" :href="'/todo/' + todo.id" x-link>Open</a>
</todo-item>
```

In the child, `defineProps` returns a getter per prop. Call it (`title()`) when the template or a later read should see updates. Calling it once stores a snapshot.

```html
<script setup>
import { defineProps, emit } from 'basedom';
const props = defineProps({
  id: { required: true },
  title: { required: true },
  done: { default: false }
});
const title = props.title;
function remove() { emit('remove', props.id()); }
</script>
<template>
  <article>
    <span>{{ title }}</span>
    <slot name="meta"></slot>
    <button type="button" @click="remove">Remove</button>
  </article>
</template>
```

`emit('remove', id)` calls the parent's `@remove` with that value. It is not a DOM event. A missing required prop warns `BD1004`.

`provide(key, value)` and `inject(key)` walk the component tree. Pass a signal through if the child should see later updates. A missing key throws `BD1006` unless you pass a default.

## Routes

```js
import Layout from './screens/layout.html';
import List from './screens/list.html';
import { defineRoute, lazy, startRouter, initialize, navigate } from 'basedom';

defineRoute({
  path: '/',
  component: Layout,
  children: [
    { path: '', component: List },
    { path: 'active', component: List },
    { path: 'todo/:id', component: lazy(() => import('./screens/detail.html')),
      load({ params, signal }) {
        return fetch('/api/todos/' + params.id, { signal }).then((response) => response.json());
      }
    }
  ]
});

initialize('#app');
startRouter();
navigate(location.pathname + location.search);
```

`navigate` returns a promise. Leave it unawaited at the top of the file. Vite's default build target rejects top-level await.

The layout keeps `x-outlet`. A child route renders there and the layout stays mounted.

```html
<main x-boundary="This page failed." x-outlet></main>
```

Put `x-link` on anchors that should navigate in the page. Other links behave normally.

`:id` is `props.params.id` in the screen. `load` runs before the screen mounts. The screen reads `routeData`. A newer navigation aborts `signal` and drops the old result. The outlet shows `Loading…` and, on failure, the error. An unknown path renders 404 inside the layout.

`startRouter({ mode: 'hash' })` uses the hash when the server cannot fall back to `index.html`. The default is history mode, which Vite already supports.

A filter is a route param, not `location.pathname`. The address bar updates after the screen renders, so setup still sees the previous URL. `props.params.filter` is the navigation that is rendering now.

```js
{ path: 'todo/:id', component: Detail },
{ path: '', component: List },
{ path: ':filter', component: List }
```

```js
const name = props.params.filter;
const filter = name === 'active' ? 'Active' : name === 'done' ? 'Done' : 'All';
```

Put the more specific `todo/:id` route before `:filter`, because the first match wins. Navigating remounts the list, and the todos live in the shared module, so they survive that remount.

## Async in a screen

`createResource(source, fetcher)` is the in-screen version of `load`. The template reads `resource.value`, `resource.loading`, and `resource.error`. The fetcher receives `{ signal }`. A new source aborts the previous request.

`watch(source, (next, prev, onCleanup) => {}, { immediate })` reruns when the source changes and runs the previous cleanup first.

`x-boundary` catches errors thrown while rendering, and errors thrown by effects. It does not catch event handlers or timers.

## Dev and build

`npm run dev` preserves `signal()` values across edits when you did not add, remove, or rename one. Template and style edits do not rerun setup. A script syntax error is `BD1021` on the Vite overlay. The next good save applies it.

`npm run build` writes the production assets and `basedom-graph.json`. Dev serves the same graph at `/__basedom/graph`.

## Without Vite

Inline `<script>` inside fetched HTML is not executed. Point at a module next to the file:

```html
<script setup src="./counter.setup.js"></script>
```

```js
import { loadComponent, mount } from 'basedom';
const Counter = await loadComponent(new URL('./Counter.html', import.meta.url).href);
mount(Counter, '#app');
```

`src` must be a same-origin path inside that component's directory.

## More

[docs/sfc.md](docs/sfc.md) is the component reference. [docs/limitations.md](docs/limitations.md) is what this version does not do. Expressions are a subset of JavaScript: property access, calls, `+`, comparisons, `&&`, `||`, `? :`, and assignment to a signal. There is no `eval`.
