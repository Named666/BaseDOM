# BaseDOM

BaseDOM is a lightweight, modern JavaScript library for building user interfaces with fine-grained reactivity. It offers a simple yet powerful API for creating components, managing state, and handling routing, all without a complex build setup.

## Features

- **Fine-Grained Reactivity:** A `signal`-based system for creating reactive state that automatically and efficiently updates the UI.
- **Component-Based Architecture:** Build your UI with reusable components that encapsulate their own logic and scoped styles.
- **Advanced Client-Side Routing:** A powerful router for SPAs, supporting nested routes, layouts, route parameters, and navigation guards.
- **Declarative Form Handling:** A complete solution for creating forms with validation and submission handling.
- **Global State Management:** Includes `createStore` for managing complex, structured application state.
- **Lightweight and Performant:** BaseDOM is designed to be small and fast, with a minimal footprint and no virtual DOM.

## Getting Started

### Installation

```bash
npm install basedom
```

### Basic Usage

To render a single, simple component:

```javascript
import { signal, createComponent, button, p, renderComponent } from 'basedom';

// Define a component
function Counter() {
  const [count, setCount] = signal(0);

  return createComponent('div', {
    children: [
      // The p tag's content is a function, so it reactively updates
      () => p(`Count: ${count()}`),
      button({
        // Event handlers are passed directly
        onClick: () => setCount(count() + 1),
        children: 'Increment'
      })
    ]
  });
}

// Render the component into the element with id="app"
renderComponent(Counter(), document.getElementById('app'));
```

For a full application with routing, use `startApp`:

```javascript
import { defineRoute, startApp, Link, createComponent, div } from 'basedom';

// Define a simple home component
const HomeComponent = () => createComponent('h1', 'Home Page');

// Define routes
defineRoute('/', HomeComponent);

// Start the application
startApp('#app'); // BaseDOM will render the matched route into the #app element
```

## State Management

BaseDOM provides several primitives for managing state.

### `signal`

The `signal` is the core of the reactivity system. It holds a value and notifies its dependents when the value changes.

```javascript
const [count, setCount] = signal(0);

// Read the value
console.log(count()); // 0

// Update the value
setCount(1);
```

Signals can also be persisted to `sessionStorage` by providing a name.

```javascript
// This signal's value will be saved and restored across page reloads
const [name, setName] = signal('user_name', 'Guest');
```

### `effect`

An `effect` is a function that runs whenever one of its dependencies (a signal) changes. It's useful for side effects like logging or data fetching.

```javascript
import { signal, effect } from 'basedom';

const [count, setCount] = signal(0);

effect(() => {
  console.log(`The count is now: ${count()}`);
});

setCount(1); // Logs: "The count is now: 1"
```

### `computed`

A `computed` value is a read-only signal that derives its value from other signals.

```javascript
import { signal, computed } from 'basedom';

const [firstName, setFirstName] = signal('John');
const [lastName, setLastName] = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // "John Doe"
```

### `createStore`

For more complex, global state, `createStore` provides a structured, observable object, ideal for managing data like user sessions or application settings.

```javascript
import { createStore } from 'basedom';

const store = createStore({
    values: { isLoggedIn: false, theme: 'light' },
    tables: { todos: { '1': { text: 'Learn BaseDOM' } } }
});

store.addValueListener('theme', (newTheme) => {
    console.log(`Theme changed to ${newTheme}`);
});

store.setValue('theme', 'dark'); // Logs: "Theme changed to dark"
```

## Components

Components are functions that return DOM elements. Use `createComponent` for custom elements or the provided HTML helper functions (`div`, `p`, `button`, etc.).

```javascript
import { createComponent, h1, p } from 'basedom';

function MyComponent() {
  return createComponent('div', {
    attrs: { class: 'my-component' },
    styles: `
      & { /* The '&' refers to the component's host element */
        padding: 1rem;
        border: 1px solid #ccc;
      }
      h1 { color: blue; }
    `,
    children: [ h1('Hello!'), p('This is a component.') ],
    onMount: (el) => console.log('Component mounted!', el),
    onUnmount: () => console.log('Component unmounted!')
  });
}
```

## Routing

BaseDOM includes a client-side router supporting nested routes, layouts, and navigation guards.

```javascript
import { defineRoute, startApp, Link, createComponent, div, main, nav } from 'basedom';

// Layout component with an outlet for child routes
const AppLayout = (props) => {
    return div({
        children: [
            nav(Link({ href: '/' }, 'Home'), ' | ', Link({ href: '/users/1' }, 'User 1')),
            // props.children will render the matched child route
            main({ attrs: { 'x-outlet': true } }, props.children)
        ]
    });
};

// Define routes
defineRoute({
    path: '/',
    component: AppLayout,
    children: [
        { path: '/', component: () => h1('Home') }, // Index route
        { path: '/users/:id', component: (props) => h1(`User: ${props.params.id}`) }
    ]
});

// Start the app
startApp('#app');
```

## Forms

BaseDOM provides a complete form handling solution with the `Form`, `Field`, and `Submit` components, along with validation helpers.

```javascript
import { Form, Field, Submit, required, minLength, composeValidators } from 'basedom';

function MyForm() {
  const handleSubmit = (values) => {
    alert(`Form submitted with: ${JSON.stringify(values)}`);
  };

  return Form({
    onSubmit: handleSubmit,
    validators: {
        email: required('Email is required'),
        password: composeValidators(required(), minLength(8))
    },
    children: [
      Field({ label: 'Email', name: 'email', type: 'email' }),
      Field({ label: 'Password', name: 'password', type: 'password' }),
      Submit('Submit')
    ]
  });
}
```

## API Reference

### State

- `signal(initialValue)` or `signal(name, initialValue)`: Creates a reactive signal. If `name` is provided, it's persisted to sessionStorage.
- `effect(fn)`: Runs a function and re-runs it when its signal dependencies change.
- `computed(fn)`: Creates a read-only, derived signal.
- `createStore(initialState)`: Creates a global store for complex state.

### Components & HTML

- `createComponent(tag, options)`: The core function for creating elements with reactive features.
- `renderComponent(component, container)`: Renders a component into a container, handling lifecycle hooks.
- `html.js` provides helpers for all standard HTML tags (`div`, `p`, `h1`, etc.).
- `Link(options, children)`: A component for internal navigation that works with the router.
- `List(getItemsFn, getKeyFn, renderItemFn)`: Efficiently renders a list of items with key-based reconciliation.

### Routing

- `defineRoute(config)`: Defines a route. `config` is an object with `path`, `component`, and optional `children`, `guards`, `meta`.
- `startApp(rootSelector)`: Initializes the app and router.
- `navigate(path)`: Programmatically navigates to a new path.

### Forms & Validation

- `Form(options)`: A component that wraps a form, providing state management and submission handling.
- `Field(options)`: A component for a single form field, including label, input, and error display.
- `Submit(text, options)`: A submit button that can be disabled during submission.
- `validation.js` provides helpers like `required`, `minLength`, `maxLength`, `email`, and `composeValidators`.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

BaseDOM is licensed under the MIT License.

### TODO:
Create a DSL that allows you to define components in .html files.

  1. Create a Parser (`parser.js`): This new file will contain the core logic for fetching and parsing .html files. It will transform HTML into a renderable BaseDOM
      component.
   2. Define the DSL Syntax: We will establish a set of special HTML attributes (e.g., bd-on:click, bd-if) to bind BaseDOM's reactive features directly within the HTML.
   3. Implement the Parser Logic: The parser will:
       * Use the browser's DOMParser to turn an HTML string into a traversable DOM tree.
       * Recursively walk the tree, converting each HTML element into a BaseDOM component description.
       * Translate special bd- attributes into event handlers, reactive bindings, and conditional rendering logic.
   4. Integrate with the Router: We will update router.js to allow route definitions to point directly to an .html file, making the new DSL a first-class citizen for defining
      pages.

 Example Usage: A "Before and After"


  Here’s how a simple component would be built now versus how it could be built with the proposed HTML DSL.

  Before: The Current Programmatic API

  This is how you would write a simple counter component today, with nested JavaScript functions.

  `Counter.js` (Current Method)

```javascript
import { signal, createComponent, button, p } from 'basedom';

function Counter() {
  const [count, setCount] = signal(0);

  return createComponent('div', {
    children: [
      // The p tag's content is a function, so it reactively updates
      () => p(`Count: ${count()}`),
      button({
        // Event handlers are passed directly
        onClick: () => setCount(count() + 1),
        children: 'Increment'
      })
    ]
  });
}
```

  After: The Proposed HTML DSL


  With the new DSL, you would define the component in a .html file. The structure is plain HTML, and the logic is cleanly separated in a <script> tag.

  `Counter.html` (Proposed Method)

<!-- The component's logic lives in a script tag -->
<script>
  import { signal } from 'basedom';

  // Component logic is exported as the default
  export default function() {
    const [count, setCount] = signal(0);

    const increment = () => setCount(count() + 1);

    // The script returns the reactive state and methods
    // that the template needs to access.
    return { count, increment };
}
</script>


### BaseDOM HTML DSL Proposal

The BaseDOM HTML DSL introduces a declarative way to define components directly in `.html` files. This approach simplifies the structure of components and allows developers to leverage HTML attributes for reactive bindings, event handling, dynamic rendering, and server interactions.

#### Special Attributes (Directives)

BaseDOM's DSL uses special attributes to bind reactive features, handle events, and interact with the server. These attributes are inspired by Vue directives and HTMX attributes.

---

#### **Reactive Bindings**

- **`bd-bind`**  
  Binds an HTML attribute to a reactive variable. Similar to Vue's `v-bind`.

  ```html
  <input type="text" bd-bind:value="username" />
  ```

  In the script:
  ```javascript
  export default function() {
    const [username, setUsername] = signal('');
    return { username, setUsername };
  }
  ```

---

#### **Conditional Rendering**

- **`bd-if`**  
  Conditionally renders an element based on a reactive expression.

  ```html
  <p bd-if="isLoggedIn">Welcome back!</p>
  <p bd-else>Login to continue.</p>
  ```

  In the script:
  ```javascript
  export default function() {
    const [isLoggedIn, setIsLoggedIn] = signal(false);
    return { isLoggedIn };
  }
  ```

---

#### **Event Handling**

- **`bd-on:event`**  
  Attaches an event listener to an element. Similar to Vue's `v-on`.

  ```html
  <button bd-on:click="increment">Increment</button>
  ```

  In the script:
  ```javascript
  export default function() {
    const [count, setCount] = signal(0);
    const increment = () => setCount(count() + 1);
    return { increment };
  }
  ```

---

#### **Visibility Control**

- **`bd-show`**  
  Toggles the visibility of an element based on a reactive expression.

  ```html
  <div bd-show="isVisible">This content is visible.</div>
  ```

  In the script:
  ```javascript
  export default function() {
    const [isVisible, setIsVisible] = signal(true);
    return { isVisible };
  }
  ```

---

#### **List Rendering**

- **`bd-for`**  
  Loops through an array and renders elements for each item.

  ```html
  <ul>
    <li bd-for="item in items">{{ item }}</li>
  </ul>
  ```

  In the script:
  ```javascript
  export default function() {
    const [items] = signal(['Item 1', 'Item 2', 'Item 3']);
    return { items };
  }
  ```

---

#### **HTMX-Inspired Attributes**

- **`bd-get`**  
  Fetches content from a URL and replaces the element's content.

  ```html
  <button bd-get="/api/data" bd-target="#result">Load Data</button>
  <div id="result"></div>
  ```

- **`bd-post`**  
  Sends data to a URL via POST and updates the target element.

  ```html
  <form bd-post="/api/submit" bd-target="#response">
    <input type="text" name="username" />
    <button type="submit">Submit</button>
  </form>
  <div id="response"></div>
  ```

- **`bd-swap`**  
  Specifies how the content should be swapped (e.g., `innerHTML`, `outerHTML`, `append`, etc.).

  ```html
  <button bd-get="/api/data" bd-swap="append">Add Data</button>
  ```

- **`bd-select`**  
  Selects specific content from the server response.

  ```html
  <button bd-get="/api/data" bd-select=".item">Load Items</button>
  ```

- **`bd-trigger`**  
  Specifies the event(s) that trigger the request (e.g., `click`, `change`, custom events).

  ```html
  <button bd-get="/api/data" bd-trigger="mouseenter">Preview Data</button>
  ```

- **`bd-push-url`**  
  Pushes a new URL to the browser history when the request completes.

  ```html
  <button bd-get="/api/page" bd-push-url="true">Go to Page</button>
  ```

- **`bd-replace-url`**  
  Replaces the current URL in the browser history when the request completes.

  ```html
  <button bd-get="/api/page" bd-replace-url="true">Replace Page</button>
  ```


### Example: Counter Component

**`Counter.html`**
```html
<div>
  <p>Count: {{ count }}</p>
  <button bd-on:click="increment">Increment</button>
</div>

<script>
  import { signal } from 'basedom';

  export default function() {
    const [count, setCount] = signal(0);
    const increment = () => setCount(count() + 1);
    return { count, increment };
  }
</script>
```

This DSL provides a clean, declarative way to define components and their behavior, making BaseDOM more accessible and intuitive for developers.