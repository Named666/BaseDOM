// Opt-in HTML swap. The screen runtime does not import this module.
// Response HTML is rendered with renderServerTemplate, which strips scripts,
// on* handlers, and javascript: URLs, then activates bindings and directives.

import { renderServerTemplate } from './sfc.js';
import { callOnMountRecursive, callOnUnmountRecursive } from './lifecycle.js';
import { disposeOwner, runWithOwner } from './state.js';

const SWAP_MODES = new Set([
  'innerhtml', 'outerhtml', 'textcontent',
  'beforeend', 'afterbegin', 'beforebegin', 'afterend',
  'delete', 'none'
]);

function ownerForElement(element) {
  let node = element;
  while (node) {
    if (node.__basedomOwner && !node.__basedomOwner.disposed) return node.__basedomOwner;
    node = node.parentNode;
  }
  return null;
}

function parseTime(value) {
  const text = String(value || '0');
  if (text.endsWith('ms')) return parseFloat(text) || 0;
  if (text.endsWith('s')) return (parseFloat(text) || 0) * 1000;
  return parseFloat(text) || 0;
}

function parseSwap(spec) {
  const parts = String(spec || 'innerHTML').trim().split(/\s+/).filter(Boolean);
  const styleToken = parts[0] && !parts[0].includes(':') ? parts.shift().toLowerCase() : 'innerhtml';
  const style = SWAP_MODES.has(styleToken) ? styleToken : 'innerhtml';
  const extra = { style, swapDelay: 0, settleDelay: 0, show: null, scroll: null };
  for (const part of parts) {
    const [key, value] = part.split(':');
    if (key === 'swap') extra.swapDelay = parseTime(value);
    else if (key === 'settle') extra.settleDelay = parseTime(value);
    else if (key === 'show') extra.show = value || 'top';
    else if (key === 'scroll') extra.scroll = value || 'top';
  }
  return extra;
}

function applyMotion(target, extra) {
  if (!extra) return;
  if (extra.scroll === 'top') target.scrollTop = 0;
  if (extra.scroll === 'bottom') target.scrollTop = target.scrollHeight;
  if (extra.show === 'top' || extra.show === 'bottom') {
    try { target.scrollIntoView({ block: extra.show === 'top' ? 'start' : 'end' }); } catch { /* optional */ }
  }
}

function renderTrusted(html, context, target) {
  const parent = target ? ownerForElement(target) : null;
  const view = parent
    ? runWithOwner(parent, () => renderServerTemplate(html, context || {}))
    : renderServerTemplate(html, context || {});
  return view;
}

function dropView(view) {
  if (!view) return;
  try { callOnUnmountRecursive(view); } catch { /* already gone */ }
  if (view.__basedomOwner) disposeOwner(view.__basedomOwner);
  if (view.parentNode) view.parentNode.removeChild(view);
}

function clearTarget(target) {
  dropView(target.__basedomFetchView);
  target.__basedomFetchView = null;
  for (const child of [...target.childNodes]) {
    try { callOnUnmountRecursive(child); } catch { /* not a component */ }
    if (child.__basedomOwner) disposeOwner(child.__basedomOwner);
    child.remove();
  }
}

function mountView(view) {
  try { callOnMountRecursive(view); } catch { /* mount hooks are best-effort */ }
}

function remember(target, view) {
  target.__basedomFetchView = view;
  const previous = target.__onUnmount;
  if (target.__basedomFetchUnmount) return;
  target.__basedomFetchUnmount = true;
  target.__onUnmount = (...args) => {
    abortFetch(target);
    dropView(target.__basedomFetchView);
    target.__basedomFetchView = null;
    if (typeof previous === 'function') previous(...args);
  };
}

/**
 * Aborts the request currently targeting this element.
 * @param {Element} element
 */
export function abortFetch(element) {
  const current = element && element.__basedomFetchAbort;
  if (!current) return;
  element.__basedomFetchAbort = null;
  try { current.abort(); } catch { /* already aborted */ }
}

function claim(target, signal) {
  abortFetch(target);
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  target.__basedomFetchAbort = controller;
  target.__basedomFetchGen = (target.__basedomFetchGen || 0) + 1;
  const generation = target.__basedomFetchGen;
  return {
    signal: controller.signal,
    current: () => target.__basedomFetchGen === generation && target.__basedomFetchAbort === controller
  };
}

function setState(target, state, detail) {
  if (!target || !target.setAttribute) return;
  target.setAttribute('data-fetch-state', state);
  if (state === 'loading') target.setAttribute('aria-busy', 'true');
  else target.removeAttribute('aria-busy');
  if (detail) target.setAttribute('data-fetch-error', detail);
  else target.removeAttribute('data-fetch-error');
}

function applyHtml(target, html, style, context) {
  if (style === 'none') return;
  if (style === 'delete') {
    abortFetch(target);
    clearTarget(target);
    callOnUnmountRecursive(target);
    if (target.__basedomOwner) disposeOwner(target.__basedomOwner);
    if (target.parentNode) target.parentNode.removeChild(target);
    return;
  }
  if (style === 'textcontent') {
    clearTarget(target);
    target.textContent = String(html ?? '');
    return;
  }
  const view = renderTrusted(html, context, target);
  if (style === 'outerhtml') {
    const parent = target.parentNode;
    if (!parent) return;
    abortFetch(target);
    clearTarget(target);
    callOnUnmountRecursive(target);
    if (target.__basedomOwner) disposeOwner(target.__basedomOwner);
    parent.replaceChild(view, target);
    mountView(view);
    return;
  }
  if (style === 'beforeend' || style === 'afterbegin' || style === 'beforebegin' || style === 'afterend') {
    const parent = style === 'beforebegin' || style === 'afterend' ? target.parentNode : target;
    if (!parent) return;
    if (style === 'afterbegin') target.insertBefore(view, target.firstChild);
    else if (style === 'beforebegin') parent.insertBefore(view, target);
    else if (style === 'afterend') parent.insertBefore(view, target.nextSibling);
    else target.appendChild(view);
    mountView(view);
    return;
  }
  clearTarget(target);
  target.appendChild(view);
  remember(target, view);
  mountView(view);
}

function pullOob(html, context) {
  const doc = new DOMParser().parseFromString(`<div id="__basedom_oob__">${html}</div>`, 'text/html');
  const root = doc.getElementById('__basedom_oob__');
  if (!root) return html;
  for (const el of [...root.querySelectorAll('[x-swap-oob]')]) {
    const spec = el.getAttribute('x-swap-oob') || 'true';
    el.removeAttribute('x-swap-oob');
    let style = 'outerHTML';
    let selector = el.id ? `#${el.id.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    if (spec !== 'true') {
      const split = spec.indexOf(':');
      if (split > 0) {
        style = spec.slice(0, split);
        selector = spec.slice(split + 1);
      } else selector = spec;
    }
    const host = selector ? document.querySelector(selector) : null;
    if (host) applyHtml(host, el.outerHTML, parseSwap(style), context);
    el.remove();
  }
  return root.innerHTML;
}

function narrow(html, select) {
  if (!select) return html;
  const doc = new DOMParser().parseFromString(`<div id="__basedom_sel__">${html}</div>`, 'text/html');
  const root = doc.getElementById('__basedom_sel__');
  const match = root && root.querySelector(select);
  return match ? match.outerHTML : '';
}

/**
 * Fetches a URL and swaps the response into an element.
 * A newer call for the same element aborts the previous request.
 * @param {string} url
 * @param {object} [options]
 */
export async function fetchAndSwap(url, options = {}) {
  const target = options.targetElement
    || (options.targetSelector ? document.querySelector(options.targetSelector) : null);
  if (!target) return { ok: false, error: 'No target element' };
  const swapSpec = parseSwap(options.swap);
  const style = swapSpec.style;
  const ticket = claim(target, options.signal);
  setState(target, 'loading');
  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: ticket.signal
    });
  } catch (error) {
    if (!ticket.current()) return { ok: false, aborted: true };
    if (error && error.name === 'AbortError') {
      setState(target, 'idle');
      return { ok: false, aborted: true };
    }
    setState(target, 'error', error && error.message ? error.message : 'fetch failed');
    return { ok: false, error };
  }
  if (!ticket.current()) return { ok: false, aborted: true };
  if (!response.ok) {
    setState(target, 'error', String(response.status));
    return { ok: false, status: response.status, error: `HTTP ${response.status}` };
  }
  const text = await response.text();
  if (!ticket.current()) return { ok: false, aborted: true };
  let html = pullOob(text, options.context);
  html = narrow(html, options.select);
  if (swapSpec.swapDelay) await new Promise((resolve) => setTimeout(resolve, swapSpec.swapDelay));
  if (!ticket.current()) return { ok: false, aborted: true };
  applyHtml(target, html, style, options.context);
  if (swapSpec.settleDelay) await new Promise((resolve) => setTimeout(resolve, swapSpec.settleDelay));
  applyMotion(target, swapSpec);
  const headers = {};
  if (response.headers && typeof response.headers.forEach === 'function') {
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  }
  if (ticket.current()) {
    target.__basedomFetchAbort = null;
    setState(target, 'idle');
  }
  return { ok: true, status: response.status, headers };
}
