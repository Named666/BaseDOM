// sfc.js
// Authoring and loading for .html single-file components.
//
// Trust boundary:
// - Application SFCs are trusted source. Inline <script setup> is compiled by
//   the Vite plugin into a normal module. It is never eval'd from fetched HTML.
// - No-build SFCs may point <script setup src> at a same-directory module.
//   The browser (or Node) loads that URL with import(). The HTML body is not executed.
// - Server-generated markup must use renderServerTemplate(). Script tags are
//   ignored. The template can only call functions you pass in `context`.
//
// Rendering writes real DOM nodes. There is no virtual DOM.

import { parseNode, parseTemplateSource } from './parser.js';
import { extractSfcParts } from './sfc-compile.js';
import { runWithOwner, createOwner } from './state.js';
import { bindComponentOwner, attachLifecycleHooks } from './lifecycle.js';
import { createComponent, handleScopedStyles } from './components.js';
import { devWarn } from './dev.js';
import './directives.js';

export const INLINE_SCRIPT_ERROR =
  'BaseDOM refused to execute inline <script> from SFC text. ' +
  'Compile author SFCs with the Vite plugin (vite/plugin.js), or use ' +
  '<script setup src="./component.js"></script> for a same-directory module. ' +
  'Server-generated HTML must use renderServerTemplate(html, context), which does not run script.';

function blockedScriptUrl(src) {
  return /^(?:data|blob|javascript):/i.test(src) || src.startsWith('//');
}

/**
 * Resolves a script src against the component URL.
 * Same-origin only, and inside the component directory unless allowOutsideDirectory is set.
 * @param {string} src
 * @param {string} baseUrl
 * @param {{ allowOutsideDirectory?: boolean }} [options]
 */
export function resolveSfcScriptSrc(src, baseUrl, options = {}) {
  const raw = String(src || '').trim();
  if (!raw) throw new Error('SFC script src is empty');
  if (blockedScriptUrl(raw)) throw new Error(`Refusing SFC script URL: ${raw}`);
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error('Invalid SFC base URL');
  }
  let resolved;
  try {
    resolved = new URL(raw, base);
  } catch {
    throw new Error(`Invalid SFC script src: ${raw}`);
  }
  if (resolved.origin !== base.origin) {
    throw new Error(`SFC script src must be same-origin (${resolved.href})`);
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:' && resolved.protocol !== 'file:') {
    throw new Error(`Unsupported SFC script protocol: ${resolved.protocol}`);
  }
  const directory = new URL('./', base);
  if (!options.allowOutsideDirectory && !resolved.href.startsWith(directory.href)) {
    throw new Error(`SFC script src must stay in the component directory (${resolved.href}). Pass { allowOutsideDirectory: true } to override.`);
  }
  return resolved.href;
}

function componentContext(setupResult, props) {
  const result = setupResult || {};
  const context = { props };
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || key === '__slots') continue;
    context[key] = value;
  }
  for (const [key, value] of Object.entries(result)) {
    if (key === 'onMount' || key === 'onUnmount' || key === 'onUpdate') continue;
    context[key] = value;
  }
  if (props && props.children !== undefined) context.children = props.children;
  if (props && props.__slots) context.__slots = props.__slots;
  return context;
}

function forwardDomListeners(element, props) {
  if (!(element instanceof HTMLElement) || !props) return;
  for (const [key, value] of Object.entries(props)) {
    if (!/^on[A-Z]/.test(key) || typeof value !== 'function') continue;
    if (key === 'onMount' || key === 'onUnmount' || key === 'onUpdate') continue;
    element.addEventListener(key.slice(2).toLowerCase(), value);
  }
}

function renderParts(template, styles, context, hooks) {
  const nodes = parseTemplateSource(template);
  const rendered = nodes.map((node) => parseNode(node, context)).filter((node) => node != null && node !== '');
  if (rendered.length === 1 && rendered[0] instanceof HTMLElement) {
    if (styles) handleScopedStyles(styles, rendered[0]);
    attachLifecycleHooks(rendered[0], hooks);
    forwardDomListeners(rendered[0], context.props);
    return rendered[0];
  }
  return createComponent('div', {
    styles,
    children: rendered,
    ...hooks
  });
}

/**
 * Defines a component from a template string and a setup function.
 * setup(props) runs once per instance. Return signals, computeds, and handlers.
 * The template reads those names. Bindings update the live DOM.
 * @param {{ template?: string, styles?: string, setup?: Function, name?: string }} definition
 * @returns {Function}
 */
export function defineSfc({ template = '', styles = '', setup, name } = {}) {
  function Sfc(props) {
    const owner = createOwner();
    const currentProps = props || {};
    let result = {};
    runWithOwner(owner, () => {
      if (typeof setup === 'function') result = setup(currentProps) || {};
      if (typeof result.onMount === 'function') owner.hooks.onMount.push(result.onMount);
      if (typeof result.onUnmount === 'function') owner.hooks.onUnmount.push(result.onUnmount);
      if (typeof result.onUpdate === 'function') owner.hooks.onUpdate.push(result.onUpdate);
    });
    const context = componentContext(result, currentProps);
    const element = runWithOwner(owner, () => renderParts(template, styles, context, bindComponentOwner(owner)));
    if (name && element instanceof HTMLElement && !element.hasAttribute('data-basedom-component')) {
      element.setAttribute('data-basedom-component', name);
    }
    return element;
  }
  if (name) Object.defineProperty(Sfc, 'name', { value: name });
  return Sfc;
}

async function loadSetup(parts, options) {
  if (typeof options.setup === 'function') return options.setup;
  if (parts.scriptSrc && parts.hasInlineScript) {
    throw new Error('Use either <script setup src> or an inline <script setup>, not both.');
  }
  if (parts.hasInlineScript) throw new Error(INLINE_SCRIPT_ERROR);
  if (!parts.scriptSrc) return null;
  const baseUrl = options.baseUrl || options.sourceUrl;
  if (!baseUrl) throw new Error('baseUrl is required to resolve <script setup src>');
  const specifier = resolveSfcScriptSrc(parts.scriptSrc, baseUrl, options);
  const imported = await import(/* @vite-ignore */ specifier);
  const setup = imported.default || imported.setup;
  if (typeof setup !== 'function') throw new Error(`SFC script module must default-export a setup function: ${specifier}`);
  return setup;
}

/**
 * Runtime parser used by parseComponent() and loadComponent().
 * @param {string} htmlText
 * @param {object} [options]
 */
export async function parseComponentSource(htmlText, options = {}) {
  const parts = extractSfcParts(htmlText);
  const setup = await loadSetup(parts, options);
  return defineSfc({
    template: parts.template,
    styles: parts.styles,
    setup,
    name: options.name
  });
}

/**
 * Fetches an application SFC. Do not point this at untrusted server HTML.
 * @param {string} url
 * @param {object} [options]
 */
export async function loadComponent(url, options = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch component: ${url} (${response.status})`);
  const html = await response.text();
  return parseComponentSource(html, { ...options, baseUrl: options.baseUrl || url });
}

function sanitizeServerTemplate(template) {
  const doc = new DOMParser().parseFromString(`<div id="__basedom_sanitize__">${template || ''}</div>`, 'text/html');
  const root = doc.getElementById('__basedom_sanitize__');
  if (!root) return '';
  root.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction' || name === 'xlink:href')
        && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return root.innerHTML;
}

/**
 * Renders server-generated component HTML with an application-supplied context.
 * Script tags and inline event-handler attributes are removed, not executed.
 * @param {string} html
 * @param {object} [context]
 * @returns {HTMLElement}
 */
export function renderServerTemplate(html, context = {}) {
  const parts = extractSfcParts(html);
  if (parts.hasInlineScript || parts.scriptSrc) {
    devWarn('Ignored <script> in a server template. BaseDOM does not execute it.');
  }
  const Sfc = defineSfc({
    template: sanitizeServerTemplate(parts.template),
    styles: parts.styles,
    setup: () => context
  });
  return Sfc();
}
