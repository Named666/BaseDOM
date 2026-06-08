# BaseDOM

BaseDOM is a lightweight, reactive JavaScript framework for building dynamic web applications without build setup. It features signal-based reactivity, declarative components, and powerful directives using native ES modules.

## Philosophy

- **HTML-Centric:** Build with familiar HTML syntax in Single-File Components (.html).
- **Declarative & Reactive:** UI as a function of state with fine-grained reactivity.
- **Component-Based:** Reusable, self-contained components.
- **Progressively Adoptable:** Start small, scale up.
- **Zero Build Setup:** Run directly in the browser using ES modules.

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

3. Create a component `components/Counter.html`:

   ```html
   <template>
     <div class="counter">
       <h1>{{ message }}</h1>
       <p>Count: {{ count }}</p>
       <button @click="increment">Increment</button>
       <input x-model="message">
     </div>
   </template>

   <script setup>
   import { signal } from '../basedom/state.js';

   const [count, setCount] = signal(0);
   const [message, setMessage] = signal('Hello, BaseDOM!');

   const increment = () => setCount(count() + 1);
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

#### `<script setup>` Mode
Top-level variables are automatically exposed to the template.

```html
<script setup>
import { signal } from './basedom/state.js';
const [name, setName] = signal('World');
function greet() { alert(`Hello ${name()}!`); }
</script>

<template>
  <button @click="greet">Greet {{ name }}</button>
</template>
```

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

For a full list of exported functions and detailed API documentation, see [Reference.md](./Reference.md).

## Contributing

BaseDOM is an open-source project. Feel free to open issues or submit pull requests.
https://github.com/Named666/BaseDOM

## License

MIT
