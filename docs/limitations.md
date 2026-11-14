# Limitations

These are current gaps, not a claim that they are small or temporary.

## Stable contract

Signals, computed values, effects, `watch`, cleanup, `mount`, HTML screens (`defineSfc`, `loadComponent`, the Vite plugin), `defineProps` / `emit` / slots / `provide` / `inject`, `createResource`, `x-boundary` for render and effect errors, template bindings including `x-model` on text, checkbox, radio, select, and number controls, keyed `x-for`, and the router behaviors covered by tests: layout outlet, lazy screens, `load()` that drops a stale result, loading and error states, back/forward path, 404 inside the layout, and a newer navigation replacing one still waiting on a guard. `setStyleNonce` copies a nonce onto scoped style tags. `index.d.ts` covers that surface. Forms are those controls plus the screen's submit function. Shared state is a module of signals.

## CSP

Template expressions do not use `eval` or `new Function`, so `script-src 'self'` does not need `'unsafe-eval'`. Scoped CSS is inserted in a `<style>` element. A `style-src` policy that allows neither `'unsafe-inline'` nor the nonce passed to `setStyleNonce` blocks that CSS. The nonce is not an HTML sanitizer. `renderServerTemplate` strips script and inline handlers from server fragments; it is not a general filter for untrusted HTML. `raw()` is trusted HTML.

## Tested in this milestone

- Signals, computed values, effects, `batch`, and owner cleanup.
- Template text, `@click` / `x-on`, `:attr` / `x-bind`, `x-show`, `x-model`, `x-if` / `x-else`, and keyed `x-for`.
- `mount`, and `renderComponent` disposing its previous effect.
- SFC loading: inline script is refused, `script src` is restricted, server templates cannot supply script.
- The Vite plugin compiling inline `<script setup>`.

## Not part of that contract

- **Route guards and scroll restoration still ship.** A later navigation can supersede one waiting on `beforeEnter`. Scroll restoration has no dedicated test. The day-one path is `load()` plus `x-link`.
- **No virtual DOM, and no claim of being faster** than Vue, React, Angular, or Solid. Updates are direct DOM writes. A Vite 6 production build of `examples/vite-counter` (screen runtime only, router not imported) was **35.56 kB minified / 11.96 kB gzip** (`dist/vite-counter/assets/index-Ba_fGB6A.js`, 35563 bytes, gzip 11955). An esbuild minify of `examples/spa/app.js` (runtime plus router, screens fetched separately) was **55.36 kB minified / 19.05 kB gzip** (55361 bytes, gzip 19047). The Vite bundle does not contain the HMR runtime or the graph parser. The previous counter figure on this branch was 35563 / 11955 bytes and the previous SPA figure was 55805 / 19228 bytes. These are measurements of this tree, not a comparison to other libraries.
- **`x-for` without `x-key` reuses DOM by index.** Local state inside a row sticks to the position. Set `x-key`.
- **`x-for` anchors are comment nodes** inside the parent. They can affect `:nth-child` and some CSS selectors. Rows that are not a single element are wrapped in a `<span>`.
- **Props are getters, not a proxy.** `defineProps()` returns a getter per key. `props.count()` reads the live value. `const n = props.count()` snapshots it. Destructuring the raw props object does not subscribe.
- **Slots keep the parent scope.** Scoped CSS skips elements marked `data-basedom-slot` and their descendants. It is not Shadow DOM. `:global`, deep selectors, and complicated keyframes are not a supported contract.
- **`x-boundary` catches render and effect errors in its subtree.** It does not catch errors thrown from event handlers or from `setTimeout` / `setInterval`.
- **HMR preserves signals when the declaration list is unchanged.** Template and style edits do not rerun setup. A script edit copies values onto the new signals by name and order. Adding, removing, or renaming a `signal()` remounts that instance and logs `BD1020`. State created outside `signal()` (a plain object closed over in setup) is not restored. Editing the route module re-renders the current route and does not preserve screen state. HMR code is not in the production bundle.
- **The app graph is dev and build tooling.** It uses Rollup's parser for scripts and a scanner for templates. It is not a language server. `BD1034` can flash while files are still loading, then clears on the next rebuild once a parent references the component.
- **Expressions are a subset of JavaScript.** See [sfc.md](./sfc.md). There is no event modifier (`.prevent`, `.stop`).
- **No SSR or hydration.** `index.d.ts` types the tested JavaScript API. It does not type-check template expressions.
- **Persistent signals** use `sessionStorage` and `JSON`. Values that do not survive `JSON.stringify` will not round-trip.
- **Storing a function in a signal** is treated as an updater (`setCount(value => value + 1)`). Box a function if it is data.

## Security limits

The template interpreter blocks obvious escapes (`constructor`, `window`, `eval`). It is not a security audit. A context function you pass to a server template runs with the page's privileges. Sanitization removes inline handlers from server HTML before parse; it does not make arbitrary HTML a safe sink. `raw()` and fetch HTML swaps bypass text escaping on purpose.
