// router.js
// Core router for SPA navigation and route matching
import { renderRoute } from './render.js';
import { attachLinkInterception, navigate } from './navigation.js';

export const routes = [];

/**
 * Defines a route and its children, adding to the global routes array if top-level.
 * @param {object|string} config - Route config or path string.
 * @param {function} componentFn - Component function to render.
 * @param {object} [guards={}] - Route-specific navigation guards.
 * @param {boolean} [isChild=false] - Internal flag for child routes.
 * @param {object} [inheritedMeta={}] - Meta inherited from parent routes.
 * @returns {object} The processed route object.
 */
function defineRoute(config, componentFn, guards = {}, isChild = false, inheritedMeta = {}) {
  // Normalize config
  const routeConfig = typeof config === 'string'
    ? { path: config, component: componentFn, guards }
    : { ...config, component: config.component || componentFn, guards: config.guards || {} };
  const combinedMeta = { ...inheritedMeta, ...(routeConfig.meta || {}) };
  const { path, component, children } = routeConfig;

  // Path normalization
  const normalizedPath = isChild
    ? (path === '/' ? '' : path.replace(/^\/+/, '').replace(/\/+$/, ''))
    : (path.startsWith('/') ? path : `/${path}`);
  const finalPath = normalizedPath === '/' ? '/' : normalizedPath.replace(/\/$/, '').replace(/\/\//g, '/');

  // Param extraction
  const paramNames = [];
  const regex = new RegExp(
    '^' + finalPath
      .replace(/\/+$/, '')
      .replace(/\/:\w+\?/g, (_, name) => { paramNames.push(name); return '(?:/([^/]+))?'; })
      .replace(/:(\w+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; })
      .replace(/\*([\w]+)$/g, (_, name) => { paramNames.push(name); return '(.*)'; })
    + (isChild ? '' : '/?') + (children?.length ? '' : '$')
  );

  // Child route construction
  function joinPaths(parent, child) {
    if (!child) return parent;
    if (parent === '/') return '/' + child.replace(/^\//, '');
    return parent.replace(/\/$/, '') + '/' + child.replace(/^\//, '');
  }

  const routeObject = {
    path: finalPath,
    regex,
    componentFn: routeConfig.component,
    paramNames,
    guards: routeConfig.guards || {},
    meta: combinedMeta,
    children: children?.map(child => {
      const childRoute = defineRoute(child, child.component, child.guards, true, combinedMeta);
      childRoute.fullPath = joinPaths(finalPath, childRoute.path);
      return childRoute;
    }) || []
  };
  if (!isChild) routes.push(routeObject);
  return routeObject;
}
export { defineRoute };

/**
 * Recursively matches a path against nested routes.
 * @param {string} path - Path to match.
 * @param {Array} routeList - List of routes.
 * @param {string} currentMatchedPathSegment - Path matched so far.
 * @returns {object|null} Matched routes and params, or null.
 */
function matchNestedRoute(path, routeList = routes, currentMatchedPathSegment = '') {
  const normalizedPath = path === '/' ? '/' : path.replace(/\/$/, '');
  for (const route of routeList) {
    const remainingPath = normalizedPath.substring(currentMatchedPathSegment.length);
    const pathToTest = currentMatchedPathSegment === '' ? normalizedPath : remainingPath;
    const match = pathToTest.match(route.regex);
    if (match) {
      const matchedSegment = match[0];
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      const newMatchedPathSegment = currentMatchedPathSegment + matchedSegment;
      const stillRemainingPath = normalizedPath.substring(newMatchedPathSegment.length);
      const hasMorePath = stillRemainingPath.length > 0 && stillRemainingPath !== '/';
      if (!hasMorePath) {
        // Exact match, check for index child
        if (route.children?.length) {
          const indexChild = route.children.find(child => child.path === '' || child.path === '/');
          if (indexChild) {
            return { matched: [{ route, params }, { route: indexChild, params: {} }], params: { ...params } };
          }
        }
        return { matched: [{ route, params }], params };
      }
      // Recursively match child routes
      if (route.children?.length) {
        const childMatch = matchNestedRoute(normalizedPath, route.children, newMatchedPathSegment);
        if (childMatch) {
          return { matched: [{ route, params }, ...childMatch.matched], params: { ...params, ...childMatch.params } };
        }
      }
      // Wildcard match
      if (route.path.includes('*') && route.paramNames.length) {
        return { matched: [{ route, params }], params };
      }
    }
  }
  return null;
}

/**
 * Parses a query string into an object.
 * @param {string} queryString
 * @returns {object}
 */
export function parseQuery(queryString) {
  const params = new URLSearchParams(queryString);
  const query = {};
  for (const [key, value] of params.entries()) query[key] = value;
  return query;
}

/**
 * Finds the first matching route for a given path.
 * @param {string} path
 * @returns {object|null}
 */
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

/**
 * Initializes router: popstate and link interception.
 */
export function startRouter() {
  window.addEventListener('popstate', () => {
    navigate(location.pathname + location.search, { triggeredByPopstate: true });
  });
  attachLinkInterception();
}