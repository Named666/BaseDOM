// router.js
import { renderRoute } from './render.js';
import { attachLinkInterception } from './navigation.js';

export const routes = [];

/**
 * Defines a route configuration and adds it to the global routes array.
 * When called recursively for child routes, it returns the processed route object
 * without adding it to the global array.
 * @param {object|string} config - Route configuration or path string.
 * @param {function} componentFn - The component function to render.
 * @param {object} [guards={}] - Route-specific navigation guards.
 * @param {boolean} [isChild=false] - Internal flag to indicate if it's a child route.
 * @param {object} [inheritedMeta={}] - Meta information inherited from parent routes.
 * @returns {object} The processed route object.
 */
function defineRoute(config, componentFn, guards = {}, isChild = false, inheritedMeta = {}) {
    // Normalize input to always be an object for consistency
    const routeConfig = typeof config === 'string' ?
        { path: config, component: componentFn, guards } :
        { ...config, component: config.component || componentFn, guards: config.guards || {} };
    // Extract parent meta if available, otherwise use an empty object
    const currentRouteConfigMeta = routeConfig.meta || {};

    // Extract child meta if available, otherwise use an empty object
    const combinedCurrentMeta = { ...inheritedMeta, ...currentRouteConfigMeta };
    const { path, component, children } = routeConfig;

    // Normalize path to remove trailing slash unless it's the root path "/"
    // For child routes, don't add leading slash - they should be relative to parent
    // For parent routes, ensure they start with slash
    const normalizedPath = isChild ? 
        (path === '/' ? '' : path.replace(/^\/+/, '').replace(/\/+$/, '')) :
        (path.startsWith('/') ? path : `/${path}`);
    const finalPath = normalizedPath === '/' ? '/' : normalizedPath.replace(/\/$/, '').replace(/\/\//g, '/');

    const paramNames = [];

    const regex = new RegExp(
      '^' + finalPath
        .replace(/\/+$/, '')                       // Remove trailing slashes
        .replace(/\/:(\w+)\?/g, (_, name) => {     // Optional parameters like `:id?`
          paramNames.push(name);
          return '(?:/([^/]+))?';
        })
        .replace(/:(\w+)/g, (_, name) => {         // Required parameters
          paramNames.push(name);
          return '([^/]+)';
        })
        .replace(/\*([\w]+)$/g, (_, name) => {     // Wildcard/catch-all at the end
          paramNames.push(name);
          return '(.*)';
        }) + (isChild ? '' : '/?') + (children && children.length > 0 ? '' : '$')  // For parent routes with children, don't end with $
    );

    function joinPaths(parent, child) {
      if (!child) return parent;
      if (parent === '/') return '/' + child.replace(/^\//, '');
      return parent.replace(/\/$/, '') + '/' + child.replace(/^\//, '');
    }

    const routeObject = {
        path: finalPath,
        regex,
        componentFn: routeConfig.component, // Make sure we're getting the component from routeConfig
        paramNames,
        guards: routeConfig.guards || {},
        meta: combinedCurrentMeta,
        children: children?.map(child => {
            // When recursively calling defineRoute, pass the component properly
            const childRoute = defineRoute(
                child,
                child.component, // This ensures child.component is used 
                child.guards,
                true,
                combinedCurrentMeta
            );
            // Construct full path for debugging/reference, ensuring no double slashes
            childRoute.fullPath = joinPaths(finalPath, childRoute.path);

            return childRoute;
        }) || []
    };

    if (!isChild) {
        routes.push(routeObject);
    }
    // Return the processed route object, useful for the recursive call
    return routeObject;
}

// Export the function for user consumption
export { defineRoute };

/**
 * Recursively attempts to match a given path against a list of routes.
 * @param {string} path - The full path to match.
 * @param {Array} routeList - The list of routes (top-level or children).
 * @param {string} currentMatchedPathSegment - The path segment matched so far by parents.
 * @returns {object|null} An object containing matched routes and params, or null if no match.
 */
function matchNestedRoute(path, routeList = routes, currentMatchedPathSegment = '') {
    console.debug(`Trying to match path: "${path}" with current segment: "${currentMatchedPathSegment}"`);
    //console.debug(`Available routes:`, routeList.map(r => r.path));
    
    // Normalize path to match, ensure it starts with / and no trailing slash unless it's "/"
    const normalizedPathToMatch = path === '/' ? '/' : path.replace(/\/$/, '');
    
    for (const route of routeList) {
        // For child routes, we need to match against the remaining path after the parent match
        const remainingPath = normalizedPathToMatch.substring(currentMatchedPathSegment.length);
        const pathToTest = currentMatchedPathSegment === '' ? normalizedPathToMatch : remainingPath;
        
        //console.debug(`Testing route "${route.path}" against pathToTest: "${pathToTest}"`);
        
        const match = pathToTest.match(route.regex);
        
        if (match) {
            const matchedSegment = match[0];
            const params = {};
            route.paramNames.forEach((name, i) => {
                params[name] = match[i + 1];
            });

            const newMatchedPathSegment = currentMatchedPathSegment + matchedSegment;
            const stillRemainingPath = normalizedPathToMatch.substring(newMatchedPathSegment.length);
            const hasMorePath = stillRemainingPath.length > 0 && stillRemainingPath !== '/';

            console.debug(`Matched! newMatchedPathSegment: "${newMatchedPathSegment}", stillRemainingPath: "${stillRemainingPath}", hasMorePath: ${hasMorePath}`);

            if (!hasMorePath) {
                // Exact match - check if there's an index child route
                if (route.children?.length) {
                    const indexChild = route.children.find(child => child.path === '' || child.path === '/');
                    if (indexChild) {
                        return {
                            matched: [{ route, params }, { route: indexChild, params: {} }],
                            params: { ...params }
                        };
                    }
                }
                return {
                    matched: [{ route, params }],
                    params
                };
            }

            // Recursively match child routes
            if (route.children?.length) {
                const childMatch = matchNestedRoute(normalizedPathToMatch, route.children, newMatchedPathSegment);
                if (childMatch) {
                    return {
                        matched: [{ route, params }, ...childMatch.matched],
                        params: { ...params, ...childMatch.params }
                    };
                }
            }

            // Wildcard match returns here too
            if (route.path.includes('*') && route.paramNames.length) {
                return {
                    matched: [{ route, params }],
                    params
                };
            }
        }
    }
    return null;
}

export function parseQuery(queryString) {
    const params = new URLSearchParams(queryString);
    const query = {};
    for (const [key, value] of params.entries()) {
        query[key] = value;
    }
    return query;
}

export function findMatchingRoute(path) {
    const [cleanPath, queryString] = path.split('?');
    const result = matchNestedRoute(cleanPath, routes);
    const query = parseQuery(queryString || '');

    if (result) {
        const combinedMeta = result.matched.reduce((acc, { route }) => ({ ...acc, ...route.meta }), {});
        return {
            path: cleanPath,
            matched: result.matched,
            params: result.params,
            query,
            meta: combinedMeta,
        };
    }
    return null;
}

export function startRouter() {
    window.addEventListener("popstate", () => renderRoute(location.pathname + location.search));
    // Initial render and attachLinkInterception are now handled in startApp for unified startup
}