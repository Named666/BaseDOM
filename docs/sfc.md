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

Bound child props (`:name="name"`) are live getters. Read them from the template, or return the getter from setup. Calling the getter once captures a snapshot.

DOM listeners on a component (`<UserCard @click="save" />`) are attached to the component's root element. They are not a separate emit channel.

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
