# BaseDOM

BaseDOM is a lightweight, reactive JavaScript framework for building dynamic web applications without the complexity. Features signal-based reactivity, a declarative component architecture, and powerful directives—all with zero build setup required.

**No build step required.** BaseDOM works directly in the browser using native ES modules, making it incredibly fast to get started.

## Philosophy

The core philosophy of BaseDOM is to provide a developer experience that is:

-   **HTML-Centric:** Build components using familiar HTML syntax in Single-File Components (`.html`), enhanced with powerful template directives.
-   **Declarative & Reactive:** Describe your UI as a function of your state. The fine-grained reactivity system, powered by signals, automatically and efficiently updates the DOM when your state changes.
-   **Component-Based:** Structure your application into reusable, self-contained components, each with its own logic, template, and scoped styles.
-   **Progressively Adoptable:** Start small and scale up. Use it to sprinkle reactivity onto existing pages or build a full-fledged Single Page Application (SPA) with its built-in router and global state management.

## Key Features

-   🔄 **Signal-based Reactivity** - Fine-grained updates with `signal`, `computed`, and `effect`.
-   🧩 **Single-File Components** - Keep HTML, CSS, and JS in one file with `x-` directives.
-   🌐 **Declarative AJAX** - Load dynamic content with HTML attributes, similar to HTMX.
-   📱 **SPA Routing** - Nested routes, layouts, guards, and programmatic navigation.
-   훅 **Lifecycle Hooks** - Tap into component lifecycle with `onMount` and `onUnmount`.
-   🚀 **Zero Build Setup** - Works directly in the browser with ES modules.

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
      <div id="app"></div>
      <script type="module" src="app.js"></script>
    </body>
    </html>
    ```

3.  **Create your first component (`components/Counter.html`):**

    ```html
    <template>
      <div class="counter">
        <h1>{{ message }}</h1>
        <p>Count: {{ count }}</p>
        <p>Double: {{ doubleCount }}</p>
        <button x-on:click="increment">Increment</button>
        <input x-model="message">
      </div>
    </template>

    <script>
    import { signal, computed } from '../basedom/state.js';

    export default function(props) {
      const [count, setCount] = signal(0);
      const [message, setMessage] = signal('Hello, BaseDOM!');

      const doubleCount = computed(() => count() * 2);

      return {
        count,
        message,
        doubleCount,
        increment: () => setCount(count() + 1)
      };
    }
    </script>

    <style>
    .counter {
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

4.  **Create `app.js` to initialize the app:**

    ```javascript
    import { startApp } from './basedom/index.js';
    import { defineRoute } from './basedom/router.js';

    // Define a route that points to your component file
    defineRoute({
      path: '/',
      component: './components/Counter.html'
    });

    // Initialize the app in the '#app' element
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
-   `<style>`: The component's CSS. These styles are **automatically scoped** to the component.

### Reactivity (`state.js`)

BaseDOM's reactivity is powered by signals.

-   `signal(initialValue)`: Creates a reactive state container. It returns a tuple: `[getter, setter]`.
-   `computed(fn)`: Creates a read-only signal whose value is derived from other signals.
-   `effect(fn)`: Runs a function and automatically re-runs it whenever a signal it depends on changes.

### Template Syntax (Directives)

Directives are special `x-` attributes in your template that provide dynamic functionality.

| Directive | Description | Example |
| --- | --- | --- |
| `{{ expression }}` | Renders the result of a JavaScript expression as text. | `<p>{{ user.name.toUpperCase() }}</p>` |
| `x-if="condition"` | Conditionally renders an element. | `<div x-if="isLoggedIn">Welcome!</div>` |
| `x-else` | Renders if the preceding `x-if` was false. | `<div x-else>Please log in.</div>` |
| `x-for="item in items"` | Renders an element for each item in an array. | `<li x-for="todo in todos">{{ todo.text }}</li>` |
| `x-on:event="handler"` | Attaches an event listener. | `<button x-on:click="increment">+</button>` |
| `x-bind:attribute="expr"` | Binds an attribute to a dynamic value. | `<a x-bind:href="url">Link</a>` |
| `x-model="signal"` | Provides two-way data binding for form inputs. | `<input x-model="searchText">` |
| `x-show="condition"` | Toggles the element's `display` style. | `<div x-show="isVisible">...</div>` |

### Scoped Styling

Styles inside a `<style>` tag are automatically scoped. You can also target the component's root element itself using the `&` symbol.

```html
<style>
  /* This only applies to p tags inside this component */
  p { color: blue; }

  /* This styles the component's root element when it has the .active class */
  &.active { border: 1px solid blue; }
</style>
```

---

## API & Features

### Programmatic Components (`html.js`)

While SFCs are great for pages and large components, you can also create components programmatically using helper functions. This is useful for creating reusable, composable UI elements in JavaScript.

-   **Element Factories:** `html.js` exports functions for all standard HTML tags (`div`, `p`, `button`, etc.).
-   **Lifecycle Hooks:** Components can have `onMount` and `onUnmount` lifecycle hooks.

```javascript
import { div, p, button } from './basedom/html.js';
import { signal } from './basedom/state.js';

function ProgrammaticCounter() {
  const [count, setCount] = signal(0);

  return div({
    styles: `
      .counter { padding: 1rem; border: 1px solid #ccc; }
      p { color: green; }
    `,
    onMount: () => console.log('Counter mounted!'),
    onUnmount: () => console.log('Counter unmounted!'),
    children: [
      p({ children: ['Count: ', count] }),
      button({
        attrs: { 'x-on:click': () => setCount(count() + 1) },
        children: 'Increment'
      })
    ]
  });
}
```

### Keyed List Rendering

For efficiently rendering dynamic lists, use the `List` component. It performs keyed reconciliation, ensuring minimal DOM updates.

```javascript
import { List } from './basedom/html.js';
import { signal } from './basedom/state.js';

const [items, setItems] = signal([
  { id: 1, text: 'First' },
  { id: 2, text: 'Second' }
]);

const MyList = () => List(
  items, // The signal containing the array
  (item) => item.id, // The key function
  (item) => li({ children: item.text }) // The render function for each item
);
```

### Routing (`router.js`)

BaseDOM includes a file-based router with support for nesting, layouts, and navigation guards.

-   `defineRoute(config)`: Defines a route and its component.
-   `startRouter()`: Initializes the router (handled by `startApp`).
-   `navigate(path)`: Programmatically navigates to a new path.

**Layouts and Nested Routes:** A layout is a parent component that contains an `<div x-outlet="main"></div>`. Child routes are rendered inside this outlet.

### Form Handling (`form.js`)

BaseDOM provides a comprehensive solution for managing forms.

-   `createForm(config)`: Creates a form controller with state, validation, and submission logic.
-   `Form`, `Field`, `Submit`: Programmatic components to easily build forms.
-   `validation.js`: A set of common validation helpers (`required`, `minLength`, `email`, etc.).

**Example:**

```javascript
import { createForm, Form, Field, Submit } from './basedom/form.js';
import { required, email } from './basedom/validation.js';

function MyForm() {
  const form = createForm({
    initialValues: { email: '', password: '' },
    validators: {
      email: [required(), email()],
      password: [required()]
    },
    onSubmit: (values) => {
      alert(JSON.stringify(values));
    }
  });

  return Form({
    form,
    children: [
      Field({ name: 'email', label: 'Email' }),
      Field({ name: 'password', label: 'Password', type: 'password' }),
      Submit({ text: 'Log In' })
    ]
  });
}
```

### Global State (`createStore`)

For complex state shared between components, `createStore` provides a powerful global store with features like schemas, transactions, and fine-grained listeners.

**`store.js`**
```javascript
import { createStore } from './basedom/state.js';

export const store = createStore({
  values: {
    currentUser: null,
    theme: 'dark'
  },
  tables: {
    products: {
      'prod_1': { name: 'Laptop', price: 1200 },
      'prod_2': { name: 'Mouse', price: 25 }
    }
  }
});
```

The store API provides methods like `getValue`, `setValue`, `getRow`, `setRow`, `transaction`, and dozens of listeners (`addValueListener`, `addRowListener`, etc.) for surgical state updates.

### Declarative AJAX

Fetch content from the server and update the DOM without writing any JavaScript.

| Directive | Description |
| --- | --- |
| `x-get="url"` | Makes a GET request to the URL. |
| `x-post="url"` | Makes a POST request (often used on a `<form>`). |
| `x-trigger="event"` | The event that triggers the request (e.g., `click`, `load`, `submit`). |
| `x-target="selector"` | A CSS selector for the element to be updated. Defaults to the element itself. |
| `x-swap="method"` | How to update the target: `innerHTML`, `outerHTML`, `append`, `prepend`, etc. |
| `x-select="selector"`| Selects a portion of the HTML response to use for the swap. |

---

## Contributing

We welcome contributions! Please feel free to open an issue or submit a pull request on our [GitHub repository](https://github.com/Named666/BaseDOM).

### TODO & Roadmap

-   [ ] **Declarative Component Imports & Nesting:** The ability to import an SFC into another and use it as a custom tag (e.g., `<MyComponent>`).
-   [ ] **Transitions:** Add `x-transition` directives for simple CSS transitions.
-   [ ] **CLI Tool:** A command-line tool for scaffolding new projects and components.
-   [ ] **Cookbook:** Create a "cookbook" section with recipes for common patterns.
-   [ ] **Testing:** Expand the test suite to cover all directives and core functionalities.
