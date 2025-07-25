// navigation.js

// SPA navigation and route management
import { findMatchingRoute, parseQuery } from './router.js';
import { renderRoute, escapeHtml, rootElementSelector } from './render.js';

// --- Scroll Position Management ---
const scrollPositions = new Map();
function saveScrollPosition() {
  if (navigation.current) {
    scrollPositions.set(navigation.current, {
      x: window.scrollX,
      y: window.scrollY
    });
  }
}
function restoreScrollPosition(path) {
  const pos = scrollPositions.get(path);
  window.scrollTo(pos?.x ?? 0, pos?.y ?? 0);
}

// --- Global Navigation Guards ---
const globalGuards = {
  beforeEnter: [],
  beforeLeave: []
};
/**
 * Add a global beforeEnter guard.
 */
export function addGlobalBeforeEnterGuard(fn) {
  globalGuards.beforeEnter.push(fn);
}
/**
 * Add a global beforeLeave guard.
 */
export function addGlobalBeforeLeaveGuard(fn) {
  globalGuards.beforeLeave.push(fn);
}

/**
 * Run guards sequentially, handle async and cancellation.
 */
async function runGuards(guards, context) {
  for (const guard of guards) {
    try {
      const result = await guard(context);
      if (result === false || typeof result === 'string') return result;
    } catch (e) {
      console.error('Guard error:', e);
      return false;
    }
  }
  return true;
}

// --- Navigation State ---
const navigation = {
  pending: null,
  current: null
};

/**
 * SPA navigation with guards and scroll management.
 * Always uses renderRoute for rendering.
 */
export async function navigate(path, { replace = false, triggeredByPopstate = false } = {}) {
  if (navigation.pending) throw new Error('Navigation already in progress');
  const currentPath = location.pathname + location.search;
  if (path === currentPath && !replace) return;
  saveScrollPosition();
  navigation.pending = path;
  try {
    const currentRoute = findMatchingRoute(currentPath.split('?')[0]);
    const [targetPath] = path.split('?');
    const targetRoute = findMatchingRoute(targetPath);
    const context = {
      from: currentRoute,
      to: targetRoute,
      path,
      query: parseQuery(path.split('?')[1] || '')
    };
    // beforeLeave guards
    if (currentRoute) {
      const leaveGuards = [
        ...globalGuards.beforeLeave,
        ...(currentRoute.matched.at(-1)?.route?.guards?.beforeLeave || [])
      ];
      const leaveResult = await runGuards(leaveGuards, context);
      if (leaveResult === false) return;
      if (typeof leaveResult === 'string') {
        navigation.pending = null;
        return navigate(leaveResult, { replace: true });
      }
    }
    // beforeEnter guards
    if (targetRoute) {
      const enterGuards = [
        ...globalGuards.beforeEnter,
        ...(targetRoute.matched.at(-1)?.route?.guards?.beforeEnter || [])
      ];
      const enterResult = await runGuards(enterGuards, context);
      if (enterResult === false) return;
      if (typeof enterResult === 'string') {
        navigation.pending = null;
        return navigate(enterResult, { replace: true });
      }
    }
    await renderRoute(path);
    if (!triggeredByPopstate) {
      if (replace) history.replaceState({}, '', path);
      else history.pushState({}, '', path);
    }
    navigation.current = path;
    restoreScrollPosition(path);
  } catch (err) {
    console.error('Navigation Error:', err);
    // Attempt to restore previous route if possible
    if (navigation.current && navigation.current !== path) {
      try {
        await renderRoute(navigation.current);
      } catch (restoreErr) {
        const el = document.createElement('div');
        el.innerHTML = `<h1>Navigation Error</h1><p>${escapeHtml(err.message || 'An unknown error occurred.')}</p>`;
        renderComponent(el, document.querySelector(rootElementSelector) || document.body);
      }
    } else {
      const el = document.createElement('div');
      el.innerHTML = `<h1>Navigation Error</h1><p>${escapeHtml(err.message || 'Unknown')}</p>`;
      renderComponent(el, document.querySelector(rootElementSelector) || document.body);
    }
  } finally {
    navigation.pending = null;
  }
}

/**
 * Intercept internal link clicks and use SPA navigation.
 */
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