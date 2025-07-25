# BaseDOM
[//] Table of Contents

1. [Introduction](#introduction)
2. [Philosophy](#philosophy)
3. [Key Features](#key-features)
4. [Getting Started](#getting-started)
5. [Core Concepts](#core-concepts)
6. [API & Features](#api--features)
    - [Lifecycle Hooks](#lifecycle-hooks-lifecyclejs)
    - [Programmatic Components](#programmatic-components-htmljs)
    - [Routing](#routing-routerjs)
    - [Form Handling](#form-handling-formjs--validationjs)
    - [Global State](#global-state-createstore)
    - [Declarative AJAX](#declarative-ajax)
7. [Contributing](#contributing)
8. [TODO & Roadmap](#todo--roadmap)


BaseDOM is a lightweight, reactive JavaScript framework for building dynamic web applications without the complexity. It features signal-based reactivity, a declarative component architecture, and powerful directives—all with zero build setup required.

**No build step required.** BaseDOM works directly in the browser using native ES modules, making it incredibly fast to get started.

## Philosophy

The core philosophy of BaseDOM is to provide a developer experience that is:

-   **HTML-Centric:** Build components using familiar HTML syntax in Single-File Components (`.html`), enhanced with powerful template directives.
-   **Declarative & Reactive:** Describe your UI as a function of your state. The fine-grained reactivity system, powered by signals, automatically and efficiently updates the DOM when your state changes.
-   **Component-Based:** Structure your application into reusable, self-contained components, each with its own logic, template, and scoped styles.
-   **Progressively Adoptable:** Start small and scale up. Use it to sprinkle reactivity onto existing pages or build a full-fledged Single Page Application (SPA) with its built-in router and global state management.

## Key Features

-   **Signal-based Reactivity**: Fine-grained updates with `signal`, `computed`, and `effect`.
-   **Single-File Components**: Keep HTML, CSS, and JS in one file with automatic style scoping.
-   **Lifecycle Hooks**: Tap into the component lifecycle with `onMount`, `onUnmount`, and `onUpdate`.
-   **Declarative AJAX**: Load dynamic content with HTML attributes, similar to HTMX.
-   **SPA Routing**: Nested routes, layouts, guards, and programmatic navigation.
-   **Zero Build Setup**: Works directly in the browser with ES modules.
-   **Global State Management**: A powerful global store for managing complex application state.
-   **Scoped Styling**: Automatic style scoping for components.
-   **And much more!**

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

      const onMount = (element) => {
        console.log('Counter mounted!', element);
      };

      const onUnmount = () => {
        console.log('Counter unmounted!');
      };

      return {
        count,
        message,
        doubleCount,
        increment: () => setCount(count() + 1),
        onMount,
        onUnmount
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

BaseDOM's reactivity is powered by signals. Signals are functions that hold a value and notify their dependents when that value changes.

-   `signal(initialValue)`: Creates a reactive state container. It returns a tuple: `[getter, setter]`. Call the getter `mySignal()` to get the value, and the setter `mySignal(newValue)` to update it.
-   `computed(fn)`: Creates a read-only signal whose value is derived from other signals. It re-calculates its value automatically when its dependencies change.
-   `effect(fn)`: Runs a function and automatically re-runs it whenever a signal it depends on changes. Useful for side effects like logging, data fetching, or manual DOM manipulation. Returns a `dispose` function to stop the effect.

### Template Syntax (Directives)

Directives are special `x-` attributes in your template that provide dynamic functionality.

| Directive | Description | Example |
| --- | --- | --- |
| `{{ expression }}` | Renders the result of a JavaScript expression as text. Reactively updates. | `<p>{{ user.name.toUpperCase() }}</p>` |
| `x-if="condition"` | Conditionally renders an element from the DOM. | `<div x-if="isLoggedIn">Welcome!</div>` |
| `x-else` | Renders if the preceding `x-if` was false. | `<div x-else>Please log in.</div>` |
| `x-for="item in items"` | Renders an element for each item in an array. Supports `(item, index)`. | `<li x-for="todo in todos">{{ todo.text }}</li>` |
| `x-on:event="handler"` | Attaches an event listener. Shorthand: `@event`. | `<button x-on:click="increment">+</button>` |
| `x-bind:attribute="expr"` | Binds an attribute to a dynamic value. Shorthand: `:attribute`. | `<a x-bind:href="url">Link</a>` |
| `x-model="signalName"` | Provides two-way data binding for form inputs. | `<input x-model="searchText">` |
| `x-show="condition"` | Toggles the element's `display` style between `''` and `'none'`. | `<div x-show="isVisible">...</div>` |
| `x-mount`, `x-unmount`, `x-update` | Attach lifecycle hooks directly in the template. | `<div x-mount="onMountHandler"></div>` |

### Scoped Styling

Styles inside a `<style>` tag in an SFC are automatically scoped to that component. This prevents styles from leaking out and affecting other parts of your application. You can also target clethe component's root element itself using the `&` symbol.

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

### Lifecycle Hooks (`lifecycle.js`)

BaseDOM provides a powerful and consistent lifecycle system to manage side effects, initialization, and cleanup logic for your components and elements.

There are three main hooks:

-   `onMount(element)`: Called when an element is added to the DOM. Ideal for setup, data fetching, or initializing third-party libraries.
-   `onUnmount()`: Called just before an element is removed from the DOM. Crucial for cleanup to prevent memory leaks (e.g., clearing intervals, removing event listeners).
-   `onUpdate()`: Called when a component's reactive state causes it to re-render. Useful for logic that needs to run on every update.

You can use these hooks in several ways:

**1. In Programmatic Components**

Pass them as properties when creating elements with the `html.js` factories.

```javascript
import { div } from './basedom/html.js';

function MyComponent() {
  return div({
    onMount: (element) => console.log('Mounted!', element),
    onUnmount: () => console.log('Unmounted!'),
    children: 'Hello, World!'
  });
}
```

**2. In Single-File Components (SFCs)**

You have two options in SFCs:

*   **Component-Level Hooks:** Return `onMount`, `onUnmount`, or `onUpdate` from your component's `<script>` function. This applies the hooks to the component's root element.

    ```html
    <script>
    export default function() {
      const onMount = (element) => {
        console.log('Component mounted:', element);
      };
      return { onMount };
    }
    </script>
    ```

*   **Template-Level Directives:** For more granular control, attach hooks to any element within your template using the `x-mount`, `x-unmount`, and `x-update` directives.

    ```html
    <template>
      <div x-mount="onDivMount">I have a mount hook.</div>
      <button x-mount="onButtonMount">I also have one!</button>
    </template>
    <script>
    export default function() {
      return {
        onDivMount: (el) => console.log('Div mounted'),
        onButtonMount: (el) => console.log('Button mounted')
      };
    }
    </script>
    ```

**Best Practices:**

-   **Always Clean Up:** Anything you set up in `onMount` (like timers or event listeners) should be torn down in `onUnmount`.
-   **Third-Party Libraries:** `onMount` is the perfect place to initialize a non-reactive library (like a chart or map), and `onUnmount` is where you should destroy it.
-   **Composition:** The framework automatically handles multiple hooks. If you have an `onMount` at the component level and another `x-mount` on an element inside, both will be called correctly.

### Programmatic Components (`html.js`)

While SFCs are great, you can also create components programmatically in JavaScript. This is useful for creating reusable, composable UI elements.

-   **Element Factories:** `html.js` exports functions for all standard HTML tags (`div`, `p`, `button`, etc.).

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
    onMount: (element) => console.log('Counter mounted!', element),
    onUnmount: () => console.log('Counter unmounted!'),
    children: [
      p({}, 'Count: ', count), // Pass signals directly as children
      button({
        onClick: () => setCount(count() + 1) // Event handlers can be passed directly
      }, 'Increment')
    ]
  });
}
```

### Routing (`router.js`)

BaseDOM includes a powerful file-based router supporting:

- Nested routes and layouts
- Route guards (sync/async)
- Programmatic navigation
- Route meta fields
- Dynamic parameters

#### Basic SPA Routing Example

```javascript
import { startApp } from './basedom/index.js';
import { defineRoute } from './basedom/router.js';

defineRoute({
  path: '/',
  component: './layouts/MainLayout.html', // Layout with <div x-outlet></div>
  children: [
    { path: '/', component: './pages/Home.html' },
    { path: '/about', component: './pages/About.html' },
    { path: '/profile/:userId', component: './pages/Profile.html' },
    { path: '/login', component: './pages/Login.html' }
  ]
});

startApp('#app');
```

#### Layouts & Nested Routes

`MainLayout.html`:
```html
<template>
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/profile/42">Profile</a>
  </nav>
  <div x-outlet></div>
</template>
<script>
export default function() {
  return {};
}
</script>
```

#### Route Guards Example

Route guards are functions that are executed before a route is entered or left. They can be used to protect routes, redirect users, or perform other actions.

```javascript
import { defineRoute, navigate } from './basedom/router.js';
import { store } from './store.js'; // Assuming you have a global store

// This guard checks if a user is authenticated before allowing access to a route.
function authGuard(to, from) {
  if (!store.getValue('currentUser')) {
    // If the user is not logged in, redirect to the login page.
    navigate('/login');
    return false; // Cancel the navigation
  }
  return true; // Allow the navigation
}

defineRoute({
  path: '/dashboard',
  component: './pages/Dashboard.html',
  guards: {
    beforeEnter: [authGuard]
  },
  meta: { requiresAuth: true }
});
```

#### Async Guards Example

Guards can also be asynchronous, allowing you to perform actions like fetching data before a route is rendered.

```javascript
async function adminGuard(to, from) {
  const user = await store.getValue('currentUser');
  if (!user || !user.isAdmin) {
    navigate('/');
    return false;
  }
  return true;
}

defineRoute({
  path: '/admin',
  component: './pages/Admin.html',
  guards: {
    beforeEnter: [adminGuard]
  }
});
```

#### Programmatic Navigation

You can navigate programmatically using the `navigate` function.

```javascript
import { navigate } from './basedom/navigation.js';

// In a component method
function goToProfile(id) {
  navigate(`/profile/${id}`);
}
```

#### Dynamic Parameters

In `Profile.html`:
```html
<template>
  <h1>Profile for User #{{ $route.params.userId }}</h1>
</template>
<script>
export default function({ $route }) {
  // $route.params.userId is available
  return {};
}
</script>
```

#### Route Meta Usage

You can add metadata to routes, which can be useful for things like setting the document title or controlling access.

```javascript
defineRoute({
  path: '/settings',
  component: './pages/Settings.html',
  meta: { requiresAuth: true, title: 'Settings' }
});
```

#### Layouts with Named Outlets

For more complex layouts, you can use named outlets to render different components in different parts of the layout.

```html
<template>
  <header>Header</header>
  <main>
    <div x-outlet="main"></div>
  </main>
  <aside>
    <div x-outlet="sidebar"></div>
  </aside>
</template>
```

```javascript
import { defineRoute } from './basedom/router.js';

defineRoute({
  path: '/app',
  component: './layouts/AppLayout.html',
  children: [
    { path: '/', component: './pages/Dashboard.html', outlet: 'main' },
    { path: '/menu', component: './pages/Menu.html', outlet: 'sidebar' }
  ]
});
```

### Form Handling (`form.js` & `validation.js`)

BaseDOM provides a comprehensive solution for managing forms.

-   `createForm(config)`: Creates a form controller with state (`fields`, `errors`, `isValid`), validation, and submission logic.
-   `Form`, `Field`, `Submit`: Programmatic components to easily build forms.
-   `validation.js`: A set of common validation helpers (`required`, `minLength`, `email`, `composeValidators`).

**Example:**

```javascript
import { Form, Field, Submit } from './basedom/form.js';
import { required, email, minLength, composeValidators } from './basedom/validation.js';
import { signal } from './basedom/state.js';

function MyForm() {
  const form = createForm({
    initialValues: {
      email: '',
      password: ''
    }
  });

  form.setValidator('email', composeValidators(
    required('Email is required'),
    email('Please enter a valid email')
  ));

  form.setValidator('password', composeValidators(
    required('Password is required'),
    minLength(8, 'Password must be at least 8 characters')
  ));

  const handleSubmit = async (values) => {
    console.log('Submitting:', values);
    // Returns a promise to set submitting state
    return new Promise(resolve => setTimeout(resolve, 1000));
  };

  return Form({
    onSubmit: handleSubmit,
    children: [
      Field({
        label: 'Email',
        name: 'email',
        type: 'email',
        value: form.fields.email,
        error: form.errors().email,
        touched: form.touched().email
      }),
      Field({
        label: 'Password',
        name: 'password',
        type: 'password',
        value: form.fields.password,
        error: form.errors().password,
        touched: form.touched().password
      }),
      Submit({
        text: 'Log In',
        loadingText: 'Logging in...',
        isSubmitting: form.isSubmitting
      })
    ]
  });
}
```

### Global State (`createStore`)

For complex state shared between components, `createStore` provides a powerful global store with features like schemas, transactions, and fine-grained listeners. It's excellent for managing user data, application settings, or any structured data.

**`store.js`**
```javascript
import { createStore } from './basedom/store.js';

export const store = createStore({
  // Simple key-value pairs
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

The store API provides dozens of methods like `getValue`, `setValue`, `getRow`, `setRow`, `transaction`, and listeners (`addValueListener`, `addRowListener`, etc.) for surgical state updates. You can also define schemas for your data to ensure type safety and consistency.

**Example of a transaction:**

```javascript
import { store } from './store.js';

function updateUserAndProduct(userId, newName, productId, newPrice) {
  store.transaction(() => {
    store.setPartialRow('users', userId, { name: newName });
    store.setCell('products', productId, 'price', newPrice);
  });
}
```

### Declarative AJAX

Fetch content from the server and update the DOM without writing any JavaScript, inspired by HTMX.

| Directive | Description |
| --- | --- |
| `x-get="url"` | Makes a GET request to the URL. |
| `x-post="url"` | Makes a POST request (often used on a `<form>`). |
| `x-trigger="event"` | The event that triggers the request (e.g., `click`, `load`, `submit`). Defaults based on element. |
| `x-target="selector"` | A CSS selector for the element to be updated. Defaults to the element itself. |
| `x-swap="method"` | How to update the target: `innerHTML` (default), `outerHTML`, `append`, `prepend`, etc. |
| `x-select="selector"`| Selects a portion of the HTML response to use for the swap. |

**Example:**

```html
<!-- Load content into a div when a button is clicked -->
<button x-get="/api/content" x-target="#content" x-swap="innerHTML">Load Content</button>

<div id="content"></div>

<!-- Load a partial HTML file and replace a specific element -->
<div id="user-profile">
  <button x-get="/api/user" x-select="#user-card" x-target="#user-profile" x-swap="outerHTML">
    Load User Profile
  </button>
</div>
```


---

## Contributing

We welcome contributions! Please feel free to open an issue or submit a pull request on our [GitHub repository](https://github.com/Named666/BaseDOM).

### TODO & Roadmap

-   [ ] **Declarative Component Imports & Nesting:** The ability to import an SFC into another and use it as a custom tag (e.g., `<MyComponent>`). Some kind of component registry maybe?
-   [ ] **Transitions:** Add `x-transition` directives for simple CSS transitions.
-   [ ] **CLI Tool:** A command-line tool for scaffolding new projects and components.
-   [ ] **Cookbook:** Create a "cookbook" section with recipes for common patterns.
-   [ ] **Testing:** Expand the test suite to cover all directives and core functionalities.
