# Follow-on roadmap

Ordered by what is still missing after the composition work. None of these are promises of compatibility with Vue, React, Angular, or Solid.

Shipped and covered by tests: live `defineProps`, `emit`, default/named/scoped slots, `provide` / `inject`, `watch`, `createResource`, `x-boundary` for render and effect errors, lazy screens, route `load()` that aborts when a newer navigation wins, Vite HMR that preserves `signal()` state, and a parsed app graph.

Still open:

1. **Keyed list polish.** Keep the real-element map, and stop comment anchors from affecting CSS.
2. **Scroll restoration.** Route guards ship and a test covers a newer navigation superseding `beforeEnter`. Scroll restoration does not have a dedicated test.
3. **Expression coverage.** Add optional chaining and arrow callbacks only if a real template needs them. Do not switch back to `new Function`.
4. **Tooling depth.** The graph parser is not a language server. Do not add a virtual DOM, CSS modules, keep-alive, transitions, portals, or SSR to chase a feature list.
