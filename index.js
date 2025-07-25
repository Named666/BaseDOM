import * as state from './state.js';
import { createStore } from './store.js';

// Expose signals and helpers globally
window.signal = state.signal;
window.computed = state.computed;
window.effect = state.effect;
// Add any other exports you need globally


import { initialize } from './render.js';
import { startRouter } from './router.js';
import { renderRoute } from './render.js';
// Import and register directives
import './directives.js';
export function startApp(rootSelector = '#app') {
    function doStart() {
        startRouter();
        initialize(rootSelector);
        renderRoute(location.pathname + location.search);
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
export * from './state.js';
export * from './html.js';
export * from './render.js';
export * from './router.js';
export * from './parser.js';
export * from './lifecycle.js';

// Development mode flag
export const DEV_MODE = true;

export function devWarn(message, node) {
    if (DEV_MODE) {
        console.warn(`[BaseDOM]: ${message}`, node);
    }
}
if (DEV_MODE) {
    devWarn('Development mode is enabled', document.body);
    window.devWarn = devWarn;
    } else {
    window.devWarn = () => {}; // No-op in production
}
