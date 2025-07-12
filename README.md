# DOMinus

**DOMinus** is a lightweight, modern, and reactive vanilla JavaScript framework for building dynamic user interfaces. It's designed to be simple, yet powerful, offering features comparable to popular frameworks like Vue, React, and SolidJS. DOMinus is built to work seamlessly with Vite, providing a fast and efficient development experience.

## Core Concepts

DOMinus is built around a few core concepts:

*   **Reactivity**: At the heart of DOMinus is a powerful reactivity system. You create reactive state with `signal`, and the UI automatically updates when that state changes.
*   **Components**: Build your UI with reusable components. DOMinus components are just JavaScript functions that return HTML elements.
*   **Routing**: A declarative, nested router that makes it easy to manage application views.
*   **State Management**: A global store for managing application-wide state.
*   **Forms**: A comprehensive form handling system with validation.

## Getting Started

To use DOMinus, you'll need a Vite project. If you don't have one, you can create one with:

```bash
npm create vite@latest my-app -- --template vanilla
```

Then, install DOMinus:

```bash
npm install dominus
```

Now, you can start building your application. Here's a simple "Hello, World!" example:

```javascript
// main.js
import { startApp, signal, createComponent, h1 } from 'dominus';

const [message, setMessage] = signal('Hello, DOMinus!');

const App = () => {
  return createComponent('div', {
    children: [
      h1(message)
    ]
  });
};

startApp('#app');
```

## Reactivity

### `signal(initialValue)`

The `signal` function creates a reactive value. It returns a tuple with a getter and a setter function.

```javascript
import { signal, effect } from 'dominus';

const [count, setCount] = signal(0);

// The effect function will re-run whenever the count changes
effect(() => {
  console.log(`The count is: ${count()}`);
});

// To update the count, call the setter
setCount(1); // Logs: The count is: 1
```

### `effect(fn)`

The `effect` function runs a function and automatically tracks its dependencies. When any of the dependencies change, the function is re-run.

### `computed(fn)`

The `computed` function creates a memoized, read-only signal that re-computes its value only when its underlying dependencies change.

```javascript
import { signal, computed } from 'dominus';

const [firstName, setFirstName] = signal('John');
const [lastName, setLastName] = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // Logs: John Doe

setFirstName('Jane');

console.log(fullName()); // Logs: Jane Doe
```

## Components

### `createComponent(tag, options)`

The `createComponent` function is the core of the component system. It creates an HTML element with optional scoped CSS, attributes, and lifecycle hooks.

```javascript
import { createComponent, signal } from 'dominus';

const [count, setCount] = signal(0);

const Counter = () => {
  return createComponent('div', {
    children: [
      createComponent('p', { children: `Count: ${count()}` }),
      createComponent('button', {
        attrs: {
          onClick: () => setCount(count() + 1)
        },
        children: 'Increment'
      })
    ]
  });
};
```


## HTML Helper Functions: Write UI Like HTML, But Reactive

DOMinus provides a rich set of HTML helper functions that let you write UI code in a style that feels like native HTML, but with full reactivity and composability. These helpers make your code concise, expressive, and easy to read.

### Why Use HTML Helpers?

- **Familiar syntax:** Write UI with `div`, `span`, `button`, etc., just like HTML.
- **Reactivity built-in:** Pass signals, effects, or plain values as children or attributes.
- **Composability:** Compose helpers to build complex layouts and components.
- **No JSX required:** Works in plain JavaScript.

### Usage Example


```javascript
import { div, p, button, input, ul, li, Link, Img, List } from 'dominus';
import { signal } from 'dominus';

// Example 1: Simple element with children as arguments
const simpleDiv = div(
  "Hello world!",
  p("This is a paragraph."),
  button({ onclick: () => alert("Clicked!") }, "Click me")
);

// Example 2: Element with options object (attributes, styles, onMount, children)
const styledDiv = div({
  attrs: { id: "main", class: "container" },
  styles: `:scope { background: #f0f0f0; padding: 1em; }`,
  onMount: () => console.log("styledDiv mounted!"),
  children: [
    p({ style: "color: blue;" }, "Styled paragraph."),
    button({ onclick: () => alert("Hi!") }, "Say Hi")
  ]
});

// Example 3: Passing attributes directly (shorthand)
const inputField = input({ type: "text", placeholder: "Type here..." });

// Example 4: Passing event handlers as options
const clickable = div({
  onclick: () => alert("Div clicked!"),
  children: "Click me!"
});

// Example 5: Children as rest arguments
const list = ul(
  li("Item 1"),
  li("Item 2"),
  li("Item 3")
);

// Example 6: Using Link helper (various patterns)
const link2 = Link({ href: "/about" }, "About"); // attrs + children
const link3 = Link({ attrs: { href: "/contact", target: "_blank" }, children: "Contact", }); // full options

// Example 7: Using Img helper
const image = Img("https://placekitten.com/200/300", { alt: "A kitten", class: "rounded" });

// Example 8: Using List for dynamic rendering
const [fruits, setFruits] = signal([
  { id: 1, name: "Apple" },
  { id: 2, name: "Banana" },
  { id: 3, name: "Cherry" }
]);

const fruitList = List(
  fruits, // getItemsFn
  item => item.id, // getKeyFn
  item => li(item.name) // renderItemFn
);

// Example 9: Comprehensive Counter component using all patterns
const [count, setCount] = signal(0);

const Counter = () =>
  div({
    styles: `:scope { padding: 1rem; border: 1px solid #ccc; max-width: 320px; margin: 1rem auto; background: #fafbfc; }`,
    children: [
      p({ style: "font-weight: bold; font-size: 1.2em;" }, `Count: ${count()}`),
      button({
        onclick: () => setCount(count() + 1),
        style: "margin-right: 0.5em;"
      }, "Increment"),
      button({
        onclick: () => setCount(count() - 1),
        style: "margin-right: 0.5em;"
      }, "Decrement"),
      input({
        type: "range",
        min: 0,
        max: 100,
        value: count,
        oninput: e => setCount(Number(e.target.value)),
        style: "width: 100%; margin: 1em 0;"
      }),
      ul(
        li("Try clicking the buttons or dragging the slider!"),
        li(Link({ href: "/docs" }, "Read the docs")),
        li(image)
      )
    ]
  });

// To render:
// import { renderComponent } from 'dominus';
// renderComponent(Counter, document.getElementById('app'));
```

#### Example: Building a Form

```javascript
import { form, label, input, button } from 'dominus';

const LoginForm = () =>
  form({
    onSubmit: e => {
      // handle login
    },
    children: [
      label({ children: 'Username:' }),
      input({ attrs: { type: 'text', name: 'username' } }),
      label({ children: 'Password:' }),
      input({ attrs: { type: 'password', name: 'password' } }),
      button({ children: 'Login' })
    ]
  });
```

### Advanced: Dynamic Lists and Raw HTML

- Use `List(getItemsFn, getKeyFn, renderItemFn)` for efficient, reactive lists.
- Use `raw(htmlString)` to inject trusted HTML.

See the API reference and source for more advanced helpers and patterns.

### Scoped Styles

You can add scoped CSS to your components using the `styles` option. The styles will be automatically scoped to the component.

```javascript
import { createComponent } from 'dominus';

const StyledComponent = () => {
  return createComponent('div', {
    styles: `
      :scope {
        background-color: blue;
        color: white;
        padding: 1rem;
      }
    `,
    children: 'This is a styled component.'
  });
};
```

### Lifecycle Hooks

Components have `onMount` and `onUnmount` lifecycle hooks.

```javascript
import { createComponent } from 'dominus';

const LifecycleComponent = () => {
  return createComponent('div', {
    onMount: () => console.log('Component mounted!'),
    onUnmount: () => console.log('Component unmounted!'),
    children: 'This component has lifecycle hooks.'
  });
};
```

### `withLifecycle(html, { onMount, onUnmount, onUpdate })`

Attach lifecycle hooks to arbitrary HTML.

### `List(getItemsFn, getKeyFn, renderItemFn)`

Efficiently renders a list of components with key-based reconciliation.

## Routing

### `defineRoute(config, componentFn)`

The `defineRoute` function defines a route configuration.

```javascript
import { defineRoute, createComponent, h1 } from 'dominus';

const Home = () => createComponent('div', { children: h1('Home') });
const About = () => createComponent('div', { children: h1('About') });

defineRoute('/', Home);
defineRoute('/about', About);
```

### Nested Routes

DOMinus supports nested routes.

```javascript
import { defineRoute, createComponent, h1, div, ul, li, Link } from 'dominus';

const App = ({ children }) => {
  return div({
    children: [
      nav({
        children: ul({
          children: [
            li({ children: Link({ href: '/' }, 'Home') }),
            li({ children: Link({ href: '/about' }, 'About') })
          ]
        })
      }),
      children
    ]
  });
};

const Home = () => h1('Home');
const About = () => h1('About');

defineRoute({ path: '/', component: App }, [
  defineRoute({ path: '', component: Home }),
  defineRoute({ path: 'about', component: About })
]);
```

### Route Guards

You can add `beforeEnter` and `beforeLeave` guards to your routes.

```javascript
defineRoute('/protected', ProtectedComponent, {
  guards: {
    beforeEnter: (context) => {
      if (!isAuthenticated()) {
        // Redirect to login
        return '/login';
      }
      return true;
    }
  }
});
```

### Navigation

- `navigate(path, { replace = false })`: Programmatically navigate to a new route.
- `addGlobalBeforeEnterGuard(guardFn)`: Adds a global guard that runs before any route is entered.
- `addGlobalBeforeLeaveGuard(guardFn)`: Adds a global guard that runs before any route is left.

## State Management


### `createStore(initialState)`

The `createStore` function creates a global store for your application, supporting both simple values and tabular data. Here's a practical example showing how to use the store in a reactive UI:

```javascript
import { createStore, effect } from 'dominus';
import { div, p, button, input, ul, li } from 'dominus';

// Create a store with a counter and a table of todos
const store = createStore({
  values: { count: 0, newTodo: '' },
  tables: { todos: {} }
});

// Add a new todo row to the store
function addTodo() {
  const text = store.getValue('newTodo');
  if (text.trim()) {
    store.addRow('todos', { text, done: false });
    store.setValue('newTodo', '');
  }
}

const TodoApp = () =>
  div({
    children: [
      p(`Counter: ${store.getValue('count')}`),
      button({
        attrs: { onClick: () => store.setValue('count', store.getValue('count') + 1) },
        children: 'Increment'
      }),
      div({
        children: [
          input({
            attrs: {
              value: store.getValue('newTodo'),
              onInput: e => store.setValue('newTodo', e.target.value),
              placeholder: 'Add a todo...'
            }
          }),
          button({
            attrs: { onClick: addTodo },
            children: 'Add'
          })
        ]
      }),
      ul(
        store.getRowIds('todos').map(id =>
          li({
            children: [
              input({
                attrs: {
                  type: 'checkbox',
                  checked: store.getCell('todos', id, 'done'),
                  onChange: e => store.setCell('todos', id, 'done', e.target.checked)
                }
              }),
              store.getCell('todos', id, 'text')
            ]
          })
        )
      )
    ]
  });

// Optionally, use effect to log store changes
effect(() => {
  console.log('Todos:', store.getTable('todos'));
});

export default store;
```

This example shows how to:
- Use `store.getValue` and `store.setValue` for simple state (counter, input field)
- Use `store.addRow`, `store.getRowIds`, and `store.getCell` for tabular data (todos)
- Connect the store to UI elements for full reactivity

The store provides a rich API for managing keyed values and tabular data, including methods for setting, getting, deleting, and listening to changes.

## Forms

### `createForm(initialValues)`

The `createForm` function creates a form object with reactive fields, errors, and submission state.

```javascript
import { createForm, Form, Field, Submit } from 'dominus';
import { required, email } from 'dominus/validation';

const LoginForm = () => {
  const form = createForm({
    email: '',
    password: ''
  });

  form.setValidator('email', required('Email is required.'));
  form.setValidator('password', required('Password is required.'));

  const handleSubmit = (values) => {
    console.log('Form submitted:', values);
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
      Submit('Login', {
        isSubmitting: form.isSubmitting()
      })
    ]
  });
};
```

### Validation

DOMinus provides a set of common validation functions, such as `required`, `minLength`, `maxLength`, and `email`. You can also create your own custom validators.

## Rendering

- `startApp(rootSelector)`: Initializes the application and starts the router.
- `renderComponent(component, container)`: Renders a component into a container element.
- `setErrorBoundary(componentFn)`: Sets a component to render when an error occurs.
- `onBeforeRender(hook)`: Registers a hook to run before each render.
- `onAfterRender(hook)`: Registers a hook to run after each render.

## API Reference

This `README.md` provides a high-level overview of DOMinus. For a more detailed API reference, please refer to the source code and the examples in this repository.