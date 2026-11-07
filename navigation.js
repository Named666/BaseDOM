// navigation.js

import { renderRoute, escapeHtml, rootElementSelector, setCurrentView } from './render.js';
import { findMatchingRoute, parseQuery } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';

// --- Centralized Signals ---
export const [currentRoute, setCurrentRoute] = signal(null);
export const [pendingNavigation, setPendingNavigation] = signal(null);
export const [errorState, setErrorState] = signal(null);
export const [scrollPositions, setScrollPositions] = signal({});

// --- Scroll Position Management ---
export function saveScroll(path, x, y) {
  setScrollPositions({ ...scrollPositions(), [path]: { x, y } });
}
export function restoreScroll(path) {
  const pos = scrollPositions()[path] || { x: 0, y: 0 };
  window.scrollTo(pos.x, pos.y);
}

// --- Global Navigation Guards ---
const globalGuards = {
  beforeEnter: [],
  beforeLeave: []
};
export function addGlobalBeforeEnterGuard(fn) {
  globalGuards.beforeEnter.push(fn);
}
export function addGlobalBeforeLeaveGuard(fn) {
  globalGuards.beforeLeave.push(fn);
}
async function runGuards(guards, context) {
  for (const guard of guards) {
    try {
      const result = await guard(context);
      if (result === false || typeof result === 'string') return result;
    } catch (e) {
      setErrorState(e);
      return false;
    }
  }
  return true;
}

function buildGuards(routeMatch, type) {
  // type is 'beforeEnter' or 'beforeLeave'
  const global = globalGuards[type] || [];
  const routeGuards = routeMatch?.matched?.at(-1)?.route?.guards?.[type] || [];
  return [...global, ...routeGuards];
}

async function handleGuardResult(result, path) {
  if (result === false) {
    setPendingNavigation(null);
    return false;
  }
  if (typeof result === 'string') {
    setPendingNavigation(null);
    navigate(result, { replace: true });
    return false;
  }
  return true;
}

async function runLeaveGuards(currentRouteMatch, context) {
  if (!currentRouteMatch) return true;
  const leaveGuards = buildGuards(currentRouteMatch, 'beforeLeave');
  const leaveResult = await runGuards(leaveGuards, context);
  return handleGuardResult(leaveResult, context.path);
}

async function runEnterGuards(targetRouteMatch, context) {
  if (!targetRouteMatch) return true;
  const enterGuards = buildGuards(targetRouteMatch, 'beforeEnter');
  const enterResult = await runGuards(enterGuards, context);
  return handleGuardResult(enterResult, context.path);
}

async function handleScrollBehavior(targetRouteMatch, currentRouteMatch, path) {
  let scrolled = false;
  if (targetRouteMatch && targetRouteMatch.matched.length) {
    // Find the deepest matched route with scrollBehavior
    for (let i = targetRouteMatch.matched.length - 1; i >= 0; i--) {
      const route = targetRouteMatch.matched[i].route;
      if (typeof route.scrollBehavior === 'function') {
        const scrollOptions = route.scrollBehavior({
          from: currentRouteMatch,
          to: targetRouteMatch,
          path,
          query: parseQuery(path.split('?')[1] || '')
        });
        if (scrollOptions && typeof window.scrollTo === 'function') {
          window.scrollTo(scrollOptions);
          scrolled = true;
          break;
        }
      }
    }
  }
  if (!scrolled) {
    restoreScroll(path);
  }
}

// --- Navigation ---
export async function navigate(path, { replace = false, triggeredByPopstate = false } = {}) {
  if (pendingNavigation()) throw new Error('Navigation already in progress');
  // Determine the previous (current) path. Prefer the `currentRoute` signal if available
  // because when `popstate` fires `location` is already the new URL.
  const prevPath = currentRoute() || (location.pathname + location.search);
  if (path === prevPath && !replace && !triggeredByPopstate) return;
  // Only save scroll for navigations initiated by the app (not browser back/forward)
  if (!triggeredByPopstate) saveScroll(prevPath, window.scrollX, window.scrollY);
  try {
    const currentRouteMatch = findMatchingRoute((prevPath || '').split('?')[0]);
    const [targetPath] = path.split('?');
    const targetRouteMatch = findMatchingRoute(targetPath);
    const context = {
      from: currentRouteMatch,
      to: targetRouteMatch,
      path,
      query: parseQuery(path.split('?')[1] || '')
    };
    
    // Run guards
    if (!(await runLeaveGuards(currentRouteMatch, context))) return;
    if (!(await runEnterGuards(targetRouteMatch, context))) return;

    // All guards passed - mark navigation as pending and proceed to render
    setPendingNavigation(path);

    // Render route and update signals
    await renderRoute(path);
    // Only modify browser history for navigations initiated by the app
    if (!triggeredByPopstate) {
      if (replace) history.replaceState({}, '', path);
      else history.pushState({}, '', path);
    }
    // Update the `currentRoute` signal so future popstate handlers know the origin
    setCurrentRoute(path);

    // Handle scroll behavior
    await handleScrollBehavior(targetRouteMatch, currentRouteMatch, path);
  } catch (err) {
    setErrorState(err);
    renderErrorView(err);
  } finally {
    setPendingNavigation(null);
  }
}



// --- Error View Rendering ---
function renderErrorView(err) {
  const rootEl = document.querySelector(rootElementSelector) || document.body;
  const errorMessage = typeof err === 'string' ? err : err.message || 'An unknown error occurred.';
  const el = createComponent('div', {
    children: [
      createComponent('h1', { children: 'Navigation Error' }),
      createComponent('p', { children: escapeHtml(errorMessage) })
    ]
  });
  setCurrentView(el);
  renderComponent(el, rootEl);
}

let linkInterceptionAttached = false;

/**
 * SPA interception is opt-in. Only anchors with `x-link` are handled.
 * Ordinary links keep the browser's default navigation.
 * @param {Element} link
 * @param {MouseEvent} event
 */
export function shouldInterceptLink(link, event) {
  if (!link || !event) return false;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!link.hasAttribute('x-link')) return false;
  if (link.target && link.target !== '_self') return false;
  if (link.hasAttribute('download')) return false;
  if (typeof location !== 'undefined' && link.origin !== location.origin) return false;
  return true;
}

// --- Link Interception ---
export function attachLinkInterception() {
  if (linkInterceptionAttached) return;
  if (typeof document === 'undefined' || !document.body) return;
  linkInterceptionAttached = true;
  document.body.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[x-link]') : null;
    if (!shouldInterceptLink(link, event)) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (href && href !== location.pathname + location.search) navigate(href);
  });
}