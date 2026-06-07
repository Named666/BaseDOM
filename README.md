# BaseDOM

BaseDOM is a lightweight, reactive JavaScript framework for building dynamic web applications without build setup. Features signal-based reactivity, declarative components, and powerful directives using native ES modules.

## Philosophy

- **HTML-Centric:** Build with familiar HTML syntax in Single-File Components (.html).
- **Declarative & Reactive:** UI as function of state with fine-grained reactivity.
- **Component-Based:** Reusable, self-contained components.
- **Progressively Adoptable:** Start small, scale up.

## Key Features

- Signal-based Reactivity: `signal`, `computed`, `effect`.
- Single-File Components: HTML, CSS, JS in one file with scoped styles.
- Component Composition: Nest components declaratively.
- Lifecycle Hooks: `onMount`, `onUnmount`, `onUpdate`.
- Declarative AJAX: Load content with HTML attributes.
- SPA Routing: Nested routes, guards, navigation.
- Zero Build Setup: ES modules in browser.
- Global State: Powerful store for complex state.
- Navigation Guards: Protect routes.
- Link Interception: Automatic SPA navigation.

## Getting Started

1. Download or clone the `basedom` directory.
2. Create `index.html`:

   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <title>BaseDOM App</title>
   </head>
   <body>
     <div id="app"></div>
     <script type="module" src="app.js"></script>
   </body>
   </html>
   ```

3. Create component `components/Counter.html`:

   ```html
   <template>
     <div class="counter">
       <h1>{{ message }}</h1>
       <p>Count: {{ count }}</p>
       <button x-on:click="increment">Increment</button>
       <input x-model="message">
     </div>
   </template>

   <script>
   import { signal } from '../basedom/state.js';

   export default function() {
     const [count, setCount] = signal(0);
     const [message, setMessage] = signal('Hello, BaseDOM!');

     return {
       count,
       message,
       increment: () => setCount(count() + 1)
     };
   }
   </script>

   <style>
   .counter { padding: 2rem; border: 1px solid #eee; border-radius: 8px; text-align: center; }
   input { margin-top: 1rem; padding: 0.5rem; }
   </style>
   ```

4. Create `app.js`:

   ```javascript
   import { startApp } from './basedom/index.js';
   import { defineRoute } from './basedom/router.js';

   defineRoute({ path: '/', component: './components/Counter.html' });
   startApp('#app');
   ```

5. Serve with `python -m http.server` or `npx serve .`.

## Core Concepts

### Single-File Components

Components are .html files with `<template>`, `<script>`, `<style>` sections. Styles are scoped.

#### `<script setup>` Mode

Concise way to write logic. Top-level variables are exposed to template.

```html
<template>
  <div>
    <p>Count: {{ count }}</p>
    <button @click="increment">+</button>
  </div>
</template>

<script setup>
const [count, setCount] = signal(0);
function increment() { setCount(count() + 1); }
</script>
```

### Component Composition

Use custom tags. Pass props with `:prop="value"`, events with `@event="handler"`.

Example:

```html
<!-- Parent -->
<template>
  <MyComponent :title="'Hello'" @click="handleClick"></MyComponent>
</template>

<!-- MyComponent.html -->
<template>
  <h1>{{ title }}</h1>
  <button @click="$emit('click')">Click me</button>
</template>
```

### Slots

- Default: `<slot></slot>`
- Named: `<slot name="name"></slot>`, use `x-slot="name"`
- Slot props: `<slot :prop="value"></slot>`, access in parent.

Example:

```html
<!-- Child -->
<template>
  <slot name="header" :user="currentUser"></slot>
  <slot></slot>
</template>

<!-- Parent -->
<template>
    <div x-slot="header">{{ user.name }}</div>
    <p>Default content</p>
</template>
```

### Reactivity

- `signal(initial)`: [getter, setter]
- `computed(fn)`: Derived signal
- `effect(fn)`: Side effects

Example:

```javascript
const [count, setCount] = signal(0);
const double = computed(() => count() * 2);
effect(() => console.log('Count changed:', count()));
```

### Template Syntax

- `{{ expr }}`: Text interpolation
- `x-if`, `x-else`: Conditional
- `x-for`: Loop
- `x-on`/`@`: Events
- `x-bind`/`:`: Attributes
- `x-model`: Two-way binding
- `x-show`: Visibility

Examples:

```html
<div x-if="isVisible">Show me</div>
<div x-else>Hidden</div>

<ul>
  <li x-for="item in items">{{ item.name }}</li>
</ul>

<button @click="increment">Click</button>
<input x-model="searchText">
<div x-show="loading">Loading...</div>
```

## API & Features

### Lifecycle Hooks

- `onMount(element)`: Setup
- `onUnmount()`: Cleanup
- `onUpdate()`: On re-render

Use in script or with `x-mount`, etc.

Example:

```html
<script>
export default function() {
  const onMount = (el) => console.log('Mounted');
  return { onMount };
}
</script>
```

### Programmatic Components

Use `html.js` factories like `div({ children: [...] })`

Example:

```javascript
import { div, button } from './basedom/html.js';

function Counter() {
  const [count, setCount] = signal(0);
  return div({
    children: [
      button({ onClick: () => setCount(count() + 1) }, 'Increment'),
      'Count: ' + count()
    ]
  });
}
```

### Routing

- `defineRoute({ path, component, children })`
- Guards: `guards: { beforeEnter: [fn] }`
- Navigation: `navigate(path)`
- Params: `$route.params`

Example:

```javascript
defineRoute({
  path: '/user/:id',
  component: './User.html',
  guards: {
    beforeEnter: (to, from) => {
      if (!loggedIn) return '/login';
    }
  }
});
```


- `createForm(config)`: State, validation
- `Form`, `Field`, `Submit`: Components
- Validators: `required`, `email`, etc.

### Global State

`createStore({ values, tables })`: Methods like `getValue`, `setValue`, transactions.

Example:

```javascript
const store = createStore({
  values: { user: null },
  tables: { products: {} }
});
store.setValue('user', { name: 'John' });
```

### Declarative AJAX

The fetch directives (`x-get`, `x-post`, `x-put`, `x-patch`, `x-delete`) build requests but delegate response handling to the framework's central utilities (`fetchAndSwap`, `parseComponent`, and `renderComponent`). This keeps request logic lightweight while reusing the parser, component rendering, and lifecycle systems.

Key directive attributes:
- `x-get`, `x-post`, `x-put`, `x-patch`, `x-delete`: request URL (method implied by attribute)
- `x-target`: a CSS selector or the literal `this` to render into the triggering element
- `x-swap`: swap style (innerHTML, outerHTML, textContent, delete, none, insert positions, etc.)
- `x-select`: narrow the returned fragment to a selector before swapping
- `x-select-oob`: swap out-of-band ids from the response
- `x-params`, `x-include`, `x-vals`, `x-encoding`: request body/params controls and encoding (JSON/FormData)
- `x-headers`: custom headers (JSON or semicolon/key:value format)
- `x-indicator`: selector(s) for an indicator element — the class `x-requesting` is toggled while the request is running
- `x-timeout`: abort the request after N milliseconds
- `x-confirm`: confirmation expression or message
- `x-push-url`, `x-replace-url`: update browser history after a successful response

Behavior notes:
- The directive handles building the request (method, headers, body, timeout, confirmation) and then calls `fetchAndSwap` which performs the network request and swaps content.
- `fetchAndSwap` will try to parse the response as a BaseDOM component via `parseComponent`; if parsing succeeds the returned component function is rendered into the target using the same component lifecycle and `renderComponent` APIs (so `onMount`/`onUnmount` and scoped styles work as expected).
- If parsing fails, `fetchAndSwap` falls back to a raw HTML swap via the existing `applyRawHtmlSwapToTarget` logic.
- Use `x-target="this"` when you want the returned component to render into the element that triggered the fetch.
- Use `x-select` / `x-select-oob` to restrict which part of the response is used for the swap; out-of-band (OOB) elements annotated with `x-swap-oob` are handled globally.

Example:

```html
<button x-get="/api/data" x-target="#result" x-swap="innerHTML" x-indicator="#spinner">Load Data</button>
<div id="spinner" class="indicator"></div>
<div id="result"></div>
```

More details and best practices
------------------------------

- Server responses:
  - The response body may be plain HTML, a fragment, or a BaseDOM single-file component (.html containing `<template>`, optional `<script>` and `<style>`). `fetchAndSwap` attempts to parse the response with `parseComponent` first; if parsing succeeds the returned component function is rendered via `renderComponent` (preserving lifecycle hooks and scoped styles). If parsing fails, the response is treated as raw HTML and swapped using `applyRawHtmlSwapToTarget`.

- Writing server-returned components:
  - Return a full BaseDOM component when you want the server to provide a self-contained UI fragment. Example:

```html
<template>
  <div class="message">Hello from server: {{ data }}</div>
</template>
<script>
export default function(props) {
  return { data: props.data || 'n/a' };
}
</script>
```

- Request/body formats:
  - `x-encoding="json"` forces JSON encoding for non-GET requests. When encoding is `json`, `x-params` may be a JSON string or the server-supplied string will be parsed when possible.
  - `x-params` may be a URL-encoded string (`a=1&b=2`) or an expression/object. For GET requests `x-params` is appended to the query string.
  - `x-include` accepts a selector to include named inputs from the DOM (useful to pick up form fields outside the triggering element).
  - `x-vals` is evaluated in the component context when present; you can pass reactive values such as `x-vals="{ foo: someSignal }"` and they will be serialized into the request body (or merged into JSON body when `x-encoding=json`).

- Headers parsing:
  - `x-headers` accepts a JSON string (e.g. `{"X-Token":"abc"}`), an object expression, or a semicolon/newline separated list like `X-Token: abc; Accept: application/json`.

- Indicator and timeout:
  - `x-indicator` takes a selector (or comma-separated selectors) and the directive toggles the `x-requesting` class on matching elements while the request is active.
  - `x-timeout` aborts the request after the specified milliseconds using `AbortController`.

- Swap strategies and modifiers:
  - `x-swap` accepts styles like `innerHTML`, `outerHTML`, `textContent`, `delete`, and insert positions (`beforebegin`, `afterbegin`, `beforeend`, `afterend`).
  - You may also supply modifiers such as `swap:200ms` and `settle:100ms` in the same string (e.g. `x-swap="innerHTML swap:200ms settle:100ms transition:true"`). These modifiers control swap/settle delays and view transitions.
  - `preserve` behavior is supported when rendering BaseDOM components: the implementation uses `preserveAndSwap` and `renderComponent` so child components keep their lifecycle where appropriate.

- Targeting and routing:
  - `x-target="this"` renders the response into the element that triggered the fetch.
  - `x-target` can be any selector to render into a different element on the page.
  - `x-push-url` and `x-replace-url` handle history updates. Use `true` to push/replace with the request URL, or provide a string URL to push/replace with a different URL.

- Selecting fragments and OOB swaps:
  - `x-select` narrows the response to the first matching selector in the returned fragment before swapping.
  - `x-select-oob` can be used to swap specific ids out-of-band (e.g. `x-select-oob="#nav,#footer:outerHTML"`). The server may emit elements with `x-swap-oob` which are handled globally by the client.

- Confirmation and triggers:
  - `x-confirm` may be an expression evaluated in the component context. If it returns a string it will be shown as a `window.confirm` message; returning `false` aborts the action.
  - `x-trigger` customizes the event that initiates the fetch (default is `click`, or `submit` for forms on non-GET).

- Lifecycle and component rendering:
  - Because the fetch pipeline uses `parseComponent` + `renderComponent` when possible, server-provided components participate in the same lifecycle system as local components (`onMount`, `onUnmount`, `onUpdate`), and scoped `<style>` blocks are applied via `handleScopedStyles`.

Debugging tips
--------------

- If a fetched fragment isn't rendering as a component, check browser console logs: parse errors are caught and the fallback raw-swap path is used.
- Inspect the network request to confirm headers/body shape; the directive builds `Content-Type` when `x-encoding=json` is used.
- To test component parsing locally, return a small `.html` snippet from your server and verify `renderComponent` runs (you should see `onMount` hooks fire for any mounted nodes).

Small example (server returns a BaseDOM component):

```html
<button x-get="/component/TestComponent.html" x-target="#outlet" x-swap="innerHTML">Load Component</button>
<div id="outlet"></div>
```

Server response (TestComponent.html):

```html
<template>
  <div>Hello from server component: {{ name }}</div>
</template>
<script>
export default function(props) { return { name: props.name || 'guest' }; }
</script>
```

### Navigation Guards

- Global: `addGlobalBeforeEnterGuard(fn)`
- Route-specific: In `defineRoute`

Example:

```javascript
addGlobalBeforeEnterGuard((to, from) => {
  if (!auth) return '/login';
});
```

### Scroll Behavior

Define in route: `scrollBehavior: (context) => options`

Example:

```javascript
defineRoute({
  path: '/page',
  scrollBehavior: () => ({ top: 0, behavior: 'smooth' })
});
```

### Link Interception

Automatic for links with `x-link` or same origin.

Example:

```html
<a href="/about">About</a> <!-- Intercepted -->
```

## Contributing

Open issues/PRs on GitHub for bugs, features, docs.
https://github.com/Named666/BaseDOM

## TODO & Roadmap

- Transitions
- CLI Tool
- Cookbook