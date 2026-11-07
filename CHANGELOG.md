# Changelog

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
