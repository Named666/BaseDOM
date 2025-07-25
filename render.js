
// render.js
import { findMatchingRoute, parseQuery } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';
import { parseComponent } from './parser.js';


let errorBoundary = null;

export function setErrorBoundary(fn) { errorBoundary = fn; }


const hooks = { before: [], after: [] };

export function onBeforeRender(hook) { hooks.before.push(hook); }

export function onAfterRender(hook) { hooks.after.push(hook); }

let rootElement = null;
export let rootElementSelector = '#app';
const [currentView, setCurrentView] = signal(null);
let prevRoutes = [];
const componentCache = new Map();


async function resolveComponent(component) {
  if (typeof component !== 'string') return component;
  if (!component.endsWith('.html')) return component;
  if (componentCache.has(component)) return componentCache.get(component);
  try {
    const response = await fetch(component);
    if (!response.ok) throw new Error(`Failed to fetch component: ${component}`);
    const sfcText = await response.text();
    const fn = await parseComponent(sfcText);
    componentCache.set(component, fn);
    return fn;
  } catch (error) {
    return () => createComponent('div', {
      children: [
        createComponent('h3', { children: 'Component Load Error' }),
        createComponent('pre', { children: error.message, style: { color: 'red' } })
      ]
    });
  }
}


export function initialize(selector = '#app') {
  const el = document.querySelector(selector);
  if (el) {
    rootElement = el;
    renderComponent(createComponent('div', { children: [currentView] }), rootElement);
  }
}

export function setRootElement(selector) {
  const el = document.querySelector(selector);
  if (el) {
    rootElement = el;
    rootElementSelector = selector;
    renderComponent(createComponent('div', { children: [currentView] }), rootElement);
  }
}


export async function renderRoute(pathname) {
  if (!rootElement) return;
  for (const hook of hooks.before) await Promise.resolve(hook());
  try {
    let element;
    const [cleanPath, queryString] = pathname.split('?');
    const query = parseQuery(queryString || '');
    const match = findMatchingRoute(cleanPath);
    if (match) {
      const { matched, params } = match;
      const newRoutes = matched.map(m => m.route);
      // Set document title from route meta
      const titles = matched.map(m => {
        const t = m.route.meta?.title;
        return typeof t === 'function' ? t({ params, query }) : t;
      }).filter(Boolean).reverse();
      if (titles.length) document.title = titles.join(' / ');

      // Partial outlet update for leaf route
      if (
        prevRoutes.length &&
        prevRoutes.length === newRoutes.length &&
        prevRoutes.slice(0, -1).every((r, i) => r === newRoutes[i])
      ) {
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
        }
      }

      // Compose nested layouts from matched routes
      element = await (async () => {
        let childFn = null;
        for (let i = matched.length - 1; i >= 0; i--) {
          const { route, params: routeParams } = matched[i];
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
      })();
    } else {
      document.title = '404 Not Found';
      element = createComponent('h1', { children: '404 Not Found' });
    }
    setCurrentView(element);
    if (match) prevRoutes = match.matched.map(m => m.route);
  } catch (err) {
    let errorContent;
    if (errorBoundary) {
      try { errorContent = errorBoundary({ error: err }); }
      catch { errorContent = createDefaultErrorElement(err); }
    } else {
      errorContent = createDefaultErrorElement(err);
    }
    setCurrentView(errorContent);
  } finally {
    for (const hook of hooks.after) await Promise.resolve(hook());
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