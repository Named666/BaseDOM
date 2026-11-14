# Changelog

## 0.5.0

### Composition

- `defineProps()` returns a live getter per prop. Reading it later sees the parent's current value without remounting the child. Calling it once still snapshots. Missing required props warn `BD1004`. Unknown props warn `BD1005`.
- `emit(name, payload)` delivers the payload to `@name` on the component tag. That listener is not a DOM listener on the root.
- Default, named, and scoped slots keep the parent scope. Scoped CSS does not style `[data-basedom-slot]` content.
- `provide` / `inject` walk the owner tree and pass signals through. A missing key throws `BD1006` unless a default is passed.
- `watch(source, callback, { immediate })` runs the previous cleanup when the source changes and when the component unmounts.
- `createResource` exposes loading, error, value, and refetch. A new source aborts the previous `AbortSignal` and drops the stale response.
- `x-boundary` catches render and effect errors in its subtree, shows fallback markup, and resets. It does not catch event-handler or timer errors. A layout with `x-boundary` on `x-outlet` stays mounted when a child screen throws.
- `lazy(() => loadComponent(url))` and `load({ signal })` load a screen's data. A newer navigation aborts the signal and drops the result. The outlet shows loading and error states. 404 stays inside the layout.

### Tooling

- The Vite plugin accepts `.html` SFC updates and swaps the mounted element. Setup state is not copied. A failed swap reloads the page.
- `vite build` writes `basedom-graph.json` from the same compiler scan: screens, props, emits, slots, `x-model` targets, and literal route paths.
- Template and runtime failures use `BD1xxx` codes with a file, expression, and fix hint when known.

### Breaking

- `@name` on a component tag is a component event. It is no longer forwarded as a native listener on the root.
- Scoped CSS no longer matches slotted content.

## 0.4.0

### Hardening

- `createForm` fields read with `field()` and write with `field(next)`. Validators can be a function or a list. `dispose()` stops the validation effect.
- `x-model` covers text, checkbox, radio, select, and number inputs.
- A newer `navigate()` supersedes one still waiting on a guard instead of throwing.
- Unknown paths render a 404 in the layout. Modified clicks, `_blank`, and downloads are not intercepted.
- Failed template expressions are reported with the expression text.
- `setStyleNonce` copies a CSP nonce onto scoped style tags. Without a nonce or `'unsafe-inline'`, those tags are blocked.
- Checked declarations live in `index.d.ts`.

### SPA

- Screen templates no longer import the router or fetch stack. A Vite 6 build of the counter is 30.81 kB minified / 10.41 kB gzip. An esbuild bundle of the two-screen app is 44.5 kB minified / 15.5 kB gzip.
- `<main x-outlet>` keeps a layout mounted while the child screen is replaced and unmounted.
- `startRouter({ mode: 'hash' })` works from any directory. The default remains path history.
- The new screen's heading receives focus.

First tested slice of the runtime. BaseDOM updates real DOM nodes. It does not add a virtual DOM.

### Breaking

- `parseComponent` and `loadComponent` no longer execute inline `<script>` from HTML text. There is no `data:` URL import and no `eval` / `new Function` for that text. Use `<script setup src="./file.js">` or the Vite plugin. Server HTML goes through `renderServerTemplate`.
- Template expressions are a small interpreter, not arbitrary JavaScript.
- Same-origin link clicks are not intercepted unless the anchor has `x-link`.
- Each SFC instance runs setup once. The old shared setup cache is gone.
- Bound props (`:name`) are live getters.
- Importing the package no longer prints a development-mode warning.

### Added

- `defineSfc`, `mount`, `loadComponent`, `renderServerTemplate`.
- Owner cleanup for effects created while a component is alive, including `onMount` / `onCleanup`.
- `batch` and `untrack`.
- Keyed `x-for` that moves real elements (`x-key`).
- Optional Vite plugin at `basedom/vite`.
- Regression tests, CI, and `examples/no-build`.
