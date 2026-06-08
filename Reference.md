# BaseDOM — Reference

This README is generated from the library source. It lists every file in the package and describes the important exported functions, components and behaviors. Use this as a quick reference for the library surface.

**Overview**
- **Purpose**: Lightweight reactive UI toolkit using signal-based reactivity, single-file components (.html), declarative directives and a tiny router.
- **Usage**: Import `startApp()` from the package entry or include the modules directly in the browser as ES modules.

**Files & Key APIs**

- **components.js**: Core component utilities and DOM helpers.
  - `createComponent(tag, options)`: Build an `HTMLElement` with reactive attributes, scoped styles and lifecycle hooks (`onMount`, `onUnmount`, `onUpdate`). Handles `x-model`-style behaviors, form `onSubmit`, and reactive children.
  - `renderComponent(component, container)`: Render a component function or element into `container` reactively (re-runs when dependencies change).
  - `handleScopedStyles(styles, element)`: Injects and scopes CSS so styles apply only to the component instance.
  - Internal helpers: `applyAttribute`, `appendChildToElement`, lifecycle wiring and attribute normalization.

- **directives.js**: Built-in template directives (control-flow and attribute directives).
  - Control-flow: `xIfDirective`, `xElseDirective`, `xForDirective` (returns computed rendering results).
  - Attribute directives: `xOnDirective` (`x-on:` / `@`), `xBindDirective`, `xShowDirective`, `xModelDirective` (two-way binding), `FetchDirective` (x-get/x-post... pipeline), `xMountDirective`, `xUnmountDirective`, `xUpdateDirective`, `xRefDirective`.
  - Slot support: `slotDirective` and `xSlotDirective` for `<slot>` and `x-slot` handling.
  - Directives are registered via `registerDirective()` from `parser.js` at module load.

- **expression.js**: Safe expression evaluation and reactive value helpers.
  - `ExpressionParser`: Class that validates and evaluates expressions safely inside a provided context.
  - `evaluateExpression(expr, context)`: Evaluate template expressions; automatically wraps reactive values.
  - `_reactive(value)`: Helper that resolves signals/functional getters and unwraps arrays/objects for evaluation.

- **fetch.js**: Centralized AJAX and swap utilities used by `FetchDirective`.
  - `fetchAndSwap(url, options)`: Performs fetch, tries to parse response as a BaseDOM component (via `parseComponent`), and then swaps into the target using many swap strategies (`innerHTML`, `outerHTML`, insert positions, `delete`, `none`) while preserving lifecycle.
  - `makeFragment(response)`, `findAndSwapOobElements(fragment)`, `applyRawHtmlSwapToTarget(target, html, swapStyle)`: helpers for fragment parsing, out-of-band (OOB) swaps and raw HTML swaps.
  - Supports `select`, `selectOob`, `preserve`, swap modifiers (`swap:`, `settle:`, `transition`) and indicator/timeout handling.

- **form.js**: Higher-level form helpers and small form components.
  - `createForm(initialValues)`: Form state with `fields`, `errors`, `isSubmitting`, `touched`, validators and `handleSubmit(onSubmit)`.
  - `useFormContext(element)`: Retrieve form API from a DOM element registered with `Form`.
  - `Form(options, children)`: `createComponent('form', ...)` wrapper that wires `createForm` into a DOM form element and exposes form context.
  - `Field(props, children)`: Renders an input/textarea/select/checkbox/radio with bound handlers that update the form state and validation UI.
  - `Submit(text, opts)`: Simple submit button that respects `isSubmitting` state.

- **html.js**: Small helpers and element factories.
  - `Element(tag)`: Factory returning functions like `div()`, `p()`, etc. These call `createComponent` under the hood.
  - `raw(html)`: Return `{ __html }` object for trusted raw HTML insertion.
  - `withLifecycleHooks(componentFn, hooks)`: Wrap component function and attach lifecycle hooks when returned element mounts.
  - `Link(...)`, `Img(src, options)`: Convenience constructors for anchor elements using `x-link` and images.

- **index.js**: Package entry helper and re-exports.
  - `startApp(rootSelector = '#app')`: Kick off router, initialize root and render initial route; registers global `signal`, `computed`, `effect` on `window` for convenience in dev.
  - Re-exports many modules: `navigation`, `components`, `state`, `html`, `render`, `router`, `parser`, `lifecycle`.
  - `DEV_MODE` and `devWarn()` for console warnings in development.

- **lifecycle.js**: Unified lifecycle helpers.
  - `attachLifecycleHooks(element, hooks)`: Attach `onMount`, `onUnmount`, `onUpdate` handlers to an element (composes multiple attachments).
  - `callOnMountRecursive(node)`, `callOnUnmountRecursive(node)`, `callOnUpdateRecursive(node)`: Walk the subtree and call lifecycle hooks.
  - `safeAppendElement(parent, child)`, `replaceContent(container, newContent)`, `safeRemoveElement(element)`: Lifecycle-aware DOM mutations.
  - `preserveAndSwap(target, swapFn)`: Keep elements annotated with `x-preserve` across swaps using a temporary pantry.
  - `wrapReactiveElement(fn, hooks)`: Wrap reactive element factories to attach lifecycle hooks consistently.

- **navigation.js**: High-level navigation primitives and signals.
  - Signals: `currentRoute`, `pendingNavigation`, `errorState`, `scrollPositions` (all created with `signal`).
  - `navigate(path, {replace, triggeredByPopstate})`: Central navigation API that runs leave/enter guards, renders the route, updates history and scroll state.
  - Guard helpers: `addGlobalBeforeEnterGuard`, `addGlobalBeforeLeaveGuard`.
  - `attachLinkInterception()`: Click listener for passive SPA navigation (intercepts same-origin links and `x-link`).

- **package.json**: Package metadata and file list. Main entry is `index.js`.

- **parser.js**: Template parser for `.html` single-file components and the directive system.
  - `parseComponent(htmlText)`: Converts a single-file component into a renderable function. Supports `<template>`, `<script>` / `<script setup>` and `<style>` blocks.
  - `parseNode(node, context, componentStyles)`: Recursively transforms DOM nodes into elements/components using directives.
  - Directive registry: `registerDirective(name, handler)` and internal `processDirectives` used by `parseNode`.
  - `parseTextNode(text, context)`: Interpolation handling for `{{ ... }}` expressions returning `computed` getters when needed.

- **registry.js**: Component registry utilities.
  - `registerComponent(name, source)`: Register a component by name (source can be a function or URL string to fetch and parse).
  - `getComponent(name)`: Retrieve a registered component function.
  - `registerComponents(map)`: Bulk registration convenience.

- **render.js**: Route rendering, root management and error handling.
  - `initialize(selector)`, `setRootElement(selector)`: Configure the root container.
  - `renderRoute(pathname)`: Compose nested layout components per route match and set the reactive `currentView`.
  - Hooks: `onBeforeRender`, `onAfterRender`; `setErrorBoundary` for custom error UI.
  - Utilities: `escapeHtml`, `findFallbackRoute` and component caching for `.html` components.

- **router.js**: Route definition and matching.
  - `defineRoute(config)`: Define routes (supports nested children, guards, `scrollBehavior`, and wildcards).
  - `startRouter()`: Mount `popstate` handler and link interception.
  - `findMatchingRoute(path)`: Returns matched route chain, params and meta.
  - `parseQuery(queryString)`: Parse querystring into object.

- **state.js**: Reactive primitives.
  - `signal(initialOrName, initialIfPersistent)`: Create a getter/setter pair. Supports persistent signals (via `sessionStorage`) when a string key + initial value are provided.
  - `effect(fn)`: Runs `fn` and tracks dependencies; returns a disposer.
  - `computed(fn)`: Memoized read-only signal that re-computes when dependencies change.

- **store.js**: Feature-rich global store for structured/tabular data.
  - `createStore(initialState)`: Returns a store API supporting keyed values, tables (rows/cells), listeners, schema enforcement, transactions and serialization helpers.
  - API highlights: `getValue`, `setValue`, `addValueListener`, `getTable`, `setRow`, `setCell`, `addRowListener`, `transaction(fn)`, `setValuesSchema`, `getJson`, etc.

- **validation.js**: Collection of common validators.
  - `required(message)`, `minLength(n)`, `maxLength(n)`, `email(message)`, `composeValidators(...)` — small pure helpers to use with `createForm`.