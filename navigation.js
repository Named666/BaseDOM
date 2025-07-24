// navigation.js
import { findMatchingRoute, parseQuery } from './router.js';
import { renderRoute, escapeHtml, rootElementSelector} from './render.js'; // Import rootElementSelector

// Scroll position management
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
    if (pos) {
        window.scrollTo(pos.x, pos.y);
    } else {
        window.scrollTo(0, 0); // Scroll to top for new pages
    }
}

// Global guards storage
const globalGuards = {
    beforeEnter: [],
    beforeLeave: []
};

// Run guards sequentially, handle async
async function runGuards(guards, context) {
    for (const guard of guards) {
        try {
            const result = await Promise.resolve(guard(context)); // Ensure guard is awaited
            if (result === false || typeof result === 'string') {
                return result; // Navigation cancelled or redirected
            }
        } catch (e) {
            console.error('Guard error:', e);
            return false; // Treat guard error as cancellation
        }
    }
    return true; // All guards passed
}

export function addGlobalBeforeEnterGuard(guardFn) {
    globalGuards.beforeEnter.push(guardFn);
}

export function addGlobalBeforeLeaveGuard(guardFn) {
    globalGuards.beforeLeave.push(guardFn);
}

// Navigation state to prevent concurrent navigations
const navigation = {
    pending: null, // Path of pending navigation
    current: null, // Current successfully navigated path
    // resolve and reject are managed within the promise in navigate()
};

// Modified navigate to handle guards and navigation state
export async function navigate(path, { replace = false, triggeredByPopstate = false } = {}) {
    return new Promise(async (resolve, reject) => {
        if (navigation.pending) {
            console.warn('Navigation already in progress. Ignoring new navigation to:', path);
            return reject(new Error('Navigation already in progress'));
        }

        const currentPath = location.pathname + location.search;
        if (path === currentPath && !replace) {
            console.log('Already at target path, resolving navigation.');
            return resolve();
        }

        saveScrollPosition();
        navigation.pending = path;

        try {
            // Only match current route for guards
            const currentRouteMatch = findMatchingRoute(currentPath.split('?')[0]);
            // Do NOT call findMatchingRoute for target path here
            const [cleanTargetPath, targetQueryString] = path.split('?');
            const targetQueryParams = parseQuery(targetQueryString || '');

            // If you need guards for the target, you can match, but avoid logging
            const targetRouteMatch = findMatchingRoute(cleanTargetPath);

            const navigationContext = {
                from: currentRouteMatch,
                to: targetRouteMatch,
                path,
                query: targetQueryParams
            };

            // Execute beforeLeave guards
            if (currentRouteMatch) {
                const leaveGuards = [
                    ...globalGuards.beforeLeave,
                    ...(currentRouteMatch.matched[currentRouteMatch.matched.length - 1]?.route?.guards?.beforeLeave || [])
                ];
                const leaveResult = await runGuards(leaveGuards, navigationContext);
                if (leaveResult === false) {
                    return reject(new Error('Navigation cancelled by beforeLeave guard.'));
                }
                if (typeof leaveResult === 'string') {
                    // Redirect: recursively call navigate and propagate result
                    navigation.pending = null; // Clear pending state for the current attempt
                    return navigate(leaveResult, { replace: true }).then(resolve, reject);
                }
            }

            // Execute beforeEnter guards
            if (targetRouteMatch) {
                const enterGuards = [
                    ...globalGuards.beforeEnter,
                    ...(targetRouteMatch.matched[targetRouteMatch.matched.length - 1]?.route?.guards?.beforeEnter || [])
                ];
                const enterResult = await runGuards(enterGuards, navigationContext);
                if (enterResult === false) {
                    return reject(new Error('Navigation cancelled by beforeEnter guard.'));
                }
                if (typeof enterResult === 'string') {
                    // Redirect: recursively call navigate and propagate result
                    navigation.pending = null; // Clear pending state for the current attempt
                    return navigate(enterResult, { replace: true }).then(resolve, reject);
                }
            }
            // Render the new route
            await renderRoute(path);

            if (!triggeredByPopstate) {
                if (replace) {
                    history.replaceState({}, "", path);
                } else {
                    history.pushState({}, "", path);
                }
            }

            // Update current navigation state
            navigation.current = path;
            restoreScrollPosition(path);
            resolve(); // Resolve the navigation promise

        } catch (err) {
            console.error('Navigation Error:', err);
            // Attempt to restore previous route if an error occurs during navigation/rendering
            if (navigation.current && navigation.current !== path) { // Only restore if not already on the error path
                console.warn('Attempting to restore previous route due to error:', navigation.current);
                try {
                    // Make sure root element exists for restoration
                    await renderRoute(navigation.current); // Re-attempt with the previous successful path
                    // Even if restoration succeeds, the original navigation attempt failed.
                    reject(err);
                } catch (restoreErr) {
                    console.error('Failed to restore previous route:', restoreErr);
                    // Fallback to generic error if restoration fails
                    const defaultErrorElement = document.createElement('div');
                    defaultErrorElement.innerHTML = `<h1>Navigation Error</h1><p>${escapeHtml(err.message || 'An unknown error occurred.')}</p>`;
                    // Dynamically get the root element if it was somehow lost
                    renderComponent(defaultErrorElement, document.querySelector(rootElementSelector) || document.body);
                    reject(err); // Reject with the original error
                }
            } else {
                console.error('No previous route to restore or already on the failed path. Showing generic error.');
                const defaultErrorElement = document.createElement('div');
                defaultErrorElement.innerHTML = `<h1>Navigation Error</h1><p>${escapeHtml(err.message || 'Unknown')}</p>`;
                renderComponent(defaultErrorElement, document.querySelector(rootElementSelector) || document.body);
                reject(err); // Always reject the navigation promise that failed
            }
        } finally {
            navigation.pending = null; // Always clear pending state
        }
    });
}

export function attachLinkInterception() {
    document.body.addEventListener('click', (e) => {
        // Only intercept left-clicks without modifier keys
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = e.target.closest('a[x-link], a[href]');
        if (link && link.origin === location.origin) { // Only intercept internal links
            e.preventDefault();
            // Prevent double navigation if already at the target path
            const href = link.getAttribute("href");
            if (href !== location.pathname + location.search) {
                navigate(href);
            }
        }
    });
}