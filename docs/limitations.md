# Limitations

These are current gaps, not a claim that they are small or temporary.

## Tested in this milestone

- Signals, computed values, effects, `batch`, and owner cleanup.
- Template text, `@click` / `x-on`, `:attr` / `x-bind`, `x-show`, `x-model`, `x-if` / `x-else`, and keyed `x-for`.
- `mount`, and `renderComponent` disposing its previous effect.
- SFC loading: inline script is refused, `script src` is restricted, server templates cannot supply script.
- The Vite plugin compiling inline `<script setup>`.

## Not part of that contract

- **Router, store, form builders, and fetch/HTML swap.** They still ship. They do not have regression tests in this milestone. `createForm` stores `signal()` tuples and then calls the tuple as a function, so that helper does not work. Fetch swap assigns HTML (`innerHTML`). Treat response HTML as trusted. It is not the SFC sandbox.
- **No virtual DOM, and no claim of being faster** than Vue, React, Angular, or Solid. Updates are direct DOM writes. A Vite 6 production build of `examples/vite-counter` was **52 kB minified / 17 kB gzip** when this change was measured. That bundle still includes the router and fetch modules, because `directives.js` imports them. It is not a comparison to other libraries.
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
