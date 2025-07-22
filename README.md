# BaseDOM

BaseDOM is A lightweight, reactive JavaScript framework for building dynamic web applications without the complexity. Features signal-based reactivity, component architecture, and powerful directives - all with zero build setup required.

**No build step required.** BaseDOM works directly in the browser using native ES modules, making it incredibly fast to get started.

## Philosophy

The core philosophy of BaseDOM is to provide a developer experience that is:

-   **HTML-Centric:** Build components using familiar HTML syntax, enhanced with powerful template directives. The Single-File Component (SFC) approach is the heart of the framework.
-   **Declarative & Reactive:** Describe your UI as a function of your state. The fine-grained reactivity system, powered by signals, automatically and efficiently updates the DOM when your state changes.
-   **Component-Based:** Structure your application into reusable, self-contained components, each with its own logic, template, and scoped styles.
-   **Progressively Adoptable:** Start small and scale up. Use it to sprinkle reactivity onto existing pages or build a full-fledged Single Page Application (SPA) with its built-in router and global state management.

## Key Features

- 🔄 **Signal-based Reactivity** - Fine-grained updates with automatic dependency tracking
- 🧩 **Single-File Components** - HTML, CSS, and JS in one file with `x-` directives
- 🌐 **HTMX-like Fetch Directives** - Dynamic content loading without JavaScript
- 📱 **SPA Routing** - Nested routes, guards, and lazy loading
- 📝 **Form Handling** - Built-in validation and state management
- 🚀 **Zero Build Setup** - Works directly in the browser with ES modules

---

## Getting Started

1.  **Download or Clone:** Get the `basedom` directory into your project.
2.  **Create `index.html`:** This is your application's entry point.

    ```html
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>BaseDOM App</title>
    </head>
    <body>
      <!-- Your app will be rendered here -->
      <div id="app"></div>
      <!-- Import your main app script -->
      <script type="module" src="app.js"></script>
    </body>
    </html>
    ```

3.  **Create your first component (`components/HelloWorld.html`):**

    ```html
    <template>
      <div class="greeting">
        <h1>{{ message }}</h1>
        <input x-bind:value="message" x-on:input="updateMessage">
      </div>
    </template>

    <script>
    import { signal } from '../basedom/state.js';

    export default function(props) {
      const [message, setMessage] = signal('Hello, BaseDOM!');

      return {
        message,
        updateMessage: (e) => setMessage(e.target.value)
      };
    }
    </script>

    <style>
    .greeting {
      padding: 2rem;
      border: 1px solid #eee;
      border-radius: 8px;
      text-align: center;
    }
    input {
      margin-top: 1rem;
      padding: 0.5rem;
    }
    </style>
    ```

4.  **Create `app.js` to initialize the router:**

    ```javascript
    import { initialize } from './basedom/render.js';
    import { defineRoute, startRouter } from './basedom/router.js';

    // Define a route that points to your component file
    defineRoute({
      path: '/',
      component: './components/HelloWorld.html'
    });

    // Initialize the app in the '#app' element and start the router
    startApp('#app');
    ```

5.  **Serve your project:** Use any simple web server.

    ```bash
    # If you have Python installed
    python -m http.server

    # Or with Node.js
    npx serve .
    ```

---

## Core Concepts

### Single-File Components (SFCs)

Components are `.html` files composed of three optional sections:

-   `<template>`: The HTML structure of your component.
-   `<script>`: The component's logic, written in JavaScript. It must have a `default export` that is a function. This function's return value (an object) exposes data and methods to the template.
-   `<style>`: The component's CSS. These styles are **automatically scoped** to the component, meaning they won't leak out and affect other elements.

### Reactivity (`state.js`)

BaseDOM's reactivity is powered by signals.

-   `signal(initialValue)`: Creates a reactive state container. It returns a tuple: `[getter, setter]`. Call the getter `mySignal()` to get the value, and the setter `setMySignal(newValue)` to update it.
-   `computed(fn)`: Creates a read-only signal whose value is derived from other signals. It re-evaluates automatically when its dependencies change.
-   `effect(fn)`: Runs a function and automatically re-runs it whenever a signal it depends on changes. Useful for side effects like logging or fetching data.

### Template Syntax (Directives)

Directives are special `x-` attributes in your template that provide dynamic functionality.

| Directive                 | Description                                                                                             | Example                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `{{ expression }}`        | Renders the value of `expression` from the script block as text.                                        | `<p>{{ user.name }}</p>`                                |
| `x-if="condition"`        | Conditionally renders an element. Must be paired with a truthy/falsy value from the script.             | `<div x-if="isLoggedIn">Welcome back!</div>`             |
| `x-else`                  | Renders if the preceding `x-if` was false.                                                              | `<div x-else>Please log in.</div>`                       |
| `x-for="item in items"`   | Renders an element for each item in an array. `item` and `itemIndex` are available in the loop.         | `<li x-for="todo in todos">{{ todo.text }}</li>`         |
| `x-on:event="handler"`    | Attaches an event listener. `x-on:click`, `x-on:submit`, etc.                                           | `<button x-on:click="increment">+</button>`              |
| `x-bind:attribute="expr"` | Binds an element attribute to a dynamic value.                                                          | `<a x-bind:href="user.profileUrl">Profile</a>`           |
| `x-show="condition"`      | Toggles the element's `display` style instead of adding/removing it.                                    | `<div x-show="isVisible">...</div>`                      |

### Scoped Styling

Styles inside a `<style>` tag are automatically scoped. You can also target the component's root element itself using the `&` symbol.

```html
<style>
  /* This only applies to p tags inside this component */
  p {
    color: blue;
  }

  /* This styles the component's root element when it has the .active class */
  &.active {
    border: 1px solid blue;
  }
</style>
```

---

## API & Features

### Routing (`router.js`)

BaseDOM includes a file-based router with support for nesting, layouts, and navigation guards.

-   `defineRoute(config)`: Defines a route and its component.
-   `startRouter()`: Initializes the router and listens for URL changes.
-   `navigate(path)`: Programmatically navigates to a new path.

**Layouts and Nested Routes:**

A layout is a parent component that contains an `<div x-outlet="main"></div>`. Child routes are rendered inside this outlet.

**`layouts/AdminLayout.html`**
```html
<template>
  <div class="admin-area">
    <aside>
      <a href="/admin/dashboard" x-link>Dashboard</a>
      <a href="/admin/settings" x-link>Settings</a>
    </aside>
    <main x-outlet="main">
      <!-- Admin child routes render here -->
    </main>
  </div>
</template>
```

**`router.js`**
```javascript
defineRoute({
  path: '/admin',
  component: './layouts/AdminLayout.html',
  children: [
    { path: '/dashboard', component: './pages/AdminDashboard.html' },
    { path: '/settings', component: './pages/AdminSettings.html' }
  ]
});
```

### Global State (`createStore`)

For complex state shared between many components, `createStore` provides a robust global store.

**`store.js`**
```javascript
import { createStore } from './basedom/state.js';

export const store = createStore({
  // Simple key-value data
  values: {
    currentUser: null,
    theme: 'dark'
  },
  // Structured, table-like data
  tables: {
    products: {
      'prod_1': { name: 'Laptop', price: 1200 },
      'prod_2': { name: 'Mouse', price: 25 }
    }
  }
});
```

You can then import and use this `store` object anywhere in your application to get or set global state.

### Declarative AJAX

Fetch content from the server and update the DOM without writing any JavaScript.

| Directive           | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `x-get="url"`       | Makes a GET request to the URL.                                          |
| `x-post="url"`      | Makes a POST request (often used on a `<form>`).                         |
| `x-trigger="event"` | The event that triggers the request (e.g., `click`, `load`, `submit`).   |
| `x-target="selector"` | A CSS selector for the element to be updated. Defaults to the element itself. |
| `x-swap="method"`   | How to update the target: `innerHTML`, `outerHTML`, `append`, `prepend`, etc. |
| `x-select="selector"`| Selects a portion of the HTML response to use for the swap.              |

**Example:**
```html
<!-- When this button is clicked, it fetches /api/items and replaces the content of #item-list -->
<button x-get="/api/items" x-target="#item-list" x-swap="innerHTML">
  Refresh Items
</button>

<ul id="item-list">
  <!-- Content will be loaded here -->
</ul>
```

### Component Composition & Nesting

In BaseDOM, component nesting is primarily handled by the router, which is ideal for creating page layouts.

-   **Router-Outlet Pattern:** A parent route's component (a "layout") contains an element with an `x-outlet` attribute. When a child route is active, its component is rendered inside this outlet. This is the standard way to nest page-level components.

-   **Declarative Nesting (Future Goal):** Currently, you cannot directly import one SFC and use it as a custom tag inside another SFC's template (e.g., having a `<Card>` component and using `<Card></Card>` in another file). The parser will treat `<Card>` as a standard, unknown HTML tag. This is a high-priority feature on the roadmap.

---

## Contributing

We welcome contributions from the community! Whether it's a bug report, a new feature, or improvements to the documentation, your help is appreciated. Please feel free to open an issue or submit a pull request on our [GitHub repository](https://github.com/Named666/BaseDOM).

### TODO & Roadmap

Here are some areas where BaseDOM could be improved. Contributions are welcome!

**High Priority:**
-   [ ] **Declarative Component Imports & Nesting:** The ability to import an SFC into another and use it as a custom tag (e.g., `<MyComponent>` from `components\my-component.html`). This is the most requested feature for building complex UIs.

**Features & Enhancements:**
-   [ ] **SFC Lifecycle Hooks:** Implement a way to define `onMount` and `onUnmount` directly in the `<script>` block of an SFC.
-   [ ] **Keyed List Rendering:** Enhance `x-for` to support a `:key` attribute (`x-for="item in items" :key="item.id"`) for more efficient DOM updates.
-   [ ] **Props/Attributes Passing:** Improve how props are passed to child components declaratively in the template.
-   [ ] **Transitions:** Add `x-transition` directives for simple CSS transitions on elements entering or leaving the DOM via `x-if`.

**Tooling & DX:**
-   [ ] **CLI Tool:** A command-line tool for scaffolding new projects and components.

**Documentation & Testing:**
-   [ ] **Cookbook:** Create a "cookbook" section with recipes for common patterns (e.g., connecting `createStore` to component signals).
-   [ ] **Unit & E2E Tests:** Expand the test suite to cover all directives and core functionalities.
-   [ ] **API Documentation:** Generate detailed API documentation for every exported function.