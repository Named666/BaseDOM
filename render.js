
// render.js

import { findMatchingRoute, parseQuery } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';
import { parseComponent } from './parser.js';
import { devWarn } from './index.js';


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

  if (componentCache.has(component)) {
    devWarn(`Component cache hit for: ${component}`);
    return componentCache.get(component);
  }

  try {
    const response = await fetch(component);
    if (!response.ok) throw new Error(`Failed to fetch component: ${component} (status: ${response.status})`);
    const sfcText = await response.text();
    const fn = await parseComponent(sfcText);
    // parsed component is expected to be a function(props) => element
    componentCache.set(component, fn);
    devWarn(`Component loaded and cached: ${component}`);
    return fn;
  } catch (error) {
    devWarn(`Component load failed: ${component}`, error);
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
    renderComponent(createComponent('div', { children: [currentView] }), rootElement);
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
    const [cleanPath, queryString] = pathname.split('?');
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
        document.title = titles.join(' / ');
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
      element = createComponent('h1', { children: '404 Not Found' });
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