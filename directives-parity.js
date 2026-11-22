// Extra screen directives. Imported by directives-core.js so they stay in the
// screen runtime. Fetch directives stay in fetch-directives.js.

import { effect, createOwner, runWithOwner, disposeOwner } from './state.js';
import { evaluateExpression } from './expression.js';
import { registerDirective } from './parser.js';
import { getComponent } from './registry.js';

function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div id="__basedom_sanitize__">${html || ''}</div>`, 'text/html');
  const root = doc.getElementById('__basedom_sanitize__');
  if (!root) return '';
  root.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return root.innerHTML;
}

export const xTextDirective = {
  controlFlow: false,
  handle(parsingContext, props) {
    const { node, context } = parsingContext;
    if (!node.hasAttribute || !node.hasAttribute('x-text')) return;
    const expr = node.getAttribute('x-text');
    const previous = props.onMount;
    props.onMount = (element) => {
      if (typeof previous === 'function') previous(element);
      const stop = effect(() => {
        const value = evaluateExpression(expr, context);
        element.textContent = value == null ? '' : String(value);
      });
      const prior = element.__onUnmount;
      element.__onUnmount = (...args) => {
        stop();
        if (typeof prior === 'function') prior(...args);
      };
    };
  }
};

export const xHtmlDirective = {
  controlFlow: false,
  handle(parsingContext, props) {
    const { node, context } = parsingContext;
    if (!node.hasAttribute || !node.hasAttribute('x-html')) return;
    const expr = node.getAttribute('x-html');
    const previous = props.onMount;
    props.onMount = (element) => {
      if (typeof previous === 'function') previous(element);
      const stop = effect(() => {
        const value = evaluateExpression(expr, context);
        element.innerHTML = sanitize(value == null ? '' : String(value));
      });
      const prior = element.__onUnmount;
      element.__onUnmount = (...args) => {
        stop();
        if (typeof prior === 'function') prior(...args);
      };
    };
  }
};

export const xCloakDirective = {
  controlFlow: false,
  handle(parsingContext, props) {
    const { node } = parsingContext;
    if (!node.hasAttribute || !node.hasAttribute('x-cloak')) return;
    const previous = props.onMount;
    props.onMount = (element) => {
      element.style.display = 'none';
      if (typeof previous === 'function') previous(element);
      element.removeAttribute('x-cloak');
      element.style.display = '';
    };
  }
};

export const xOnceDirective = {
  controlFlow: true,
  handle({ node, context, parseNode }) {
    if (!node.hasAttribute || !node.hasAttribute('x-once')) return null;
    const clone = node.cloneNode(true);
    clone.removeAttribute('x-once');
    const owner = createOwner();
    let rendered;
    runWithOwner(owner, () => { rendered = parseNode(clone, context); });
    disposeOwner(owner);
    return rendered;
  }
};

export const xPreDirective = {
  controlFlow: true,
  handle({ node }) {
    if (!node.hasAttribute || !node.hasAttribute('x-pre')) return null;
    const clone = node.cloneNode(true);
    clone.removeAttribute('x-pre');
    return document.importNode(clone, true);
  }
};

export const xMemoDirective = {
  controlFlow: true,
  handle({ node, context, parseNode }) {
    if (!node.hasAttribute || !node.hasAttribute('x-memo')) return null;
    const expr = node.getAttribute('x-memo');
    const clone = node.cloneNode(true);
    clone.removeAttribute('x-memo');
    let cached = null;
    let last;
    let seen = false;
    return () => {
      const next = evaluateExpression(expr, context);
      if (seen && Object.is(next, last) && cached) return cached;
      seen = true;
      last = next;
      cached = parseNode(clone.cloneNode(true), context);
      return cached;
    };
  }
};

export const xTeleportDirective = {
  controlFlow: true,
  handle({ node, context, parseNode }) {
    if (!node.hasAttribute || !node.hasAttribute('x-teleport')) return null;
    const selector = node.getAttribute('x-teleport');
    const clone = node.cloneNode(true);
    clone.removeAttribute('x-teleport');
    const anchor = document.createComment('x-teleport');
    const rendered = parseNode(clone, context);
    const target = selector ? document.querySelector(selector) : null;
    if (target && rendered instanceof Node) {
      target.appendChild(rendered);
      anchor.__onUnmount = () => {
        if (rendered.parentNode) rendered.parentNode.removeChild(rendered);
      };
    }
    return anchor;
  }
};

export const xComponentDirective = {
  controlFlow: true,
  handle({ node, context, parseNode }) {
    if (!node.tagName || node.tagName.toLowerCase() !== 'x-component') return null;
    const isAttr = [...node.attributes].find((attr) => attr.name === ':is' || attr.name === 'x-bind:is');
    const expr = isAttr ? isAttr.value : node.getAttribute('is');
    const clone = node.cloneNode(true);
    return () => {
      const spec = evaluateExpression(expr, context);
      const fn = typeof spec === 'function' ? spec : getComponent(String(spec || ''));
      if (typeof fn !== 'function') return null;
      const children = [...clone.childNodes].map((child) => parseNode(child, context)).filter((child) => child != null && child !== '');
      return fn({ children });
    };
  }
};

registerDirective('x-text', xTextDirective);
registerDirective('x-html', xHtmlDirective);
registerDirective('x-cloak', xCloakDirective);
registerDirective('x-once', xOnceDirective);
registerDirective('x-pre', xPreDirective);
registerDirective('x-memo', xMemoDirective);
registerDirective('x-teleport', xTeleportDirective);
registerDirective('x-component', xComponentDirective);
