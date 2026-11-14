# HTML components

A component file has three optional parts:

```html
<template>
  <p>{{ message }}</p>
  <button type="button" @click="increment">Add</button>
</template>

<script setup>
import { signal } from './state.js';
const [count, setCount] = signal(0);
function increment() { setCount((value) => value + 1); }
</script>

<style>
p { font-weight: 600; }
</style>
```

`setup` runs once per instance. Names it declares are visible to the template. Return values are not required when the Vite plugin compiles the file: the plugin returns those bindings for you. A hand-written setup module should `return` the bindings.

## Props, events, slots, and context

Call `defineProps` during setup. Each declared prop is a getter. `props.count()` reads the current value, including after the parent updates it. The child is not remounted. `const n = props.count()` stores a snapshot. Return the getter (`count: props.count`) when the template should keep updating. A required prop with no default warns `BD1004` in development. An undeclared prop warns `BD1005`.

`emit('save', payload)` calls the parent's `@save` handler with that payload. It does not dispatch a DOM event. `@save` on a component tag is that listener. A native `@click` belongs on an element inside the template. A native event name passed as `onClick` from JavaScript is still attached to the root; a template `@name` is not.

Default slot content is the element's children. `x-slot="extra"` fills `<slot name="extra">`. `:item` on a `<slot>` is a scoped value and stays live. Slot markup is parsed in the parent's scope, so a parent signal used inside the slot keeps updating. Slotted elements are marked `data-basedom-slot`. Scoped CSS does not style that element or its descendants. The child's own elements still match.

`provide(key, value)` stores a value on the component owner. `inject(key)` walks ancestors. Pass a signal through and the child reads the same signal. `inject(key, fallback)` uses the fallback when no ancestor provided it. With no fallback, a missing key throws `BD1006`.

## Watchers and async data

`watch(() => source(), (next, prev, onCleanup) => {}, { immediate })` reruns when the source changes. The previous `onCleanup` runs first, and again when the watcher stops or the component unmounts. Use it to abort an in-flight request.

`createResource(source, fetcher)` exposes `loading`, `error`, `value`, and `refetch`. In a template read `resource.value`, `resource.loading`, and `resource.error`. The fetcher receives `{ signal }`. A new source value aborts the previous signal and drops a late response.

## Errors and route data

`x-boundary="This screen failed."` catches errors thrown while rendering its subtree and errors thrown by effects created there. It shows the message, the error text, and a Reset button. It does not catch errors from event handlers or timers. Put it on the layout outlet (`<main x-boundary x-outlet>`) so a child screen can fail without unmounting the layout.

`lazy(() => loadComponent(url))` or `lazy(() => import('./screen.js'))` loads a screen on navigation. An `async function` component is treated the same way. A normal function is the screen itself and is not called early.

`load({ params, query, path, signal })` runs before the screen mounts. The screen reads `routeData` from props. A newer `navigate()` aborts `signal` and drops the result. While it waits, the outlet says `Loading…`. A thrown error renders inside the outlet. An unknown path still renders 404 inside the layout.

## Two ways to load a component

### No build

Inline `<script>` in a fetched `.html` file is **not executed**. Point at a module next to the file:

```html
<script setup src="./counter.setup.js"></script>
```

```js
import { loadComponent } from './sfc.js';
import { mount } from './components.js';

const Counter = await loadComponent(new URL('./components/Counter.html', import.meta.url).href);
mount(Counter, '#app');
```

`loadComponent` is for application files you ship. `src` must be same-origin and inside the component's directory. `data:`, `blob:`, and `javascript:` URLs are rejected. Pass `{ allowOutsideDirectory: true }` only when you mean to.

Run the checked-in example from the repository root:

```bash
npm run example
```

Open `http://127.0.0.1:4173/examples/no-build/`.

### Vite

The plugin compiles inline `<script setup>` into a normal ES module. That happens at build time, to source you wrote, not to HTML a server sent later.

```js
import { basedom } from 'basedom/vite';

export default { plugins: [basedom()] };
```

The plugin accepts its own module. A template edit replaces the mounted element and keeps the page from doing a full reload. Setup runs again, so signal state inside that component is not copied across the update. If the new module cannot be applied, the plugin calls `import.meta.hot.invalidate()` and Vite reloads the page.

`vite build` writes `basedom-graph.json` next to the bundle. It lists each compiled SFC's bindings, `defineProps` keys, `emit` names, slots, `x-model` targets, and attribute bindings. Routes are included when a JavaScript module calls `defineRoute` and the path strings are visible as literals. That scan is not a full JavaScript parser.

Compile and runtime failures use stable codes (`BD1001` expression, `BD1003` x-model, `BD1004` missing prop, `BD1006` missing inject, `BD1007` boundary, `BD1010` route load, `BD1011` lazy screen, `BD1015` compile, `BD1016` inline script). The message includes the file, the expression, and a fix hint when those are known.

See `examples/vite-counter`. Check it with:

```bash
npm run example:build
```

## Server-generated HTML

Use `renderServerTemplate(html, context)` when a server builds markup.

- `<script>` is ignored and not run.
- `on*` attributes and `javascript:` URLs are removed.
- `{{ name }}` becomes text, not HTML.
- `@click="increment"` can only call a function you passed in `context`.

Do not pass `window`, `document`, or broad objects in that context. The expression language can call what you give it.

`loadComponent` must not be pointed at untrusted HTML. A hostile file could set `src` to another same-origin module.

`raw()` and the fetch swap attributes insert HTML. They are a different, trusted-HTML path and are outside this milestone. See [limitations](./limitations.md).

## Expressions

Supported: identifiers, calls, member access, `[]`, arithmetic, comparisons, `&&`, `||`, `??`, ternary, assignment to a signal (`count = count + 1`), arrays, strings, numbers, booleans, `null`.

Not supported: arrow functions, optional chaining, `new`, assignment to arbitrary objects, `eval`, `Function`, `window`, `document`, `globalThis`, `constructor`.

`x-model` on text inputs stores a string. Checkboxes store a boolean.
