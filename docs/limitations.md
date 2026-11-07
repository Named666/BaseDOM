# Limitations

These are current gaps, not a claim that they are small or temporary.

## Stable contract

Signals, computed values, effects, cleanup, `mount`, HTML screens (`defineSfc`, `loadComponent`, the Vite plugin), template bindings including `x-model` on text, checkbox, radio, select, and number controls, keyed `x-for`, and the router behaviors covered by tests: layout outlet, back/forward path, 404, and a newer navigation replacing one still waiting on a guard. `createForm` stores values and validators. `setStyleNonce` copies a nonce onto scoped style tags.

## Experimental

`Form`, `Field`, and `Submit` do not keep the input and the error text live. The store, fetch/HTML swap, and route guards are present and not part of the tested contract. Do not treat them as stable.

## CSP

Template expressions do not use `eval` or `new Function`, so `script-src 'self'` does not need `'unsafe-eval'`. Scoped CSS is inserted in a `<style>` element. A `style-src` policy that allows neither `'unsafe-inline'` nor the nonce passed to `setStyleNonce` blocks that CSS. The nonce is not an HTML sanitizer. `renderServerTemplate` strips script and inline handlers from server fragments; it is not a general filter for untrusted HTML. `raw()` and fetch swaps are trusted HTML.

## Tested in this milestone

- Signals, computed values, effects, `batch`, and owner cleanup.
- Template text, `@click` / `x-on`, `:attr` / `x-bind`, `x-show`, `x-model`, `x-if` / `x-else`, and keyed `x-for`.
- `mount`, and `renderComponent` disposing its previous effect.
- SFC loading: inline script is refused, `script src` is restricted, server templates cannot supply script.
- The Vite plugin compiling inline `<script setup>`.

## Not part of that contract

- **Store, form builders, and fetch/HTML swap.** They still ship. `createForm` stores `signal()` tuples and then calls the tuple as a function, so that helper does not work. Fetch swap assigns HTML (`innerHTML`). Treat response HTML as trusted. It is not the SFC sandbox. The router has a two-screen test (layout stays mounted, outlet swaps, back button). Guards and scroll restoration are still unverified. Import `directives-core.js` for screens. `directives.js` also loads fetch and the router.
- **No virtual DOM, and no claim of being faster** than Vue, React, Angular, or Solid. Updates are direct DOM writes. A Vite 6 production build of `examples/vite-counter` (screen runtime only, router not imported) was **31.42 kB minified / 10.56 kB gzip**. An esbuild minify of `examples/spa/app.js` (runtime plus router, screens fetched separately) was **46.1 kB minified / 16.1 kB gzip**. These are measurements of this tree, not a comparison to other libraries. The earlier 52 kB / 17 kB figure included the router and fetch modules on a page that never navigated.
- **`x-for` without `x-key` reuses DOM by index.** Local state inside a row sticks to the position. Set `x-key`.
- **`x-for` anchors are comment nodes** inside the parent. They can affect `:nth-child` and some CSS selectors. Rows that are not a single element are wrapped in a `<span>`.
- **Props are getters, not a proxy.** Destructuring a prop in setup reads it once.
- **Slots** exist in `directives.js` and are not covered by the new tests.
- **CSS scoping** prefixes selectors and adds a class on the component root. It is not Shadow DOM. `:global`, deep selectors, and complicated keyframes are not a supported contract.
- **Expressions are a subset of JavaScript.** See [sfc.md](./sfc.md). There is no event modifier (`.prevent`, `.stop`).
- **No SSR, hydration, or TypeScript types.**
- **Persistent signals** use `sessionStorage` and `JSON`. Values that do not survive `JSON.stringify` will not round-trip.
- **Storing a function in a signal** is treated as an updater (`setCount(value => value + 1)`). Box a function if it is data.

## Security limits

The template interpreter blocks obvious escapes (`constructor`, `window`, `eval`). It is not a security audit. A context function you pass to a server template runs with the page's privileges. Sanitization removes inline handlers from server HTML before parse; it does not make arbitrary HTML a safe sink. `raw()` and fetch HTML swaps bypass text escaping on purpose.
