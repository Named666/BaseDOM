// Fine-grained deep store. This is not the old removed store.js.
// Reading a path subscribes the current effect to that path only.

import { signal, effect, untrack } from './state.js';

const RAW = Symbol('basedom.raw');
const notifiers = new WeakMap();

function slotMap() {
  const slots = new Map();
  return {
    read(key) {
      if (!slots.has(key)) slots.set(key, signal(0));
      slots.get(key)[0]();
    },
    bump(path) {
      const key = path.join('\0');
      if (!slots.has(key)) slots.set(key, signal(0));
      slots.get(key)[1]((value) => value + 1);
    },
    bumpAll() {
      for (const pair of slots.values()) pair[1]((value) => value + 1);
    }
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {object} [initial]
 * @returns {[object, function]}
 */
export function createStore(initial = {}) {
  const slots = slotMap();
  const root = isObject(initial) ? { ...initial } : {};
  function wrap(source, path) {
    return new Proxy(source, {
      get(target, prop) {
        if (prop === RAW) return target;
        if (typeof prop === 'symbol') return target[prop];
        const nextPath = path.concat(String(prop));
        slots.read(nextPath.join('\0'));
        const value = target[prop];
        return isObject(value) ? wrap(value, nextPath) : value;
      },
      set(target, prop, value) {
        target[prop] = value;
        slots.bump(path.concat(String(prop)));
        return true;
      }
    });
  }
  const state = wrap(root, []);
  notifiers.set(state, () => slots.bumpAll());
  function setState(pathOrFn, value) {
    if (typeof pathOrFn === 'function') {
      pathOrFn(state);
      return;
    }
    const path = Array.isArray(pathOrFn) ? pathOrFn : [pathOrFn];
    let target = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!isObject(target[key])) target[key] = {};
      target = target[key];
    }
    target[path[path.length - 1]] = value;
    slots.bump(path.map(String));
  }
  return [state, setState];
}

export function toRaw(value) {
  if (value && typeof value === 'object' && RAW in value) return value[RAW];
  return value;
}

export function readonly(value) {
  if (!isObject(value)) return value;
  return new Proxy(value, {
    get(target, prop, receiver) {
      const child = Reflect.get(target, prop, receiver);
      return isObject(child) ? readonly(child) : child;
    },
    set() {
      return true;
    }
  });
}

/** @param {object} state @param {(draft: object) => void} recipe */
export function produce(state, recipe) {
  const raw = toRaw(state);
  const draft = JSON.parse(JSON.stringify(raw));
  recipe(draft);
  Object.keys(raw).forEach((key) => { if (!(key in draft)) delete raw[key]; });
  Object.assign(raw, draft);
  const notify = notifiers.get(state);
  if (notify) notify();
  return state;
}

/** Diff-shaped replacement. Returns a setter for setState. */
export function reconcile(next) {
  return (state) => {
    const raw = toRaw(state);
    const value = typeof next === 'function' ? next(raw) : next;
    if (!isObject(value)) return;
    Object.keys(raw).forEach((key) => { if (!(key in value)) delete raw[key]; });
    Object.assign(raw, value);
  };
}

export { effect, untrack };
