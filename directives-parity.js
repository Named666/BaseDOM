// Extra screen directives. Imported by directives-core.js so they stay in the
// screen runtime. Fetch directives stay in fetch-directives.js.

import { effect, signal, untrack, unwrapSignal, createOwner, runWithOwner, disposeOwner } from './state.js';
import { createComponent } from './components.js';
import { callOnMountRecursive, callOnUnmountRecursive } from './lifecycle.js';
import { evaluateExpression } from './expression.js';
import { registerDirective } from './parser.js';
import { getComponent } from './registry.js';
import { optionalHooks } from './directives-core.js';

function playEnter(element, name) {
  if (!(element instanceof HTMLElement)) return;
  const prefix = name || 'v';
  element.classList.add(`${prefix}-enter-from`, `${prefix}-enter-active`);
  element.__basedomLeave = (done) => playLeave(element, prefix, done);
  requestAnimationFrame(() => {
    element.classList.remove(`${prefix}-enter-from`);
    element.classList.add(`${prefix}-enter-to`);
    const finish = () => {
      element.classList.remove(`${prefix}-enter-active`, `${prefix}-enter-to`);
      element.removeEventListener('transitionend', finish);
    };
    element.addEventListener('transitionend', finish);
  });
}

function playLeave(element, prefix, done) {
  element.classList.add(`${prefix}-leave-from`, `${prefix}-leave-active`);
  requestAnimationFrame(() => {
    element.classList.remove(`${prefix}-leave-from`);
    element.classList.add(`${prefix}-leave-to`);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      element.classList.remove(`${prefix}-leave-active`, `${prefix}-leave-to`);
      element.removeEventListener('transitionend', finish);
      if (typeof done === 'function') done();
    };
    element.addEventListener('transitionend', finish);
    setTimeout(finish, 300);
  });
}

globalThis.__BASEDOM_PARSE_OBJECT__ = function parseObject(parser) {
  parser.expectOp('{');
  const properties = [];
  if (!parser.peekOp('}')) {
    do {
      if (parser.peekOp('}')) break;
      if (parser.matchOp('...')) {
        properties.push({ spread: true, expr: parser.parseExpression() });
        continue;
      }
      if (parser.matchOp('[')) {
        const key = parser.parseExpression();
        parser.expectOp(']');
        parser.expectOp(':');
        properties.push({ key, computed: true, value: parser.parseExpression() });
        continue;
      }
      const token = parser.peek();
      if (!token || token.type !== 'ident') throw new Error('Expected property name');
      parser.index += 1;
      if (parser.matchOp(':')) properties.push({ key: token.value, computed: false, value: parser.parseExpression() });
      else properties.push({ key: token.value, computed: false, value: { type: 'ident', name: token.value } });
    } while (parser.matchOp(','));
  }
  parser.expectOp('}');
  return { type: 'object', properties };
};

const KEY_MODIFIERS = {
  enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: ' ',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  delete: 'Delete', backspace: 'Backspace'
};

function eventAllowed(event, mods) {
  if (!event) return true;
  if (mods.has('self') && event.target !== event.currentTarget) return false;
  if (mods.has('left') && event.button !== 0) return false;
  if (mods.has('middle') && event.button !== 1) return false;
  if (mods.has('right') && event.button !== 2) return false;
  const keyMod = [...mods].find((mod) => KEY_MODIFIERS[mod]);
  if (keyMod && event.key !== KEY_MODIFIERS[keyMod] && !(keyMod === 'delete' && event.key === 'Backspace')) return false;
  const wants = { ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift'), meta: mods.has('meta') };
  if (mods.has('exact')) {
    if (!!event.ctrlKey !== wants.ctrl || !!event.altKey !== wants.alt || !!event.shiftKey !== wants.shift || !!event.metaKey !== wants.meta) return false;
  } else if ((wants.ctrl && !event.ctrlKey) || (wants.alt && !event.altKey) || (wants.shift && !event.shiftKey) || (wants.meta && !event.metaKey)) return false;
  return true;
}

optionalHooks.onEvent = (parsingContext, props, attr, spec) => {
  props.__basedomOn = props.__basedomOn || new Set();
  if (props.__basedomOn.has(attr.name)) return;
  props.__basedomOn.add(attr.name);
  const { context } = parsingContext;
  const dynamic = spec.startsWith('[') && spec.endsWith(']');
  const parts = dynamic ? [] : spec.toLowerCase().split('.');
  const mods = new Set();
  let debounce = 0;
  let throttle = 0;
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if ((part === 'debounce' || part === 'throttle') && /^\d+$/.test(parts[i + 1] || '')) {
      if (part === 'debounce') debounce = Number(parts[++i]);
      else throttle = Number(parts[++i]);
    } else mods.add(part);
  }
  let eventName = dynamic ? '' : parts[0];
  if (eventName === 'hover' || eventName === 'enter') eventName = 'mouseenter';
  if (eventName === 'leave') eventName = 'mouseleave';
  const invoke = (event) => {
    if (event && mods.has('prevent') && event.preventDefault) event.preventDefault();
    if (event && mods.has('stop') && event.stopPropagation) event.stopPropagation();
    if (!eventAllowed(event, mods)) return;
    const result = evaluateExpression(attr.value, { ...context, $event: event, $target: event && event.target, $currentTarget: event && event.currentTarget });
    if (typeof result === 'function') result(event);
  };
  let wrapped = invoke;
  if (debounce) {
    let timer = 0;
    wrapped = (event) => { clearTimeout(timer); timer = setTimeout(() => invoke(event), debounce); };
  } else if (throttle) {
    let last = 0;
    wrapped = (event) => { const now = Date.now(); if (now - last < throttle) return; last = now; invoke(event); };
  }
  if (dynamic || mods.has('capture') || mods.has('passive') || mods.has('once')) {
    const previous = props.onMount;
    props.onMount = (element) => {
      if (typeof previous === 'function') previous(element);
      const name = dynamic ? String(evaluateExpression(spec.slice(1, -1), context) || '') : eventName;
      if (!name) return;
      let listener = wrapped;
      if (mods.has('once')) {
        let used = false;
        listener = (event) => {
          if (used) return;
          used = true;
          wrapped(event);
        };
      }
      element.addEventListener(name, listener, { capture: mods.has('capture'), passive: mods.has('passive') });
    };
  } else if (eventName) props[`on${eventName}`] = wrapped;
};

optionalHooks.model = (parsingContext, props, modelAttr) => {
  const { node, context } = parsingContext;
  const mods = new Set(modelAttr.name.startsWith('x-model.') ? modelAttr.name.slice(8).split('.').filter(Boolean) : []);
  const modelProp = modelAttr.name.startsWith('x-model:') ? modelAttr.name.slice(8) : 'modelValue';
  const modelExpr = modelAttr.value.trim();
  const signal = context[modelExpr];
  const getter = typeof signal === 'function' ? signal : () => signal;
  const setter = (typeof signal === 'function' && signal.set) || context[`set${modelExpr.charAt(0).toUpperCase()}${modelExpr.slice(1)}`];
  if (typeof setter !== 'function') return;
  const write = (raw) => {
    let next = mods.has('trim') && typeof raw === 'string' ? raw.trim() : raw;
    if (mods.has('number')) next = next === '' ? null : Number(next);
    setter(next);
  };
  if (getComponent(node.tagName)) {
    props[modelProp] = getter;
    props[`onupdate:${modelProp.toLowerCase()}`] = (value) => write(value);
    return;
  }
  if (!props.attrs) props.attrs = {};
  props.attrs.value = getter;
  const handler = (event) => write(event.target.value);
  if (!mods.has('lazy')) props.onInput = handler;
  props.onChange = handler;
};

optionalHooks.enter = playEnter;
optionalHooks.leave = (element, done) => {
  if (element && element.__basedomLeave) element.__basedomLeave(done);
  else if (typeof done === 'function') done();
};
optionalHooks.move = (element) => {
  if (!(element instanceof HTMLElement) || !element.__basedomFrom) return;
  const next = element.getBoundingClientRect();
  const dx = element.__basedomFrom.left - next.left;
  const dy = element.__basedomFrom.top - next.top;
  if (!dx && !dy) return;
  element.classList.add('v-move');
  element.style.transform = `translate(${dx}px, ${dy}px)`;
  requestAnimationFrame(() => {
    element.style.transition = 'transform 0.2s';
    element.style.transform = '';
    const finish = () => {
      element.style.transition = '';
      element.classList.remove('v-move');
      element.removeEventListener('transitionend', finish);
    };
    element.addEventListener('transitionend', finish);
  });
};

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

function realizeRow(rendered) {
  if (rendered instanceof HTMLElement) return rendered;
  return createComponent('span', { children: rendered == null ? [] : [rendered] });
}
function warn() {}

function parseForHead(expr) {
    const match = String(expr || '').match(/^(.*?)\s+in\s+([\s\S]+)$/);
    if (!match) return null;
    let left = match[1].trim();
    if (left.startsWith('(') && left.endsWith(')')) left = left.slice(1, -1).trim();
    if (left.startsWith('{') && left.endsWith('}')) {
        const names = left.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
        if (!names.length) return null;
        return { kind: 'destructure', names, listExpr: match[2].trim() };
    }
    const names = left.split(',').map((part) => part.trim()).filter(Boolean);
    if (!names.length || names.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) return null;
    return { kind: 'names', names, listExpr: match[2].trim() };
}

function rowsOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const count = Math.max(0, Math.floor(value));
        return Array.from({ length: count }, (_, index) => ({ item: index + 1, key: undefined, index }));
    }
    if (Array.isArray(value)) return value.map((item, index) => ({ item, key: undefined, index }));
    if (value && typeof value === 'object') {
        return Object.keys(value).map((key, index) => ({ item: value[key], key, index }));
    }
    return [];
}

const extendedFor = {
    controlFlow: true,
    handle: (parsingContext) => {
        const { node, context, parseNode } = parsingContext;
        if (!node.hasAttribute || !node.hasAttribute('x-for')) return null;

        const forDirective = node.getAttribute('x-for');
        const head = parseForHead(forDirective);
        if (!head) {
            console.warn(`Invalid x-for expression: ${forDirective}`);
            return () => [];
        }

        const { listExpr } = head;
        const itemName = head.kind === 'names' ? head.names[0] : head.names[0];
        const indexName = head.kind === 'names' && head.names.length === 2 ? head.names[1] : null;
        const keyExpr = node.getAttribute('x-key');
        const nodeClone = node.cloneNode(true);
        nodeClone.removeAttribute('x-for');
        if (keyExpr != null) nodeClone.removeAttribute('x-key');

        const start = document.createComment('x-for');
        const end = document.createComment('/x-for');
        const fragment = document.createDocumentFragment();
        Object.defineProperty(fragment, '__live', { value: true });
        fragment.append(start, end);
        const rows = new Map();

        const stop = effect(() => {
            let items;
            try {
                items = unwrapSignal(evaluateExpression(listExpr.trim(), context));
            } catch (error) {
                warn(`[directives.js/xForDirective] Error evaluating x-for expression '${listExpr}':`, error);
                items = [];
            }
            const records = rowsOf(items);

            const seen = new Set();
            const nextKeys = [];
            records.forEach((record) => {
                const item = record.item;
                const index = record.index;
                let key = index;
                if (keyExpr) {
                    const keyContext = { ...context, [itemName]: signal(item)[0] };
                    if (indexName) keyContext[indexName] = signal(index)[0];
                    const evaluated = evaluateExpression(keyExpr, keyContext);
                    if (evaluated != null && evaluated !== '') key = evaluated;
                }
                if (seen.has(key)) {
                    console.warn(`[BaseDOM] duplicate x-key "${String(key)}" in x-for`);
                    key = `${String(key)}#${index}`;
                }
                seen.add(key);
                nextKeys.push(key);

                const existing = rows.get(key);
                if (existing) {
                    existing.setItem(item);
                    existing.setIndex(index);
                    if (existing.setKey) existing.setKey(record.key);
                    return;
                }
                const row = untrack(() => createRow(record));
                rows.set(key, row);
            });

            for (const [key, row] of [...rows]) {
                if (seen.has(key)) continue;
                if (row.el.parentNode) {
                    callOnUnmountRecursive(row.el);
                    row.el.remove();
                }
                row.dispose();
                rows.delete(key);
            }

            const parent = end.parentNode;
            if (!parent) return;
            if (node.hasAttribute('x-move')) {
                for (const key of nextKeys) {
                    const row = rows.get(key);
                    if (row && row.el && row.el.getBoundingClientRect) row.el.__basedomFrom = row.el.getBoundingClientRect();
                }
            }
            for (const key of nextKeys) {
                const row = rows.get(key);
                if (row && row.el !== end.previousSibling) parent.insertBefore(row.el, end);
            }
            if (end.isConnected) {
                for (const key of nextKeys) {
                    const row = rows.get(key);
                    if (!row) continue;
                    if (node.hasAttribute('x-move')) optionalHooks.move(row.el);
                    if (!row.el.__mounted) callOnMountRecursive(row.el);
                }
            }
        });
        end.__dispose = stop;

        function createRow(record) {
            const owner = createOwner();
            const [getItem, setItem] = signal(record.item);
            const [getIndex, setIndex] = signal(record.index);
            const [getKey, setKey] = signal(record.key);
            const loopContext = { ...context };
            if (head.kind === 'destructure') {
                for (const name of head.names) {
                    const read = () => {
                        const current = getItem();
                        return current == null ? undefined : current[name];
                    };
                    read.__isSignal = true;
                    loopContext[name] = read;
                }
            } else if (record.key !== undefined && head.names.length > 1) {
                loopContext[head.names[0]] = getItem;
                loopContext[head.names[1]] = getKey;
                if (head.names[2]) loopContext[head.names[2]] = getIndex;
            } else {
                loopContext[itemName] = getItem;
                if (indexName) loopContext[indexName] = getIndex;
                else loopContext[`${itemName}Index`] = getIndex;
            }
            let el;
            runWithOwner(owner, () => {
                el = realizeRow(parseNode(nodeClone.cloneNode(true), loopContext));
            });
            const row = { el, setItem, setIndex, setKey, dispose: () => disposeOwner(owner) };
            // Dev-only link so an HMR swap can retarget the live row. Production
            // builds drop this branch because import.meta.hot is false.
            if (import.meta.hot && el) el.__basedomForRow = row;
            return row;
        }

        return fragment;
    }
};


optionalHooks.for = extendedFor.handle.bind(extendedFor);
