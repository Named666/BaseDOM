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
import { runWithOwner, createOwner, disposeOwner, getCurrentOwner, isSignal, unwrapSignal } from './state.js';
import { bindComponentOwner, attachLifecycleHooks, callOnMountRecursive } from './lifecycle.js';
import { createComponent, handleScopedStyles } from './components.js';
import { devWarn } from './dev.js';
import { reportDiagnostic } from './diagnostics.js';
import './directives-core.js';

export const INLINE_SCRIPT_ERROR =
  '[BaseDOM BD1016] BaseDOM refused to execute inline <script> from SFC text. ' +
  'Compile author SFCs with the Vite plugin (vite/plugin.js), or use ' +
  '<script setup src="./component.js"></script> for a same-directory module. ' +
  'Server-generated HTML must use renderServerTemplate(html, context), which does not run script.';

const FRAMEWORK_PROP = /^(children|__slots|params|query|outlet|routeData|routeError|routeState|class|id|style|key|styles)$/;

function isFrameworkProp(key) {
  return FRAMEWORK_PROP.test(key) || key.startsWith('on') || key.startsWith('@') || key.startsWith('x-');
}

function propSpec(spec) {
  if (spec && typeof spec === 'object' && !isSignal(spec) && (Object.prototype.hasOwnProperty.call(spec, 'default') || spec.required === true)) {
    return spec;
  }
  if (spec === undefined) return {};
  return { default: spec };
}

function missingDefault(spec) {
  return !spec || !Object.prototype.hasOwnProperty.call(spec, 'default');
}

/**
 * Declares the props this instance reads. Call during setup.
 * Each key is a getter. `props.count()` reads the current value.
 * `const n = props.count()` stores a snapshot. Return `props.count` itself
 * when the template should keep updating.
 * @param {Record<string, { default?: *, required?: boolean }|*>} [schema]
 */
export function defineProps(schema = {}) {
  const owner = getCurrentOwner();
  if (!owner) {
    throw reportDiagnostic('BD1008', 'defineProps() must run during setup', {
      hint: 'Call defineProps() inside setup(), before the first await.'
    });
  }
  const raw = owner.rawProps || {};
  const declared = {};
  for (const [key, rawSpec] of Object.entries(schema)) {
    const spec = propSpec(rawSpec);
    const accessor = () => {
      if (raw[key] !== undefined) return unwrapSignal(raw[key]);
      if (!missingDefault(spec)) {
        const fallback = spec.default;
        if (typeof fallback === 'function' && !isSignal(fallback)) return fallback();
        return unwrapSignal(fallback);
      }
      return undefined;
    };
    accessor.__isSignal = true;
    accessor._isSignal = true;
    declared[key] = accessor;
    if (spec.required && raw[key] === undefined && missingDefault(spec)) {
      reportDiagnostic('BD1004', `Missing required prop "${key}"`, {
        devOnly: true,
        hint: `Pass :${key} from the parent, or add a default in defineProps().`
      });
    }
  }
  if (Object.keys(schema).length) {
    for (const key of Object.keys(raw)) {
      if (isFrameworkProp(key) || Object.prototype.hasOwnProperty.call(schema, key)) continue;
      reportDiagnostic('BD1005', `Unknown prop "${key}"`, {
        devOnly: true,
        hint: `Declare "${key}" in defineProps(), or remove it from the parent tag.`
      });
    }
  }
  owner.declaredProps = declared;
  return declared;
}

function componentListener(props, name) {
  if (!props || !name) return undefined;
  const text = String(name);
  const lower = `on${text.toLowerCase()}`;
  const camel = `on${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  if (typeof props[lower] === 'function') return props[lower];
  if (typeof props[camel] === 'function') return props[camel];
  return undefined;
}

/**
 * Sends a component event to the parent listener `@name`.
 * The payload is the argument. This does not dispatch a DOM event.
 * @param {string} name
 * @param {*} [payload]
 */
/**
 * Publishes the values a parent x-ref should see instead of the root element.
 * @param {object} exposed
 */
export function defineExpose(exposed) {
  const owner = getCurrentOwner();
  if (!owner) {
    throw reportDiagnostic('BD1008', 'defineExpose() must run during setup', {
      hint: 'Call defineExpose() inside setup(), next to defineProps().'
    });
  }
  owner.exposed = exposed || {};
}

export function emit(name, payload) {
  const owner = getCurrentOwner();
  if (!owner) {
    throw reportDiagnostic('BD1008', 'emit() must run during setup or a handler in that component', {
      hint: 'Call emit() from setup or from an event handler created while the component is mounted.'
    });
  }
  const listener = componentListener(owner.rawProps, name);
  if (typeof listener === 'function') listener(payload);
}

const NATIVE_DOM_EVENTS = new Set([
  'click', 'dblclick', 'input', 'change', 'submit', 'focus', 'blur',
  'keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'mouseenter',
  'mouseleave', 'mouseover', 'mouseout', 'contextmenu', 'wheel',
  'pointerdown', 'pointerup', 'touchstart', 'touchend', 'reset', 'invalid', 'scroll'
]);

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

function componentContext(setupResult, props, declared) {
  const result = setupResult || {};
  const context = { props };
  if (declared) {
    for (const [key, value] of Object.entries(declared)) context[key] = value;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || key === '__slots') continue;
    if (declared && Object.prototype.hasOwnProperty.call(declared, key)) continue;
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
    const eventName = key.slice(2).toLowerCase();
    // Component events (emit) stay on the props object. Only real DOM events
    // are attached to the root, and a template `@name` is lowercase `onname`.
    if (!NATIVE_DOM_EVENTS.has(eventName)) continue;
    element.addEventListener(eventName, (event) => runWithOwner(element.__basedomOwner, () => value(event)));
  }
}

/**
 * Replaces a mounted element during HMR and disposes the previous owner.
 * Setup state is not copied. If this cannot run, the plugin reloads the page.
 * @param {Element} current
 * @param {Element} next
 */
export function swapHmrElement(current, next) {
  try {
    if (current && current.__basedomOwner) disposeOwner(current.__basedomOwner);
  } catch { /* the owner may already be gone */ }
  if (current && current.parentNode && next) {
    current.parentNode.replaceChild(next, current);
    try { callOnMountRecursive(next); } catch { /* mount hooks are best-effort */ }
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
    owner.rawProps = currentProps;
    try {
      let result = {};
      runWithOwner(owner, () => {
        if (typeof setup === 'function') result = setup(currentProps) || {};
        if (typeof result.onMount === 'function') owner.hooks.onMount.push(result.onMount);
        if (typeof result.onUnmount === 'function') owner.hooks.onUnmount.push(result.onUnmount);
        if (typeof result.onUpdate === 'function') owner.hooks.onUpdate.push(result.onUpdate);
      });
      const context = componentContext(result, currentProps, owner.declaredProps);
      const element = runWithOwner(owner, () => renderParts(template, styles, context, bindComponentOwner(owner)));
      if (element instanceof HTMLElement) {
        element.__basedomOwner = owner;
        if (owner.exposed) element.__basedomExposed = owner.exposed;
        if (name && !element.hasAttribute('data-basedom-component')) {
          element.setAttribute('data-basedom-component', name);
        }
      }
      return element;
    } catch (error) {
      disposeOwner(owner);
      throw error;
    }
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
  if (/\bx-(?:get|post|put|patch|delete|boost)\b/.test(String(htmlText || ''))) {
    // Non-literal so bundlers leave this as a runtime import. Screens that never
    // call parseComponentSource do not download the fetch layer.
    const file = 'fetch-' + 'directives.js';
    await import(new URL(file, import.meta.url).href);
  }
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
