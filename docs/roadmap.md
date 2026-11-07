# Follow-on roadmap

Ordered by what the current code is missing. None of these are promises of compatibility with Vue, React, Angular, or Solid.

1. **Keyed list polish.** Keep the real-element map, and stop comment anchors from affecting CSS. Cover move, insert, and remove with the tests that already started.
2. **Slots and component events.** Make `x-slot` part of the tested contract. Add an explicit emit helper if DOM bubbling on the root is not enough.
3. **Router.** Test nested routes, guards, and `x-link` together. The interception helper is tested; navigation is not.
4. **Forms.** Fix `createForm` so a field is a signal getter/setter, then test validation.
5. **Fetch swap.** Decide whether HTML responses stay a trusted sink or go through `renderServerTemplate`. Test whichever choice, including unmount of replaced nodes.
6. **Types.** Add JSDoc or `.d.ts` only for the APIs the tests cover (`signal`, `defineSfc`, `mount`, `loadComponent`, `renderServerTemplate`).
7. **Expression coverage.** Add optional chaining and arrow callbacks only if a real template needs them. Do not switch back to `new Function`.
8. **Smaller bundles.** Stop `directives.js` from importing the router and fetch modules so a counter does not ship them. The measured counter bundle is in [limitations](./limitations.md).
9. **Tooling.** Keep Vite optional. Replace it only if a concrete no-dependency build requirement shows up. Do not add a virtual DOM to chase a benchmark.
