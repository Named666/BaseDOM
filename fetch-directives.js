// Opt-in fetch directives. Import 'basedom/fetch' to register them.
// This module is not part of the screen runtime graph.

import { evaluateExpression } from './expression.js';
import { registerDirective } from './parser.js';
import { abortFetch, fetchAndSwap } from './fetch.js';

const VERBS = ['x-get', 'x-post', 'x-put', 'x-patch', 'x-delete'];
const FETCH_ATTRS = [
  ...VERBS,
  'x-swap', 'x-select', 'x-select-oob', 'x-trigger', 'x-target',
  'x-headers', 'x-params', 'x-include', 'x-vals', 'x-encoding',
  'x-confirm', 'x-indicator', 'x-timeout', 'x-push-url', 'x-replace-url', 'x-boost', 'x-sync'
];

let installed = false;

function closestAttr(element, name) {
  if (element.hasAttribute && element.hasAttribute(name)) return element.getAttribute(name);
  let node = element.parentElement;
  while (node) {
    const allow = node.getAttribute && node.getAttribute('x-inherit');
    const block = node.getAttribute && node.getAttribute('x-disinherit');
    const allowed = allow === '*' || (allow && allow.split(/\s+/).includes(name));
    const blocked = block === '*' || (block && block.split(/\s+/).includes(name));
    if (blocked) return null;
    if (allowed && node.hasAttribute(name)) return node.getAttribute(name);
    node = node.parentElement;
  }
  return null;
}

function readValue(raw, context) {
  if (raw == null) return raw;
  try {
    const value = evaluateExpression(raw, context);
    return typeof value === 'function' ? value() : value;
  } catch {
    try { return JSON.parse(raw); } catch { return raw; }
  }
}

function parseTime(value) {
  const text = String(value || '0');
  if (text.endsWith('ms')) return parseFloat(text) || 0;
  if (text.endsWith('s')) return (parseFloat(text) || 0) * 1000;
  return parseFloat(text) || 0;
}

function parseTrigger(raw) {
  const spec = { event: 'click', every: 0, delay: 0, throttle: 0, from: null, load: false, revealed: false, changed: false };
  for (const part of String(raw || 'click').split(/\s+/)) {
    if (part === 'load') spec.load = true;
    else if (part === 'revealed' || part === 'intersect') spec.revealed = true;
    else if (part === 'changed') spec.changed = true;
    else if (part.startsWith('every:')) spec.every = parseTime(part.slice(6));
    else if (part.startsWith('delay:')) spec.delay = parseTime(part.slice(6));
    else if (part.startsWith('throttle:')) spec.throttle = parseTime(part.slice(9));
    else if (part.startsWith('from:')) spec.from = part.slice(5);
    else if (!part.includes(':')) spec.event = part;
  }
  return spec;
}

function indicatorNodes(selector) {
  if (!selector) return [];
  try { return [...document.querySelectorAll(selector)]; } catch { return []; }
}

function formEntries(form) {
  const data = {};
  if (!form || !form.querySelectorAll) return data;
  for (const field of form.querySelectorAll('input[name], textarea[name], select[name]')) {
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (!field.checked) continue;
    }
    data[field.name] = field.value;
  }
  return data;
}

export const FetchDirective = {
  controlFlow: false,
  handle(parsingContext, props) {
    const { node, context } = parsingContext;
    if (!node || !node.hasAttribute) return;
    const config = {};
    for (const name of FETCH_ATTRS) {
      const value = closestAttr(node, name);
      if (value == null || value.trim().toLowerCase() === 'null') continue;
      config[name] = value;
    }
    if (!VERBS.some((name) => config[name]) && config['x-boost'] == null) return;

    const previousMount = props.onMount;
    const previousUnmount = props.onUnmount;
    let attached = null;

    props.onMount = (element) => {
      if (typeof previousMount === 'function') previousMount(element);
      if (!element) return;
      const method = config['x-post'] ? 'POST'
        : config['x-put'] ? 'PUT'
        : config['x-patch'] ? 'PATCH'
        : config['x-delete'] ? 'DELETE'
        : 'GET';
      const url = config[`x-${method.toLowerCase()}`];
      const tag = element.tagName.toLowerCase();
      const trigger = config['x-trigger']
        || ((tag === 'form' && method !== 'GET') ? 'submit' : 'click');
      if (!url && config['x-boost'] == null) return;

      const handler = async (event) => {
        const confirmValue = config['x-confirm'] ? readValue(config['x-confirm'], context) : true;
        if (confirmValue === false) return;
        if (typeof confirmValue === 'string' && !window.confirm(confirmValue)) return;
        if (tag === 'form' && trigger === 'submit') event.preventDefault();

        const target = config['x-target'] === 'this'
          ? element
          : (config['x-target'] ? document.querySelector(config['x-target']) : element);
        if (!target) return;

        const headers = {};
        const headerValue = config['x-headers'] ? readValue(config['x-headers'], context) : null;
        if (headerValue && typeof headerValue === 'object') Object.assign(headers, headerValue);

        let body;
        let requestUrl = url;
        const params = config['x-params'] ? readValue(config['x-params'], context) : null;
        const vals = config['x-vals'] ? readValue(config['x-vals'], context) : null;
        const encoding = String(config['x-encoding'] || '').toLowerCase();
        if (method === 'GET') {
          const next = new URL(url, window.location.href);
          for (const source of [params, vals]) {
            if (source && typeof source === 'object') {
              for (const [key, value] of Object.entries(source)) next.searchParams.set(key, String(value));
            }
          }
          requestUrl = next.toString();
        } else if (encoding === 'json' || (vals && typeof vals === 'object')) {
          headers['Content-Type'] = headers['Content-Type'] || 'application/json';
          const payload = {};
          if (tag === 'form') Object.assign(payload, formEntries(element));
          if (params && typeof params === 'object') Object.assign(payload, params);
          if (vals && typeof vals === 'object') Object.assign(payload, vals);
          body = JSON.stringify(payload);
        } else {
          const formData = new FormData();
          if (tag === 'form') {
            for (const [key, value] of Object.entries(formEntries(element))) formData.append(key, value);
          }
          if (params && typeof params === 'object') {
            for (const [key, value] of Object.entries(params)) formData.append(key, String(value));
          }
          if (vals && typeof vals === 'object') {
            for (const [key, value] of Object.entries(vals)) formData.append(key, String(value));
          }
          body = formData;
        }

        const marks = indicatorNodes(config['x-indicator']);
        marks.forEach((mark) => mark.classList.add('x-requesting'));
        const timeout = Number(config['x-timeout'] || 0);
        const timeoutController = new AbortController();
        const timer = timeout > 0 ? setTimeout(() => timeoutController.abort(), timeout) : 0;
        try {
          const runFetch = () => fetchAndSwap(requestUrl, {
            method,
            headers,
            body,
            swap: config['x-swap'],
            select: config['x-select'],
            targetElement: target,
            context,
            signal: timeoutController.signal
          });
          let result;
          if (config['x-sync'] === 'queue') {
            const previous = target.__basedomFetchQueue || Promise.resolve();
            let release = () => {};
            target.__basedomFetchQueue = new Promise((resolve) => { release = resolve; });
            await previous;
            try { result = await runFetch(); } finally { release(); }
          } else result = await runFetch();
          if (result && result.ok) {
            const redirect = result.headers && (result.headers['hx-redirect'] || result.headers['x-redirect']);
            const fired = result.headers && (result.headers['hx-trigger'] || result.headers['x-trigger']);
            if (redirect || fired) {
              if (redirect) {
                const nav = await import('./navigation.js');
                nav.navigate(redirect);
              }
              if (fired) {
                for (const name of String(fired).split(',')) {
                  element.dispatchEvent(new CustomEvent(name.trim(), { bubbles: true }));
                }
              }
            }
            const push = config['x-push-url'];
            const replace = config['x-replace-url'];
            if ((push && push !== 'false') || (replace && replace !== 'false')) {
              const nav = await import('./navigation.js');
              if (push && push !== 'false') nav.navigate(push === 'true' ? url : push);
              else nav.navigate(replace === 'true' ? url : replace, { replace: true });
              try {
                history.replaceState({ ...(history.state || {}), basedomHtml: target.innerHTML, basedomTarget: config['x-target'] || '' }, '');
              } catch { /* history restore is best-effort */ }
            }
          }
        } finally {
          if (timer) clearTimeout(timer);
          marks.forEach((mark) => mark.classList.remove('x-requesting'));
        }
      };

      const spec = parseTrigger(trigger);
      const listenTo = spec.from ? (document.querySelector(spec.from) || element) : element;
      const fire = (event) => {
        const go = () => handler(event || { preventDefault() {}, target: element });
        if (spec.throttle) {
          const now = Date.now();
          if (now - (element.__basedomThrottle || 0) < spec.throttle) return;
          element.__basedomThrottle = now;
        }
        if (spec.delay) setTimeout(go, spec.delay);
        else go();
      };
      if (spec.load) fire();
      if (spec.every) {
        const id = setInterval(fire, spec.every);
        const prior = element.__onUnmount;
        element.__onUnmount = (...args) => { clearInterval(id); if (typeof prior === 'function') prior(...args); };
      }
      if (spec.revealed && typeof IntersectionObserver === 'function') {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) fire();
        });
        observer.observe(listenTo);
      }
      if (spec.changed) listenTo.addEventListener('change', fire);
      if (!spec.load && !spec.every && !spec.revealed && !spec.changed) {
        listenTo.addEventListener(spec.event, fire);
        attached = { element: listenTo, trigger: spec.event, handler: fire };
      }
      if (config['x-boost'] != null) {
        element.addEventListener('click', (event) => {
          const link = event.target && event.target.closest && event.target.closest('a[href]');
          if (!link || !element.contains(link)) return;
          event.preventDefault();
          const host = config['x-target'] ? document.querySelector(config['x-target']) : element;
          fetchAndSwap(link.getAttribute('href'), { method: 'GET', targetElement: host, swap: config['x-swap'], context });
        });
        element.addEventListener('submit', (event) => {
          const form = event.target;
          if (!form || form.tagName !== 'FORM') return;
          event.preventDefault();
          const host = config['x-target'] ? document.querySelector(config['x-target']) : element;
          fetchAndSwap(form.getAttribute('action') || url, { method: (form.getAttribute('method') || 'GET').toUpperCase(), targetElement: host, context });
        });
      }
    };

    props.onUnmount = (element) => {
      abortFetch(element);
      if (config['x-target'] && config['x-target'] !== 'this') {
        const target = document.querySelector(config['x-target']);
        if (target) abortFetch(target);
      }
      if (attached) {
        attached.element.removeEventListener(attached.trigger, attached.handler);
        attached = null;
      }
      if (typeof previousUnmount === 'function') previousUnmount(element);
    };
  }
};

/**
 * Registers x-get, x-post, x-put, x-patch, and x-delete.
 * Importing this module calls it. A second call does nothing.
 */
export function installFetch() {
  if (installed) return;
  installed = true;
  // One registration. The parser runs every registered directive on every node,
  // so registering this object under each verb would fire the request five times.
  registerDirective('x-get', FetchDirective);
  if (typeof window !== 'undefined' && !window.__BASEDOM_FETCH_POP__) {
    window.__BASEDOM_FETCH_POP__ = true;
    window.addEventListener('popstate', () => {
      const state = history.state;
      if (!state || !state.basedomHtml) return;
      const host = state.basedomTarget ? document.querySelector(state.basedomTarget) : null;
      if (!host) return;
      import('./sfc.js').then(({ renderServerTemplate }) => {
        host.replaceChildren(renderServerTemplate(state.basedomHtml, {}));
      });
    });
  }
}

installFetch();

export { fetchAndSwap, abortFetch };
