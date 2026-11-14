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
& { max-width: 36rem; }
p { font-weight: 600; }
</style>
```

`setup` runs once per instance. Names it declares are visible to the template. Return values are not required when the Vite plugin compiles the file: the plugin returns those bindings for you. A hand-written setup module should `return` the bindings. `const props = defineProps()` is a normal binding. The compiler names its own setup argument `__props` when your script already declares `props`.

Scoped CSS adds a class to the component root and prefixes other selectors as descendants of that class. Style the root with `&`. Slotted content is marked `data-basedom-slot` and is not matched.

## Props, events, slots, and context

Call `defineProps` during setup. Each declared prop is a getter. `props.count()` reads the current value, including after the parent updates it. The child is not remounted. `const n = props.count()` stores a snapshot. Return the getter (`count: props.count`) when the template should keep updating. A required prop with no default warns `BD1004` in development. An undeclared prop warns `BD1005`.

`emit('save', payload)` calls the parent's `@save` handler with that payload. It does not dispatch a DOM event. `@save` on a component tag is that listener. A native `@click` belongs on an element inside the template. A native event name passed as `onClick` from JavaScript is still attached to the root; a template `@name` is not.

The Vite plugin registers a child `.html` import under its file name. `todo-item.html` is the tag `<todo-item>`. Import it from the parent and use the tag. A no-build app still calls `registerComponent(name, component)` after `loadComponent`.

Default slot content is the element's children. `x-slot="extra"` fills `<slot name="extra">`. `:item` on a `<slot>` is a scoped value and stays live. Slot markup is parsed in the parent's scope, so a parent signal used inside the slot keeps updating. Slotted elements are marked `data-basedom-slot`. Scoped CSS does not style that element or its descendants. The child's own elements still match.

`provide(key, value)` stores a value on the component owner. `inject(key)` walks ancestors. Pass a signal through and the child reads the same signal. `inject(key, fallback)` uses the fallback when no ancestor provided it. With no fallback, a missing key throws `BD1006`.

## Watchers and async data

`watch(() => source(), (next, prev, onCleanup) => {}, { immediate })` reruns when the source changes. The previous `onCleanup` runs first, and again when the watcher stops or the component unmounts. Use it to abort an in-flight request.

`createResource(source, fetcher)` exposes `loading`, `error`, `value`, and `refetch`. In a template read `resource.value`, `resource.loading`, and `resource.error`. The fetcher receives `{ signal }`. A new source value aborts the previous signal and drops a late response.

## Errors and route data

`x-boundary="This screen failed."` catches errors thrown while rendering its subtree and errors thrown by effects created there. It shows the message, the error text, and a Reset button. It does not catch errors from event handlers or timers. Put it on the layout outlet (`<main x-boundary x-outlet>`) so a child screen can fail without unmounting the layout.

`lazy(() => loadComponent(url))` or `lazy(() => import('./screen.js'))` loads a screen on navigation. An `async function` component is treated the same way. A normal function is the screen itself and is not called early.

`load({ params, query, path, signal })` runs before the screen mounts. The screen reads `routeData` from props. Setup also receives `params` and `query` on its argument. The address bar is updated after that render, so `location.pathname` can still be the previous URL. A newer `navigate()` aborts `signal` and drops the result. While it waits, the outlet says `Loading…`. A thrown error renders inside the outlet. An unknown path still renders 404 inside the layout. The first matching route wins, so a path with a param has to be listed before a catch-all param.

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

The plugin accepts its own module. What an edit does depends on what changed:

- **Template only.** Setup does not run again. The new template is rendered with the same signals, then the element is swapped in place. Effects that belonged to the previous render are disposed.
- **Style only.** The scoped `<style>` for that component is rewritten. The class already on the elements stays, so setup does not run.
- **Script, or an imported module.** Setup runs again. `signal()` calls are matched by declaration order and name. Values are copied onto the new signals when that list is unchanged. If a signal was added, removed, or renamed, the instance remounts from its initializers and the console shows `BD1020`.
- **Every mounted instance** of that component is updated, including ones nested inside another component, `x-for`, `x-if`, a slot, a route outlet, or a lazy screen.
- **A syntax error** in `<script setup>` fails the transform with `BD1021`. Vite shows its overlay. The previous page stays up. The next good save applies as an HMR update.
- **A route module** that calls `defineRoute(` is re-registered on save and the current route renders again. Keep the route table in one module. That re-render creates new screen instances, so it does not preserve screen state the way an SFC edit does.

Production builds omit the HMR runtime. `import.meta.hot` blocks are not in the emitted bundle.

`vite build` writes `basedom-graph.json`. In dev the same graph is at `/__basedom/graph` and the virtual module `virtual:basedom-graph`, and it updates when a file changes. The script is parsed with Rollup's parser. The template is scanned with locations. Entries include imports, props (`required` and `default`), emits, slots and scoped slot params, `provide` / `inject` keys, `createResource` calls, and routes. A route path or component that is not a literal is kept and marked `unresolved` instead of being dropped. Each record has `file`, `line`, and `column`. The shape is `schema/basedom-graph.schema.json`.

The plugin warns on `BD1030` (listener for an emit the child never sends), `BD1031` (prop passed to a component that does not declare it), `BD1032` (`inject` with no ancestor `provide` on any route path), `BD1033` (route file missing), `BD1034` (component not reachable from a route), and `BD1035` (route path or component is not static).

Compile and runtime failures use stable codes (`BD1001` expression, `BD1003` x-model, `BD1004` missing prop, `BD1006` missing inject, `BD1007` boundary, `BD1010` route load, `BD1011` lazy screen, `BD1015` compile, `BD1016` inline script, `BD1020` HMR shape change, `BD1021` script syntax). The message includes the file, the expression, and a fix hint when those are known.

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
