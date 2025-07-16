import { initialize } from './render.js';
import { startRouter } from './router.js';

export function startApp(rootSelector = '#app') {
    initialize(rootSelector);
    startRouter();
}

// re-export anything else you need…
export * from './navigation.js';
export * from './components.js';
export * from './state.js';
export * from './html.js';
export * from './render.js';
export * from './router.js';
export * from './parser.js';