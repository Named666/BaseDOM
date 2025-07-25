// navigation.js

import { renderRoute } from './render.js';
import { findMatchingRoute, parseQuery } from './router.js';
import { renderComponent, createComponent } from './components.js';
import { signal } from './state.js';
import { escapeHtml, rootElementSelector } from './render.js';

// --- Centralized Signals ---
export const [currentRoute, setCurrentRoute] = signal(null);
export const [currentView, setCurrentView] = signal(null);
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

// --- Navigation ---
export async function navigate(path, { replace = false, triggeredByPopstate = false } = {}) {
  if (pendingNavigation()) throw new Error('Navigation already in progress');
  const currentPath = location.pathname + location.search;
  if (path === currentPath && !replace) return;
  saveScroll(currentPath, window.scrollX, window.scrollY);
  setPendingNavigation(path);
  try {
    const currentRouteMatch = findMatchingRoute(currentPath.split('?')[0]);
    const [targetPath] = path.split('?');
    const targetRouteMatch = findMatchingRoute(targetPath);
    const context = {
      from: currentRouteMatch,
      to: targetRouteMatch,
      path,
      query: parseQuery(path.split('?')[1] || '')
    };
    // beforeLeave guards
    if (currentRouteMatch) {
      const leaveGuards = [
        ...globalGuards.beforeLeave,
        ...(currentRouteMatch.matched.at(-1)?.route?.guards?.beforeLeave || [])
      ];
      const leaveResult = await runGuards(leaveGuards, context);
      if (leaveResult === false) return;
      if (typeof leaveResult === 'string') {
        setPendingNavigation(null);
        return navigate(leaveResult, { replace: true });
      }
    }
    // beforeEnter guards
    if (targetRouteMatch) {
      const enterGuards = [
        ...globalGuards.beforeEnter,
        ...(targetRouteMatch.matched.at(-1)?.route?.guards?.beforeEnter || [])
      ];
      const enterResult = await runGuards(enterGuards, context);
      if (enterResult === false) return;
      if (typeof enterResult === 'string') {
        setPendingNavigation(null);
        return navigate(enterResult, { replace: true });
      }
    }
    // Render route and update signals
    await renderRoute(path);
    if (!triggeredByPopstate) {
      if (replace) history.replaceState({}, '', path);
      else history.pushState({}, '', path);
    }
    setCurrentRoute(path);

    // --- Custom scrollBehavior support ---
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

// --- Link Interception ---
export function attachLinkInterception() {
  document.body.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[x-link], a[href]');
    if (link && link.origin === location.origin) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href !== location.pathname + location.search) navigate(href);
    }
  });
}