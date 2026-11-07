# Changelog

## 0.4.0

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
