import * as state from './state.js';
import { devWarn } from './dev.js';

if (typeof window !== 'undefined') {
  window.signal = state.signal;
  window.computed = state.computed;
  window.effect = state.effect;
  window.devWarn = devWarn;
}

import { initialize, renderRoute } from './render.js';
import { startRouter } from './router.js';
import './directives.js';

export function startApp(rootSelector = '#app') {
    async function doStart() {
        startRouter();
        initialize(rootSelector);
        await renderRoute(location.pathname + location.search);
        try {
            const nav = await import('./navigation.js');
            if (nav && typeof nav.setCurrentRoute === 'function') {
                nav.setCurrentRoute(location.pathname + location.search);
            }
        } catch (e) {
            devWarn('Failed to set initial currentRoute', e);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doStart, { once: true });
    } else {
        doStart();
    }
}

// re-export anything else you need…
export * from './navigation.js';
export * from './components.js';
export {
  signal,
  computed,
  effect,
  batch,
  createOwner,
  disposeOwner,
  runWithOwner,
  untrack,
  isSignal,
  unwrapSignal
} from './state.js';
export * from './html.js';
export * from './render.js';
export * from './router.js';
export * from './parser.js';
export * from './registry.js';
export * from './lifecycle.js';
export * from './paths.js';
export * from './sfc.js';
export { createForm } from './form.js';
export { DEV_MODE, devWarn } from './dev.js';
