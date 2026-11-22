// hmr-runtime.js
// Dev-server only. The Vite plugin omits this module from production compiles.
// It keeps setup state across script edits and patches template or style edits
// without running setup again.

import { createOwner, disposeOwner, runWithOwner } from './state.js';
import { parseNode, parseTemplateSource } from './parser.js';
import { handleScopedStyles, retargetScopedStyle } from './components.js';
import { bindComponentOwner, attachLifecycleHooks, callOnUnmountRecursive } from './lifecycle.js';

function componentContext(setupResult, props, declared) {
  const context = { props };
  if (declared) {
    for (const [key, value] of Object.entries(declared)) context[key] = value;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || key === '__slots') continue;
    if (declared && Object.prototype.hasOwnProperty.call(declared, key)) continue;
    context[key] = value;
  }
  for (const [key, value] of Object.entries(setupResult || {})) {
    if (key === 'onMount' || key === 'onUnmount' || key === 'onUpdate') continue;
    context[key] = value;
  }
  if (props && props.children !== undefined) context.children = props.children;
  if (props && props.__slots) context.__slots = props.__slots;
  return context;
}

function renderTree(template, styles, context) {
  const nodes = parseTemplateSource(template || '');
  const rendered = nodes.map((node) => parseNode(node, context)).filter((node) => node != null && node !== '');
  if (rendered.length === 1 && rendered[0] instanceof HTMLElement) {
    if (styles) handleScopedStyles(styles, rendered[0]);
    return rendered[0];
  }
  const wrapper = document.createElement('div');
  for (const node of rendered) {
    if (node instanceof Node) wrapper.appendChild(node);
  }
  if (styles) handleScopedStyles(styles, wrapper);
  return wrapper;
}

function styleClassOf(element) {
  if (!element || !element.classList) return '';
  return [...element.classList].find((name) => /^x-[a-z0-9]+$/i.test(name)) || '';
}

function swapElement(current, next) {
  if (!next || current === next) return current || next;
  for (const child of [...current.childNodes]) {
    try { callOnUnmountRecursive(child); } catch { /* nested instances dispose themselves */ }
  }
  current.__onUnmount = null;
  const row = current.__basedomForRow;
  if (current.parentNode) current.parentNode.replaceChild(next, current);
  if (row) {
    row.el = next;
    next.__basedomForRow = row;
    current.__basedomForRow = null;
  }
  return next;
}

function sameShape(prev, next) {
  const left = prev || [];
  const right = next || [];
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.name === right[index].name);
}

function shapeNames(shape) {
  return (shape || []).map((item) => item.name).join(', ') || '(none)';
}

function readSeed(signals) {
  const seed = {};
  for (const signal of signals || []) {
    try { seed[signal.name] = signal.get(); } catch { /* a disposed signal is skipped */ }
  }
  return seed;
}

function makeTracker(shape, seed, preserve) {
  const recorded = [];
  let index = 0;
  const track = (pair) => {
    if (!Array.isArray(pair) || typeof pair[1] !== 'function') return;
    const spec = (shape || [])[index];
    const name = spec ? spec.name : `#${index}`;
    if (preserve && spec && seed && Object.prototype.hasOwnProperty.call(seed, name)) {
      try { pair[1](seed[name]); } catch { /* keep the initializer */ }
    }
    recorded.push({ name, get: pair[0], set: pair[1] });
    index += 1;
  };
  track.recorded = recorded;
  return track;
}

function runSetup(meta, props, seed, preserve) {
  const owner = createOwner();
  owner.rawProps = props || {};
  const tracker = makeTracker(meta.signalShape, seed, preserve);
  const previous = globalThis.__BASEDOM_HMR_TRACK__;
  globalThis.__BASEDOM_HMR_TRACK__ = tracker;
  let result = {};
  try {
    runWithOwner(owner, () => {
      result = meta.setup(props || {}) || {};
      if (typeof result.onMount === 'function') owner.hooks.onMount.push(result.onMount);
      if (typeof result.onUnmount === 'function') owner.hooks.onUnmount.push(result.onUnmount);
      if (typeof result.onUpdate === 'function') owner.hooks.onUpdate.push(result.onUpdate);
    });
  } finally {
    globalThis.__BASEDOM_HMR_TRACK__ = previous;
  }
  return { owner, result, signals: tracker.recorded, context: componentContext(result, props, owner.declaredProps) };
}

function paint(meta, context, owner) {
  const renderOwner = createOwner();
  renderOwner.parent = owner;
  owner.cleanups.push(() => disposeOwner(renderOwner));
  const element = runWithOwner(renderOwner, () => renderTree(meta.template, meta.styles, context));
  element.__basedomOwner = owner;
  attachLifecycleHooks(element, bindComponentOwner(owner));
  return { element, renderOwner };
}

const registry = new Map();

/**
 * @param {object} meta
 * @returns {Function & { update: (next: object) => void }}
 */
export function createHotComponent(meta) {
  let record = registry.get(meta.id);
  if (!record) {
    record = { current: meta, instances: new Set() };
    registry.set(meta.id, record);
  }
  const instances = record.instances;

  function live() {
    return [...instances].filter((inst) => inst.element && inst.element.isConnected);
  }

  function forget(inst) {
    instances.delete(inst);
  }

  function mount(props, seed, preserve) {
    const setup = runSetup(record.current, props, seed, preserve);
    const painted = paint(record.current, setup.context, setup.owner);
    const inst = {
      props,
      signals: setup.signals,
      context: setup.context,
      owner: setup.owner,
      renderOwner: painted.renderOwner,
      element: painted.element,
      styleClass: styleClassOf(painted.element)
    };
    instances.add(inst);
    const previous = painted.element.__onUnmount;
    painted.element.__onUnmount = (...args) => {
      if (inst.renderOwner) disposeOwner(inst.renderOwner);
      forget(inst);
      if (typeof previous === 'function' && previous !== painted.element.__onUnmount) previous(...args);
    };
    return inst;
  }

  function rerender(inst, next) {
    if (inst.renderOwner) disposeOwner(inst.renderOwner);
    const renderOwner = createOwner();
    renderOwner.parent = inst.owner;
    const fresh = runWithOwner(renderOwner, () => renderTree(next.template, next.styles, inst.context));
    fresh.__basedomOwner = inst.owner;
    const previous = inst.element.__onUnmount;
    inst.element.__onUnmount = null;
    const element = swapElement(inst.element, fresh);
    element.__onUnmount = (...args) => {
      if (inst.renderOwner) disposeOwner(inst.renderOwner);
      forget(inst);
      if (typeof previous === 'function') previous(...args);
    };
    if (!element.__onUnmount) {
      attachLifecycleHooks(element, bindComponentOwner(inst.owner));
    }
    inst.element = element;
    inst.renderOwner = renderOwner;
    inst.styleClass = styleClassOf(element) || inst.styleClass;
  }

  function remount(inst, next, preserve) {
    const seed = preserve ? readSeed(inst.signals) : null;
    const props = inst.props;
    inst.element.__onUnmount = null;
    disposeOwner(inst.owner);
    forget(inst);
    record.current = next;
    const created = mount(props, seed, preserve);
    const element = swapElement(inst.element, created.element);
    created.element = element;
  }

  function update(next) {
    const previous = record.current;
    if (previous.setupKey === next.setupKey && previous.templateKey === next.templateKey && previous.styleKey !== next.styleKey) {
      record.current = next;
      for (const inst of live()) {
        if (inst.styleClass) retargetScopedStyle(inst.styleClass, next.styles);
      }
      return;
    }
    if (previous.setupKey === next.setupKey && previous.templateKey !== next.templateKey) {
      record.current = next;
      for (const inst of live()) rerender(inst, next);
      return;
    }
    if (previous.setupKey === next.setupKey) {
      record.current = next;
      return;
    }
    const preserve = sameShape(previous.signalShape, next.signalShape);
    if (!preserve) {
      console.info(`[BaseDOM BD1020] HMR remounted ${next.name || next.id}. Signal shape changed from ${shapeNames(previous.signalShape)} to ${shapeNames(next.signalShape)}. Setup state was not copied.`);
    }
    record.current = next;
    for (const inst of live()) remount(inst, next, preserve);
  }

  function component(props) {
    return mount(props, null, false).element;
  }
  component.update = update;
  return component;
}
