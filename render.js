
// render.js

import { findMatchingRoute, parseQuery, routes } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';
import { parseComponent } from './parser.js';
import { devWarn } from './index.js';
import { resolveComponentPath } from './paths.js';


let errorBoundary = null;

export function setErrorBoundary(fn) { errorBoundary = fn; }


const hooks = { before: [], after: [] };

export function onBeforeRender(hook) { hooks.before.push(hook); }

export function onAfterRender(hook) { hooks.after.push(hook); }

let rootElement = null;
export let rootElementSelector = '#app';
const [currentView, setCurrentView] = signal(null);
export { setCurrentView };
let prevRoutes = [];
const componentCache = new Map();

export function clearComponentCache(path) {
  if (path) {
    componentCache.delete(path);
    devWarn(`Component cache cleared for: ${path}`);
  } else {
    componentCache.clear();
    devWarn('Component cache cleared');
  }
}

const hmrProxies = new Map();

/**
 * Gets or creates an HMR proxy for a component.
 * @param {string} id - Unique ID for the component (usually the file path).
 * @param {Function} initialFn - The initial component function.
 * @returns {Function} A proxy function that can be updated.
 */
export function getHMRProxy(id, initialFn) {
  if (hmrProxies.has(id)) {
    const [getFn, setFn] = hmrProxies.get(id);
    if (initialFn) setFn(() => initialFn);
    return (props) => getFn()(props);
  }
  
  const [getFn, setFn] = signal(() => initialFn);
  const proxy = (props) => {
    const fn = getFn();
    return typeof fn === 'function' ? fn(props) : null;
  };
  
  proxy.__isHMRProxy = true;
  proxy.__hmrId = id;
  proxy.update = (newFn) => {
    setFn(() => newFn);
  };
  
  hmrProxies.set(id, [getFn, setFn, proxy]);
  return proxy;
}

// HMR Support for Vite
if (typeof window !== 'undefined') {
  window.addEventListener('basedom:hmr', async (e) => {
    const { file, component } = e.detail;
    devWarn(`HMR update received for: ${file}`);
    
    // Normalize file path to match what might be in the cache
    const relativePath = file.replace(/.*\/public\//, '/').replace(/.*\/src\//, '/src/');
    
    // Update proxy if it exists
    if (hmrProxies.has(file)) {
      const [, setFn] = hmrProxies.get(file);
      setFn(() => component);
    }
    
    clearComponentCache(relativePath);
    
    // Re-render the current route to reflect changes
    if (typeof renderRoute === 'function') {
      await renderRoute(location.pathname + location.search);
    }
  });
}


async function resolveComponent(component) {
  // Normalize to always return a function that accepts props
  // If it's already a function, return it directly to avoid creating an unnecessary wrapper
  if (typeof component === 'function') {
    return component;
  }

  if (typeof component !== 'string') {
    // If it's a DOM node or other value, wrap it into a function
    return () => component;
  }

  // If it's a string, treat .html paths specially; otherwise return a function that returns the string
  if (!component.endsWith('.html')) return () => component;
  const componentPath = resolveComponentPath(component);

  if (componentCache.has(componentPath)) {
    devWarn(`Component cache hit for: ${componentPath}`);
    return componentCache.get(componentPath);
  }

  try {
    const response = await fetch(componentPath);
    if (!response.ok) throw new Error(`Failed to fetch component: ${componentPath} (status: ${response.status})`);
    const sfcText = await response.text();
    const fn = await parseComponent(sfcText);
    // parsed component is expected to be a function(props) => element
    componentCache.set(componentPath, fn);
    devWarn(`Component loaded and cached: ${componentPath}`);
    return fn;
  } catch (error) {
    devWarn(`Component load failed: ${componentPath}`, error);
    return () => createErrorElement('Component Load Error', error.message);
  }
}

function isPartialOutletUpdate(prevRoutes, newRoutes) {
  if (!prevRoutes || !newRoutes) return false;
  if (prevRoutes.length === 0) return false;
  if (prevRoutes.length !== newRoutes.length) return false;
  // all but last must match
  for (let i = 0; i < prevRoutes.length - 1; i++) {
    if (prevRoutes[i] !== newRoutes[i]) return false;
  }
  return true;
}


// Utility function for setting up the root element
function setupRootElement(selector) {
  const el = document.querySelector(selector);
  if (el) {
    devWarn(`Setting up root element at selector: ${selector}`, el);
    rootElement = el;
    rootElementSelector = selector;
    // Render the currentView directly (renderComponent is reactive now)
    renderComponent(currentView, rootElement);
  } else {
    devWarn(`Root element not found for selector: ${selector}`);
  }
  return el;
}

export function initialize(selector = '#app') {
  return setupRootElement(selector);
}

export function setRootElement(selector) {
  return setupRootElement(selector);
}


async function composeNestedLayouts(matched, params, query) {
  let childFn = null;
  for (let i = matched.length - 1; i >= 0; i--) {
    const { route, params: routeParams } = matched[i];
    devWarn(`Composing layout: ${route.path}`);
    const componentFn = await resolveComponent(route.componentFn);
    const currentChild = childFn;
    childFn = () => {
      const props = {
        params: { ...routeParams, ...params },
        query,
        children: currentChild,
        outlet: route.outlet || (i === matched.length - 1 ? 'main' : undefined)
      };
      return componentFn(props);
    };
  }
  return childFn ? childFn() : null;
}

export async function renderRoute(pathname) {
  if (!rootElement) {
    devWarn('renderRoute called but rootElement is not set.');
    return;
  }
  for (const hook of hooks.before) {
    devWarn('Calling before-render hook', hook);
    await Promise.resolve(hook());
  }
  try {
    let element;
    let notFoundElement;
    const [rawPath, queryString] = pathname.split('?');
    // Normalize path so it always starts with '/'
    const cleanPath = rawPath === '' || rawPath == null ? '/' : (rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
    const query = parseQuery(queryString || '');
    devWarn(`Rendering route: ${cleanPath}`);
    const match = findMatchingRoute(cleanPath);
    if (match) {
      const { matched, params } = match;
      const newRoutes = matched.map(m => m.route);
      // Set document title from route meta
      const titles = matched.map(m => {
        const t = m.route.meta?.title;
        return typeof t === 'function' ? t({ params, query }) : t;
      }).filter(Boolean).reverse();
      if (titles.length) {
        // reverse the order of titles for proper hierarchy
        titles.reverse();
        document.title = titles.join('')
      }

  // Partial outlet update for leaf route
  if (isPartialOutletUpdate(prevRoutes, newRoutes)) {
        const leaf = matched[matched.length - 1];
        const componentFn = await resolveComponent(leaf.route.componentFn);
        const outletName = leaf.route.outlet || 'main';
        const outletSelector = outletName === 'main'
          ? '[x-outlet], [x-outlet="main"]'
          : `[x-outlet="${outletName}"]`;
        const outlet = document.querySelector(outletSelector);
        if (outlet) {
          const props = {
            params: { ...leaf.params, ...match.params },
            query,
            children: undefined,
            outlet: outletName
          };
          renderComponent(() => componentFn(props), outlet);
          prevRoutes = newRoutes;
          return;
        } else {
          devWarn(`Outlet not found: ${outletSelector}`);
        }
      }

      // Compose nested layouts from matched routes
      element = await composeNestedLayouts(matched, params, query);
    } else {
      document.title = '404 Not Found';
      devWarn(`Route not found: ${pathname}`);
      notFoundElement = createComponent('h1', { children: '404 Not Found' });
      // Use the component: for the route with the longest matching prefix, or fallback to a simple message
      // For example, /unknown would match a route with path /* and use its component, while /unknown/unknown would match /* and /unknown/* but prefer the latter if it exists
      const fallbackRoute = findFallbackRoute(cleanPath);
      if (fallbackRoute) {
        devWarn(`Using fallback route for unmatched path: ${fallbackRoute.path}`);
        // Pass children as a function to match how nested layouts receive their outlet content
        const outletName = fallbackRoute.outlet || 'main';
        const outletSelector = outletName === 'main'
          ? '[x-outlet], [x-outlet="main"]'
          : `[x-outlet="${outletName}"]`;
        const outlet = document.querySelector(outletSelector);
        const props = { params: {}, query, children: () => notFoundElement, outlet: outletName };
        if (outlet) {
          // Render only into the existing outlet (partial update) so the surrounding layout is preserved
          renderComponent(() => notFoundElement, outlet);
          return;
        }
        // Fallback to full root replacement if no outlet is present
        const componentFn = await resolveComponent(fallbackRoute.componentFn);
        element = componentFn(props);
      } else {
        element = notFoundElement;
      }
    }
    setCurrentView(element);
    if (match) prevRoutes = match.matched.map(m => m.route);
  } catch (err) {
    const errorContent = await handleError(err, 'during renderRoute');
    setCurrentView(errorContent);
  } finally {
    for (const hook of hooks.after) {
      devWarn('Calling after-render hook', hook);
      await Promise.resolve(hook());
    }
  }
}

export function findFallbackRoute(path) {
  // Choose the fallback route by longest matching prefix.
  devWarn(`Searching fallback for path: ${path}`);
  try {
    devWarn(`Available routes: ${routes.map(r => r.path).join(', ')}`);
  } catch (e) {
    devWarn('Could not list routes for debugging', e);
  }
  let fallback = null;
  let longestPrefix = -1;
  for (const route of routes) {
    let prefix = null;
    if (route.path === '*' || route.path === '/*') {
      prefix = '';
    } else if (route.path === '/') {
      prefix = '/';
    } else if (route.path.endsWith('/*')) {
      prefix = route.path.slice(0, -2);
    } else if (route.path.endsWith('*')) {
      prefix = route.path.slice(0, -1);
    } else {
      // exact path (no wildcard) should only match itself; include as prefix
      prefix = route.path;
    }

    devWarn(`Checking route '${route.path}' with prefix '${prefix}' against path '${path}'`);
    if (prefix !== null && path.startsWith(prefix)) {
      devWarn(`Prefix matched: '${prefix}' (len ${prefix.length})`);
      if (prefix.length > longestPrefix) {
        longestPrefix = prefix.length;
        fallback = route;
        devWarn(`New fallback selected: ${route.path}`);
      }
    }
  }
  devWarn(`Fallback result for '${path}': ${fallback ? fallback.path : 'none'}`);
  return fallback;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Utility function for consistent error handling
function createErrorElement(title, message, style = { color: 'red', border: '1px solid red', padding: '10px' }) {
  return createComponent('div', {
    style,
    children: [
      createComponent('h3', { children: title }),
      createComponent('pre', { children: escapeHtml(message) })
    ]
  });
}

// Utility function for handling errors with boundary
async function handleError(err, context = '') {
  devWarn(`Error ${context}: ${err.message}`, err);
  let errorContent;
  if (errorBoundary) {
    try {
      errorContent = errorBoundary({ error: err });
      devWarn('Custom errorBoundary handled the error.');
    } catch (e) {
      devWarn('Error in errorBoundary handler', e);
      errorContent = createDefaultErrorElement(err);
    }
  } else {
    errorContent = createDefaultErrorElement(err);
  }
  return errorContent;
}

function createDefaultErrorElement(err) {
  const errorMessage = typeof err === 'string' ? err : err.message || 'An unknown error occurred.';
  return createErrorElement('Application Error', errorMessage);
}
