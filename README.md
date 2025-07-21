# BaseDOM

A lightweight, reactive JavaScript framework for building modern web applications without the complexity. Features signal-based reactivity, component architecture, and powerful directives - all with zero build setup required.

## Key Features

- 🔄 **Signal-based Reactivity** - Fine-grained updates with automatic dependency tracking
- 🧩 **Single-File Components** - HTML, CSS, and JS in one file with `x-` directives
- � **Scoped Styles** - Automatic CSS scoping prevents style conflicts between components
- �🌐 **HTMX-like Fetch Directives** - Dynamic content loading without JavaScript
- 📱 **SPA Routing** - Nested routes, guards, and lazy loading
- 📝 **Form Handling** - Built-in validation and state management
- 🚀 **Zero Build Setup** - Works directly in the browser with ES modules

## Quick Start

### 1. Basic Setup

Create your project structure:
```
my-app/
├── index.html
├── app.js
├── components/
│   └── Counter.html
└── basedom/ (framework files)
```

### 2. HTML Entry Point (`index.html`)
```html
<!DOCTYPE html>
<html>
<head>
  <title>BaseDOM App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>
```

### 3. Component Example (`components/Counter.html`)
```html
<template>
  <div>
    <h2>Count: {{ count }}</h2>
    <button x-on:click="increment">+</button>
    <button x-on:click="decrement">-</button>
  </div>
</template>

<script>
import { signal } from '../basedom/state.js';

export default function(props) {
  const [count, setCount] = signal(0);
  
  return {
    count,
    increment: () => setCount(c => c + 1),
    decrement: () => setCount(c => c - 1)
  };
}
</script>

<style>
div { padding: 1rem; border: 1px solid #ccc; }
button { margin: 0.5rem; }
</style>
```

### 4. App Initialization (`app.js`)
```javascript
import { startApp, defineRoute } from './basedom/index.js';

defineRoute({
  path: '/',
  component: './components/Counter.html'
});

startApp('#app');
```

### 5. Run with Local Server
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```

Visit `http://localhost:8000` to see your app!

## Scoped Styles

BaseDOM automatically scopes CSS within single-file components, preventing style conflicts:

```html
<!-- ButtonComponent.html -->
<template>
  <button class="primary">Click me</button>
</template>

<style>
.primary {
  background: blue;
  color: white;
  padding: 10px 20px;
}

/* Use & to style the component root */
& {
  display: inline-block;
  margin: 5px;
}

/* Nested selectors work too */
.primary:hover {
  background: darkblue;
}
</style>
```

Styles are automatically prefixed with unique class names, so `.primary` becomes something like `.x-abc123 .primary`, ensuring no conflicts with other components.

## Core Directives

BaseDOM uses `x-` prefixed attributes for reactive behavior:

### Control Flow
- **`x-if` / `x-else`** - Conditional rendering
- **`x-for`** - List rendering (`x-for="item in items"`)
- **`x-show`** - Toggle visibility without removing from DOM

### Events & Binding  
- **`x-on:event`** - Event handling (`x-on:click="handler"`)
- **`x-bind:attr`** - Dynamic attributes (`x-bind:class="className"`)

### Navigation & Routing
- **`x-link`** - SPA navigation links (automatic interception)
- **`x-outlet`** - Named route outlets for nested routing

### HTMX-style Fetch Directives
- **`x-get` / `x-post`** - HTTP requests
- **`x-swap`** - Content replacement strategy (`innerHTML`, `outerHTML`, `append`, etc.)
- **`x-target`** - CSS selector for swap target
- **`x-trigger`** - Event that triggers request (default: `click`)
- **`x-select`** - Extract portion of response
- **`x-push-url`** / **`x-replace-url`** - History management

**Example: Dynamic content loading**
```html
<button x-get="/api/data" x-target="#content" x-swap="innerHTML">
  Load Data
</button>
<div id="content"><!-- content will be loaded here --></div>
```

**Example: SPA navigation**
```html
<a href="/about" x-link>About</a>
<!-- Or use regular links - they're auto-intercepted -->
<a href="/contact">Contact</a>
```

**Example: Named outlets for nested routing**
```html
<div>
  <nav x-outlet="sidebar"></nav>
  <main x-outlet="main"></main>
</div>
```

## Reactive State

### Signals
```javascript
import { signal, computed, effect } from './basedom/state.js';

// Basic signal
const [count, setCount] = signal(0);
setCount(5); // Set value
console.log(count()); // Get value

// Computed signals (derived state)
const doubled = computed(() => count() * 2);

// Effects (side effects)
effect(() => console.log('Count is:', count()));
```

### Global Store
```javascript
import { createStore } from './basedom/state.js';

const store = createStore({
  user: { name: 'John', email: 'john@example.com' },
  settings: { theme: 'dark' }
});

// Read/write reactive data
const userName = store.get('user.name');
store.set('user.name', 'Jane');
```

## Routing

```javascript
import { defineRoute, startRouter, navigate } from './basedom/router.js';

// Define routes
defineRoute('/', './components/Home.html');
defineRoute('/users/:id', './components/UserProfile.html');

// Nested routes with outlets
defineRoute({
  path: '/admin',
  component: './components/AdminLayout.html', // Contains <div x-outlet="main"></div>
  children: [
    { path: 'users', component: './components/AdminUsers.html' },
    { path: 'settings', component: './components/AdminSettings.html' }
  ]
});

startRouter();

// Programmatic navigation
navigate('/users/123');
```

**AdminLayout.html example:**
```html
<template>
  <div class="admin-layout">
    <aside>
      <a href="/admin/users">Users</a>
      <a href="/admin/settings">Settings</a>
    </aside>
    <main x-outlet="main">
      <!-- Child routes render here -->
    </main>
  </div>
</template>
```

## Forms & Validation

```javascript
import { createForm, Form, Field, Submit } from './basedom/form.js';
import { required, email, minLength } from './basedom/validation.js';

const loginForm = createForm({
  initialValues: { email: '', password: '' },
  validators: {
    email: [required(), email()],
    password: [required(), minLength(8)]
  },
  onSubmit: (values) => {
    console.log('Submitted:', values);
  }
});

// In your component template
const LoginComponent = () => Form({
  onSubmit: loginForm.handleSubmit,
  children: [
    Field({
      label: 'Email',
      name: 'email',
      type: 'email',
      value: loginForm.fields.email,
      error: loginForm.errors().email
    }),
    Field({
      label: 'Password', 
      name: 'password',
      type: 'password',
      value: loginForm.fields.password,
      error: loginForm.errors().password
    }),
    Submit('Login', { isSubmitting: loginForm.isSubmitting() })
  ]
});
```

## Advanced Features

### Component Lifecycle
```javascript
import { createComponent } from './basedom/components.js';

const MyComponent = createComponent('div', {
  onMount: () => console.log('Component mounted'),
  onUnmount: () => console.log('Component unmounted'),
  children: ['Hello World']
});
```

### Error Boundaries
```javascript
import { setErrorBoundary } from './basedom/render.js';

setErrorBoundary(({ error }) => 
  createComponent('div', {
    children: ['Error: ' + error.message]
  })
);
```

### Navigation Guards
```javascript
import { addGlobalBeforeEnterGuard } from './basedom/navigation.js';

addGlobalBeforeEnterGuard((context) => {
  if (context.to.meta.requiresAuth && !isAuthenticated()) {
    return '/login'; // Redirect
  }
});
```

## Why BaseDOM?

- **No Build Step** - Works directly in modern browsers with ES modules
- **Small Bundle** - Minimal footprint, maximum performance  
- **Familiar Syntax** - HTML-first approach with intuitive directives
- **Real Reactivity** - Fine-grained updates without virtual DOM overhead
- **HTMX-Inspired** - Declarative server interactions
- **TypeScript Ready** - Full type support available

Start building reactive web apps today with BaseDOM's simple yet powerful approach!
