# BaseDOM

BaseDOM is a small reactive UI library. You write HTML, and signals update the real DOM. There is no virtual DOM and no runtime dependency.

It is closer to Solid than to React: a component runs once, and a binding writes to the text node or attribute that read the signal. The file format is closer to a Vue single-file component, so it can load in the browser without a build. It is not Angular: there is no dependency injection, compiler, or platform.

Vue's stable 3.5 runtime still diffs virtual nodes. Vue's no-VDOM mode (Vapor) is opt-in and, as of November 2026, still in the 3.6 release candidates. BaseDOM does not include either runtime. See [docs/design.md](docs/design.md). Nothing in this repository is a performance claim.

The tested surface is signals, lifecycle cleanup, HTML templates (`x-if`, `x-for`, `x-model`, events, text), and `.html` components. The router, store, form helpers, and fetch/HTML swap are still in the package and are not part of that tested surface. Known gaps are in [docs/limitations.md](docs/limitations.md).

## Philosophy

- **Real DOM.** `{{ count }}` sets `textContent` on the existing text node. Lists move real elements. There is no vnode tree to diff.
- **HTML components.** `<template>`, `<script setup>`, and `<style>` in one `.html` file.
- **Run without a build, or compile with Vite.** Inline script in fetched HTML is not executed. See [docs/sfc.md](docs/sfc.md).
- **Small on purpose.** No runtime dependencies. Vite is a dev dependency. Do not add a virtual DOM to look more like React or Vue.

## Key Features

- **Signal-based Reactivity:** Fine-grained updates with `signal`, `computed`, and `effect`.
- **Persistent State:** Signals can automatically sync with `sessionStorage`.
- **Single-File Components:** HTML, CSS, and JS in one file with scoped styles.
- **Nested Routing:** Powerful router with nested routes, layouts, and parameter matching.
- **Navigation Guards:** Global and route-specific guards (`beforeEnter`, `beforeLeave`).
- **Declarative AJAX:** HTMX-inspired fetch directives (`x-get`, `x-post`, etc.) with component rendering support.
- **Global Store:** Feature-rich store for structured and tabular data with transaction support.
- **Form System:** Comprehensive form management with validation, state tracking, and UI components.
- **Lifecycle Hooks:** `onMount`, `onUnmount`, and `onUpdate` hooks for components and elements.

## Getting started

From this repository:

```bash
npm install
npm test
npm run example
```

Open `http://127.0.0.1:4173/examples/spa/` for the two-screen app. Each screen is an `.html` file. Its script is a module beside the file (`<script setup src>`), so the browser loads it and the HTML is not evaluated. `examples/no-build/` is a single screen with no router.

```js
import { loadComponent } from '../../sfc.js';
import { defineRoute, startRouter } from '../../router.js';
import { initialize } from '../../render.js';
import { navigate } from '../../navigation.js';

const layout = await loadComponent(new URL('./screens/layout.html', import.meta.url).href);
const home = await loadComponent(new URL('./screens/home.html', import.meta.url).href);
const about = await loadComponent(new URL('./screens/about.html', import.meta.url).href);

defineRoute({
  path: '/',
  component: layout,
  children: [
    { path: '', component: home },
    { path: 'about', component: about }
  ]
});

initialize('#app');
startRouter();
await navigate(location.pathname + location.search);
```

The layout stays mounted. `<main x-outlet>` is the only part that changes. A screen runs once; later signal writes update the existing DOM nodes. The example uses hash URLs (`#/about`) so a static server does not have to rewrite paths. `startRouter()` without `{ mode: 'hash' }` uses normal paths when the server falls back to `index.html`.

To compile an inline `<script setup>` instead, use the Vite example:

```bash
npm run example:build
```

That runs `examples/vite-counter` through `vite/plugin.js`. Replacing Vite is not required for the library to run.

Checks: `npm test` (Node's test runner and jsdom) and the Vite build above. CI runs both.

## Core Concepts

### Reactivity

BaseDOM uses a signal-based reactivity system similar to SolidJS or Preact Signals.

- `signal(initial)`: Returns `[getter, setter]`.
- `signal(key, initial)`: **Persistent Signal**. Automatically syncs with `sessionStorage`.
- `computed(fn)`: A read-only signal that re-calcules when dependencies change.
- `effect(fn)`: Runs a side effect and tracks dependencies.

```javascript
const [count, setCount] = signal(0);
const [user, setUser] = signal('user_pref', { theme: 'dark' }); // Persistent
const double = computed(() => count() * 2);

effect(() => {
  console.log('Count is:', count());
  console.log('Doubled:', double());
});
```

### Single-File Components (.html)

Components are `.html` files containing `<template>`, `<script>`, and `<style>`.

#### `<script setup>`

Fetched HTML does not run inline script. Either compile the file with the Vite plugin, or point `src` at a module in the same directory:

```html
<script setup src="./counter.setup.js"></script>
```

```js
import { signal } from '../../../state.js';

export default function setup() {
  const [name, setName] = signal('World');
  function greet() { /* use name() */ }
  return { name, greet };
}
```

The template calls `greet` and reads `name`. Assignment in a template (`count = count + 1`) writes through the signal's `.set`. Details and the server-template rules are in [docs/sfc.md](docs/sfc.md).

### Component Composition

Nest components declaratively by using their registered tag names. Data flows down via **props** and up via **events**.

#### Passing Props
Use the `:` prefix to bind reactive data or JavaScript expressions to props.

```html
<!-- Parent.html -->
<template>
  <UserCard :user="currentUser" :theme="'dark'" />
</template>
```

#### Handling Events
Use the `@` prefix (or `x-on:`) to listen for custom events or standard DOM events emitted by child components.

```html
<!-- Parent.html -->
<template>
  <Counter @update="handleUpdate" @reset="count = 0" />
</template>
```

### Slots & Scoped Slots

BaseDOM supports powerful slot composition.

**Child Component (`Card.html`):**
```html
<template>
  <div class="card">
    <header><slot name="header">Default Header</slot></header>
    <section><slot :item="internalData">Default Content</slot></section>
  </div>
</template>
```

**Parent Usage:**
```html
<template>
  <Card>
    <h1 x-slot="header">Custom Title</h1>
    <!-- Scoped Slot: 'item' is passed from Card.html -->
    <p x-slot="default" :item="data">{{ data.description }}</p>
  </Card>
</template>
```

## Template Directives

BaseDOM provides a rich set of directives for declarative DOM manipulation.

| Directive | Description | Example |
|-----------|-------------|---------|
| `x-if` | Conditional rendering. | `<div x-if="isVisible">Shown</div>` |
| `x-else` | Paired with `x-if` for alternative rendering. | `<div x-else>Hidden</div>` |
| `x-for` | List rendering with `item in items` syntax. | `<li x-for="item in list">{{ item }}</li>` |
| `x-on:[event]` | Event listener. Alias: `@[event]`. | `<button @click="doWork">` |
| `x-bind:[attr]` | Attribute binding. Alias: `:[attr]`. | `<img :src="avatarUrl">` |
| `x-model` | Two-way binding for inputs, selects, etc. | `<input x-model="name">` |
| `x-show` | Toggle visibility using `display: none`. | `<div x-show="isOpen">` |
| `x-ref` | Assign element to a variable in context. | `<canvas x-ref="canvas">` |
| `x-mount` | Lifecycle hook: called when mounted. | `<div x-mount="init">` |
| `x-unmount` | Lifecycle hook: called when unmounted. | `<div x-unmount="cleanup">` |
| `x-update` | Lifecycle hook: called when updated. | `<div x-update="refresh">` |
| `slot` | Define a placeholder for content. | `<slot name="title">` |
| `x-slot` | Provide content for a named slot. | `<div x-slot="title">` |
| `x-get` | AJAX: Perform a GET request. | `<button x-get="/api/data">` |
| `x-post` | AJAX: Perform a POST request. | `<form x-post="/api/save">` |
| `x-put` | AJAX: Perform a PUT request. | `<button x-put="/api/update">` |
| `x-patch` | AJAX: Perform a PATCH request. | `<button x-patch="/api/edit">` |
| `x-delete` | AJAX: Perform a DELETE request. | `<button x-delete="/api/del">` |
| `x-link` | Opt-in to SPA navigation for an anchor tag. | `<a href="/about" x-link>` |

## Routing

BaseDOM includes a full-featured SPA router with nested layouts and guards.

```javascript
import { defineRoute, navigate } from './basedom/router.js';

defineRoute({
  path: '/dashboard',
  component: './layouts/Dashboard.html',
  meta: { title: 'Dashboard' },
  children: [
    { 
      path: 'users/:id', 
      component: './pages/UserDetail.html',
      guards: {
        beforeEnter: async (to) => {
          if (!hasAccess(to.params.id)) return '/403';
        }
      }
    }
  ],
  scrollBehavior: () => ({ top: 0, behavior: 'smooth' })
});

// Programmatic navigation
navigate('/dashboard/users/123');
```

## Declarative AJAX (Fetch)

This block describes the fetch helpers that ship in the package. They are not covered by the regression tests in 0.4.0, and swapping HTML with `innerHTML` is a trusted-HTML path, not the SFC sandbox.

HTMX-inspired AJAX directly in your HTML.

```html
<div x-inherit="x-headers x-indicator">
    <button x-post="/api/save" 
            x-params='{"id": 1}' 
            x-encoding="json"
            x-target="#status"
            x-indicator=".spinner"
            x-headers='{"Authorization": "Bearer token"}'>
        Save Changes
    </button>
    <span class="spinner x-requesting:show">Saving...</span>
    <div id="status"></div>
</div>
```

### AJAX Deep-Dive

BaseDOM's fetch system allows you to build complex, interactive UIs with minimal JavaScript.

#### Fetch Attributes

| Attribute | Description |
|-----------|-------------|
| `x-get`, `x-post`, `x-put`, `x-patch`, `x-delete` | The URL to fetch from using the specified method. |
| `x-target` | The element to swap the response into (e.g., `#id`, `.class`, or `this`). |
| `x-trigger` | The event that triggers the fetch (default: `click` or `submit`). |
| `x-indicator` | Selector for elements that get the `x-requesting` class during fetch. |
| `x-swap` | The swap strategy and modifiers (e.g., `innerHTML swap:1s`). |
| `x-headers` | JSON or `Key: Value` pairs to send as request headers. |
| `x-params` | Data to send with the request (JSON or URL-encoded). |
| `x-include` | Additional elements to include in the request body. |
| `x-vals` | Extra values to add to the request (evaluated expression). |
| `x-encoding` | Set to `json` to send data as a JSON body. |
| `x-confirm` | A confirmation message to show before fetching. |
| `x-timeout` | Request timeout in milliseconds. |
| `x-push-url` | Update the browser's address bar with the response URL. |
| `x-replace-url` | Replace the browser's address bar with the response URL. |
| `x-select` | Narrow the response to a specific selector before swapping. |
| `x-select-oob` | Swap specific elements from the response out-of-band. |
| `x-swap-oob` | Mark an element in a response for out-of-band swapping. |
| `x-inherit` | List of attributes to inherit from parent elements (or `*`). |
| `x-disinherit` | List of attributes to stop inheriting from parents (or `*`). |
| `x-boost` | Boost anchor tags and forms to use AJAX automatically. |

#### Swap Strategies

The `x-swap` attribute controls how the response is inserted into the DOM.

- `innerHTML` (Default): Replace the contents of the target.
- `outerHTML`: Replace the target element itself.
- `textContent`: Replace contents with raw text.
- `beforebegin`: Insert before the target element.
- `afterbegin`: Insert inside the target, before the first child.
- `beforeend`: Insert inside the target, after the last child.
- `afterend`: Insert after the target element.
- `delete`: Remove the target element regardless of the response.
- `none`: Do not perform a swap.

#### Swap Modifiers

Append these to `x-swap` for fine-grained control:

- `swap:[time]`: Delay the swap (e.g., `swap:500ms`).
- `settle:[time]`: Delay after the swap before finishing (e.g., `settle:100ms`).
- `transition:true`: Use the **View Transitions API** for the swap.
- `scroll:[top|bottom|selector:top]`: Scroll the window or an element after swapping.
- `show:[top|bottom|selector:top]`: Scroll an element into view after swapping.
- `focus-scroll:true`: Maintain scroll position of the focused element.

#### Best Practices & Inheritance

- **Use `x-inherit`**: Define common headers or indicators on a parent container.
- **Indicators**: Use the `x-requesting` class (automatically added to `x-indicator` targets) to show loading spinners.
- **OOB Swaps**: Use `x-swap-oob="true"` on elements in your server response to update multiple parts of the page in a single request.

## Global Store

A robust central state management system for tabular or keyed data.

```javascript
import { createStore } from './basedom/store.js';

const store = createStore({
  values: { theme: 'light' },
  tables: { tasks: {} }
});

// Transactions batch multiple updates for efficiency
store.transaction(() => {
  store.setValue('theme', 'dark');
  store.setRow('tasks', 't1', { title: 'Fix Bug', done: false });
});

// Fine-grained listeners
store.addCellListener('tasks', 't1', 'done', (val) => {
  console.log('Task t1 status:', val);
});
```

### Advanced Store Features

- **Schemas**: Enforce types and default values for keyed data and tables.
- **Transactions**: Batch multiple updates to trigger listeners only once.
- **JSON Serialization**: Easily sync store state with `localStorage` or server APIs.
- **Computed Subsets**: Use `getSortedRowIds` to create reactive, sorted views of your data.

## Form Handling

Streamlined forms with built-in validation, state tracking, and UI helpers.

```html
<template>
  <div x-mount="setupForm">
    <div id="form-container"></div>
  </div>
</template>

<script setup>
import { Form, Field, Submit } from './basedom/form.js';
import { required, email } from './basedom/validation.js';
import { renderComponent } from './basedom/components.js';

const setupForm = (el) => {
  const myForm = Form({
    initialValues: { username: '', email: '' },
    validators: {
      username: [required('Username is required')],
      email: [required(), email('Invalid email address')]
    },
    onSubmit: async (values) => {
      console.log('Form submitted:', values);
    },
    children: [
      Field({ label: 'Username', name: 'username' }),
      Field({ label: 'Email', name: 'email', type: 'email' }),
      Submit('Register', { loadingText: 'Creating Account...' })
    ]
  });
  renderComponent(myForm, el.querySelector('#form-container'));
};
</script>
```

## Lifecycle Hooks

Hooks can be defined in scripts or directly on elements.

```html
<script setup>
import { onMount, onUnmount } from '../basedom/lifecycle.js';

onMount((el) => {
    const timer = setInterval(() => console.log('Tick'), 1000);
    onUnmount(() => clearInterval(timer));
});
</script>

<!-- Directive usage -->
<div x-mount="initChart" x-unmount="destroyChart"></div>
```

## API Reference

For the loading rules, see [docs/sfc.md](docs/sfc.md). For what is not done, see [docs/limitations.md](docs/limitations.md) and [docs/roadmap.md](docs/roadmap.md).

## Contributing

BaseDOM is an open-source project. Feel free to open issues or submit pull requests.
https://github.com/Named666/BaseDOM

## License

MIT
