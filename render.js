// render.js
import { findMatchingRoute, parseQuery } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';
import { parseComponent } from './parser.js';

let errorBoundary = null;
export function setErrorBoundary(componentFn) {
    errorBoundary = componentFn;
}

const lifecycleHooks = {
    beforeRender: [],
    afterRender: []
};

export function onBeforeRender(hook) { lifecycleHooks.beforeRender.push(hook); }
export function onAfterRender(hook) { lifecycleHooks.afterRender.push(hook); }

let rootElement = null;
export let rootElementSelector = '#app';

// This signal will hold the current component to be rendered
const [currentView, setCurrentView] = signal(null);

// track the last matched route stack to enable partial updates
let prevMatchedRoutes = [];

// --- Component Loading and Caching ---
const componentCache = new Map();

async function resolveComponent(component) {
    if (typeof component !== 'string') {
        return component; // It's already a function
    }
    // Simple check for file-based components
    if (!component.endsWith('.html')) {
        return component;
    }

    try {
        const response = await fetch(component);
        if (!response.ok) {
            throw new Error(`Failed to fetch component: ${component} (${response.status} ${response.statusText})`);
        }
        const sfcText = await response.text();
        const componentFn = await parseComponent(sfcText);
        console.log(`Resolved component "${componentFn}" from network.`);
        componentCache.set(component, componentFn);
        return componentFn;
    } catch (error) {
        console.error(`Error resolving component "${component}":`, error);
        // Return a component that displays the error
        return () => createComponent('div', {
            children: [
                createComponent('h3', { children: 'Component Load Error' }),
                createComponent('pre', { children: error.message, style: { color: 'red' } })
            ]
        });
    }
}


export function initialize(rootElementSelector = '#app') {
    const newRootElement = document.querySelector(rootElementSelector);
    if (newRootElement) {
        rootElement = newRootElement;
        // The root component that reactively renders the current view
        const App = createComponent('div', {
            children: [currentView]
        });
        renderComponent(App, rootElement);
    } else {
        console.warn(`Root element "${rootElementSelector}" not found. App will not render until it is available.`);
        // Retry initialization when the DOM is fully loaded
        document.addEventListener('DOMContentLoaded', () => initialize(rootElementSelector), { once: true });
    }
}

export function setRootElement(selector) {
    const newRootElement = document.querySelector(selector);
    if (newRootElement) {
        rootElement = newRootElement;
        rootElementSelector = selector;
        // Re-render the app with the new root element
        const App = createComponent('div', {
            children: [currentView]
        });
        renderComponent(App, rootElement);
    } else {
        console.error(`Root element "${selector}" not found. Cannot set root element.`);
    }
}   

export async function renderRoute(pathname) {
    console.log(`Rendering route for: ${pathname}`);
    if (!rootElement) {
        console.error("Root element not initialized. Call initialize() first. Aborting render.");
        return;
    }
    
    for (const hook of lifecycleHooks.beforeRender) {
        try {
            await Promise.resolve(hook());
        } catch (e) {
            console.error('Error in beforeRender hook:', e);
        }
    }

    try {
        let elementToRender;
        const [cleanPath, queryString] = pathname.split("?");
        const queryParams = parseQuery(queryString || "");
        const routeMatch = findMatchingRoute(cleanPath);
        console.log('Route match:', routeMatch);

        if (routeMatch) {
            const newMatched = routeMatch.matched;
            const newRoutes = newMatched.map(m => m.route);
            const { matched, params } = routeMatch;
            // Concatenate titles from all matched routes, root first
            const titles = matched
                .map(m => {
                    const t = m.route.meta?.title;
                    if (typeof t === 'function') return t({ params, query: queryParams });
                    return t;
                })
                .filter(Boolean)
                .reverse(); // Reverse so that the most nested comes last
            if (titles.length) {
                document.title = titles.join(' / ');
            }

            // --- Named outlet support ---
            // If only the leaf changed, update only the relevant outlet
            if (
                prevMatchedRoutes.length &&
                prevMatchedRoutes.length === newRoutes.length &&
                prevMatchedRoutes.slice(0, -1).every((r, i) => r === newRoutes[i])
            ) {
                const leaf = newMatched[newMatched.length - 1];
                const componentFn = await resolveComponent(leaf.route.componentFn);
                console.log('Updating outlet for leaf route:', leaf.route.path);
                // Use outlet name if provided, fallback to default
                const outletName = leaf.route.outlet || 'main';
                const outletSelector = outletName === 'main'
                    ? '[x-outlet], [x-outlet="main"]'
                    : `[x-outlet="${outletName}"]`;
                const outlet = document.querySelector(outletSelector);
                if (outlet) {
                    // Compose props as in the full rendering path
                    const combinedParams = { ...leaf.params, ...routeMatch.params };
                    const props = {
                        params: combinedParams,
                        query: queryParams,
                        children: undefined, // No nested children in partial update
                        outlet: outletName
                    };
                    renderComponent(
                        () => componentFn(props),
                        outlet
                    );
                    prevMatchedRoutes = newRoutes;
                    return;
                }
            }

            // Compose nested layouts asynchronously
            elementToRender = await (async () => {
                let childComponentRenderFn = null;
                // Iterate backwards to compose from the inside out
                for (let i = matched.length - 1; i >= 0; i--) {
                    const { route, params: routeParams } = matched[i];
                    
                    // Resolve the component which might be a URL
                    const componentFn = await resolveComponent(route.componentFn);
                    console.log(`Resolved component "${route.componentFn}" to function:`, componentFn);
                    // Capture the current child for the closure
                    const currentChildFn = childComponentRenderFn;
                    
                    // Create the new parent render function
                    childComponentRenderFn = () => {
                        const combinedParams = { ...routeParams, ...params };
                        const outletName = route.outlet || (i === matched.length - 1 ? 'main' : undefined);
                        const props = {
                            params: combinedParams,
                            query: queryParams,
                            children: currentChildFn, // The previously created child render function
                            outlet: outletName
                        };
                        try {
                            // Execute the component function with its props
                            return componentFn(props);
                        } catch (err) {
                            console.error('Component render error:', err);
                            throw err;
                        }
                    };
                }
                // Execute the final, top-level render function
                return childComponentRenderFn ? childComponentRenderFn() : null;
            })();
        } else {
            document.title = '404 Not Found';
            elementToRender = createComponent('h1', { children: '404 Not Found' });
        }

        setCurrentView(elementToRender);
        // track full render
        if (routeMatch) {
            prevMatchedRoutes = routeMatch.matched.map(m => m.route);
        }

    } catch (err) {
        console.error('Render Error:', err);
        let errorContent;
        if (errorBoundary) {
            try {
                errorContent = errorBoundary({ error: err });
            } catch (boundaryErr) {
                console.error('Error in custom error boundary:', boundaryErr);
                errorContent = createDefaultErrorElement(err);
            }
        } else {
            errorContent = createDefaultErrorElement(err);
        }
        setCurrentView(errorContent);
    } finally {
        for (const hook of lifecycleHooks.afterRender) {
            try {
                await Promise.resolve(hook());
            } catch (e) {
                console.error('Error in afterRender hook:', e);
            }
        }
    }
}

function createDefaultErrorElement(err) {
    const errorMessage = typeof err === 'string' ? err : err.message || 'An unknown error occurred.';
    return createComponent('div', {
        children: [
            createComponent('h1', { children: 'Application Error' }),
            createComponent('p', { children: escapeHtml(errorMessage) })
        ]
    });
}

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}