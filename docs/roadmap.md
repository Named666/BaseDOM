# Follow-on roadmap

Ordered by what is still missing after the composition work. None of these are promises of compatibility with Vue, React, Angular, or Solid.

Shipped and covered by tests: live `defineProps`, `emit`, default/named/scoped slots, `provide` / `inject`, `watch`, `createResource`, `x-boundary` for render and effect errors, lazy screens, route `load()` that aborts when a newer navigation wins, Vite HMR for `.html` SFCs, and `basedom-graph.json`.

Still open:

1. **Keyed list polish.** Keep the real-element map, and stop comment anchors from affecting CSS.
2. **Route guards and scroll restoration.** They ship. They are not part of the tested contract.
3. **Form builders.** `createForm` is tested. `Form`, `Field`, and `Submit` still do not keep the input and the error text live.
4. **Fetch swap.** Decide whether HTML responses stay a trusted sink or go through `renderServerTemplate`. Test whichever choice, including unmount of replaced nodes.
5. **Expression coverage.** Add optional chaining and arrow callbacks only if a real template needs them. Do not switch back to `new Function`.
6. **HMR state.** The current update remounts the component. Preserving signal identity across a template edit needs a compiler that can reuse those signals. Until then, a failed swap reloads the page.
7. **Tooling depth.** The app graph is a text scan, not a language server. Do not add a virtual DOM, CSS modules, keep-alive, transitions, portals, or SSR to chase a feature list.
