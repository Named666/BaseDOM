// Optional app boot. The counter does not import this module.
// Same contract as main: startApp(rootSelector = '#app') starts the router,
// mounts into that element, and renders the current URL.

import './directives-core.js';
import { initialize, renderRoute } from './render.js';
import { startRouter } from './router.js';
import { devWarn } from './dev.js';

/**
 * Boots a routed app into rootSelector. Routes must already be defined.
 * @param {string} [rootSelector='#app']
 */
export function startApp(rootSelector = '#app') {
  async function doStart() {
    startRouter();
    initialize(rootSelector);
    const path = location.pathname + location.search;
    await renderRoute(path);
    try {
      const nav = await import('./navigation.js');
      if (nav && typeof nav.setCurrentRoute === 'function') nav.setCurrentRoute(path);
      if (nav && typeof nav.markActiveLinks === 'function') nav.markActiveLinks();
    } catch (error) {
      devWarn('Failed to set initial currentRoute', error);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doStart, { once: true });
  } else {
    doStart();
  }
}
