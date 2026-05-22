import { parseComponent } from './parser.js';

const componentRegistry = new Map();

/**
 * Register a component from a file path or function
 * @param {string} name - Component name (e.g., 'UserCard')
 * @param {string|Function} source - File path or component function
 * @returns {Function} Component function that can be used in routes or other components
 */
export async function registerComponent(name, source) {
    let componentFn;
    
    if (typeof source === 'string') {
        // It's a file path, parse it
        componentFn = await parseComponent(await fetch(source).then(r => r.text()));
    } else {
        // It's already a function
        componentFn = source;
    }
    
    // Store in registry for template usage
    componentRegistry.set(name.toLowerCase(), componentFn);
    
    // Return the function for direct usage
    return componentFn;
}

/**
 * Get a registered component
 */
export function getComponent(name) {
    return componentRegistry.get(name.toLowerCase());
}

/**
 * Register multiple components at once
 */
export async function registerComponents(components) {
    const results = {};
    for (const [name, source] of Object.entries(components)) {
        results[name] = await registerComponent(name, source);
    }
    return results;
}