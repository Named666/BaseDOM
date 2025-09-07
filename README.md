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
- Scroll Behavior: Custom scroll on navigation.
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
  <Child>
    <div x-slot="header">{{ user.name }}</div>
    <p>Default content</p>
  </Child>
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

- `x-get`, `x-post`: Requests
- `x-target`, `x-swap`, `x-select`: Update DOM

Example:

```html
<button x-get="/api/data" x-target="#result" x-swap="innerHTML">Load Data</button>
<div id="result"></div>
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

Open issues/PRs on GitHub.

## TODO & Roadmap

- Transitions
- CLI Tool
- Cookbook