# DOMinus

DOMinus is a lightweight, modern JavaScript library for building user interfaces with fine-grained reactivity. It offers a simple yet powerful API for creating components, managing state, and handling routing, all without a complex build setup.

## Features

- **Fine-Grained Reactivity:** A `signal`-based system for creating reactive state that automatically and efficiently updates the UI.
- **Component-Based Architecture:** Build your UI with reusable components that encapsulate their own logic and scoped styles.
- **Advanced Client-Side Routing:** A powerful router for SPAs, supporting nested routes, layouts, route parameters, and navigation guards.
- **Declarative Form Handling:** A complete solution for creating forms with validation and submission handling.
- **Global State Management:** Includes `createStore` for managing complex, structured application state.
- **Lightweight and Performant:** DOMinus is designed to be small and fast, with a minimal footprint and no virtual DOM.

## Getting Started

### Installation

```bash
npm install dominus
```

### Basic Usage

To render a single, simple component:

```javascript
import { signal, createComponent, button, p, renderComponent } from 'dominus';

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
import { defineRoute, startApp, Link, createComponent, div } from 'dominus';

// Define a simple home component
const HomeComponent = () => createComponent('h1', 'Home Page');

// Define routes
defineRoute('/', HomeComponent);

// Start the application
startApp('#app'); // DOMinus will render the matched route into the #app element
```

## State Management

DOMinus provides several primitives for managing state.

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
import { signal, effect } from 'dominus';

const [count, setCount] = signal(0);

effect(() => {
  console.log(`The count is now: ${count()}`);
});

setCount(1); // Logs: "The count is now: 1"
```

### `computed`

A `computed` value is a read-only signal that derives its value from other signals.

```javascript
import { signal, computed } from 'dominus';

const [firstName, setFirstName] = signal('John');
const [lastName, setLastName] = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // "John Doe"
```

### `createStore`

For more complex, global state, `createStore` provides a structured, observable object, ideal for managing data like user sessions or application settings.

```javascript
import { createStore } from 'dominus';

const store = createStore({
    values: { isLoggedIn: false, theme: 'light' },
    tables: { todos: { '1': { text: 'Learn DOMinus' } } }
});

store.addValueListener('theme', (newTheme) => {
    console.log(`Theme changed to ${newTheme}`);
});

store.setValue('theme', 'dark'); // Logs: "Theme changed to dark"
```

## Components

Components are functions that return DOM elements. Use `createComponent` for custom elements or the provided HTML helper functions (`div`, `p`, `button`, etc.).

```javascript
import { createComponent, h1, p } from 'dominus';

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

DOMinus includes a client-side router supporting nested routes, layouts, and navigation guards.

```javascript
import { defineRoute, startApp, Link, createComponent, div, main, nav } from 'dominus';

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

DOMinus provides a complete form handling solution with the `Form`, `Field`, and `Submit` components, along with validation helpers.

```javascript
import { Form, Field, Submit, required, minLength, composeValidators } from 'dominus';

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

DOMinus is licensed under the MIT License.