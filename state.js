// state.js
// Fine-grained signals. Updates are synchronous unless wrapped in batch().
// Effects created while a component owner is active are disposed with that owner.

let currentEffect = null;
let currentOwner = null;
let mountingOwner = null;
let effectDepth = 0;
const MAX_EFFECT_DEPTH = 64;

let batchDepth = 0;
const pendingEffects = new Set();

/**
 * @returns {object|null} The owner active during setup, or the owner whose
 * mount/unmount hooks are currently running.
 */
export function getCurrentOwner() {
  return currentOwner || mountingOwner;
}

export function createOwner() {
  return {
    parent: currentOwner,
    cleanups: [],
    hooks: { onMount: [], onUnmount: [], onUpdate: [] },
    disposed: false
  };
}

export function runWithOwner(owner, fn) {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = previous;
  }
}

/**
 * Runs `fn` without recording signal reads on the current effect.
 * List rows use this so a list refresh does not dispose their bindings.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function untrack(fn) {
  const previous = currentEffect;
  currentEffect = null;
  try {
    return fn();
  } finally {
    currentEffect = previous;
  }
}

export function runWithMountingOwner(owner, fn) {
  const previousOwner = currentOwner;
  const previousMounting = mountingOwner;
  currentOwner = owner;
  mountingOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = previousOwner;
    mountingOwner = previousMounting;
  }
}

export function disposeOwner(owner) {
  if (!owner || owner.disposed) return;
  owner.disposed = true;
  const cleanups = owner.cleanups.splice(0).reverse();
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      console.error('[BaseDOM] cleanup error', error);
    }
  }
}

function ownCleanup(fn) {
  if (!currentOwner || currentOwner.disposed) return;
  currentOwner.cleanups.push(fn);
}

/**
 * Registers a cleanup on the active component owner.
 * Call during setup or from onMount (including to clear timers).
 * @param {Function} fn
 * @returns {Function} Stops the cleanup from running later.
 */
export function onCleanup(fn) {
  const owner = getCurrentOwner();
  if (!owner || owner.disposed) {
    throw new Error('onCleanup() must be called during component setup or a lifecycle hook');
  }
  owner.cleanups.push(fn);
  return () => {
    const index = owner.cleanups.indexOf(fn);
    if (index >= 0) owner.cleanups.splice(index, 1);
  };
}

function flushPendingEffects() {
  const runs = [...pendingEffects];
  pendingEffects.clear();
  for (const runner of runs) runner();
}

/**
 * Runs `fn` and notifies reactive subscribers once, after `fn` returns.
 * Nested batch() calls flush when the outermost batch ends.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function batch(fn) {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) flushPendingEffects();
  }
}

function scheduleEffect(runner) {
  if (batchDepth > 0) {
    pendingEffects.add(runner);
    return;
  }
  runner();
}

export function isSignal(value) {
  return typeof value === 'function' && (value.__isSignal || value._isSignal || typeof value.set === 'function');
}

export function unwrapSignal(value) {
  let current = value;
  let guard = 0;
  while (isSignal(current) && guard < 8) {
    current = current();
    guard += 1;
  }
  return current;
}

/**
 * Creates a reactive signal containing a value.
 * If the first argument is a string and a second argument is provided, the
 * signal is persistent and stored in sessionStorage under that key.
 * Passing a function to the setter updates from the previous value.
 * Wrap a function in an object if the stored value itself must be a function.
 * @param {string|*} nameOrValue
 * @param {*} [initialValueIfPersistent]
 * @returns {[Function, Function]}
 */
export function signal(nameOrValue, initialValueIfPersistent) {
  const isPersistent = typeof nameOrValue === 'string' && initialValueIfPersistent !== undefined;
  const key = isPersistent ? nameOrValue : null;
  let value = isPersistent ? initialValueIfPersistent : nameOrValue;

  if (isPersistent && typeof sessionStorage !== 'undefined') {
    try {
      const storedValue = sessionStorage.getItem(key);
      if (storedValue !== null) value = JSON.parse(storedValue);
    } catch (error) {
      console.warn(`Error loading persistent signal "${key}":`, error);
    }
  }

  const dependents = new Set();

  const get = () => {
    const subscriber = currentEffect;
    if (subscriber) {
      dependents.add(subscriber);
      subscriber.dependencies.add(() => dependents.delete(subscriber));
    }
    return value;
  };

  const set = (setter) => {
    const newValue = typeof setter === 'function' ? setter(value) : setter;
    if (Object.is(value, newValue)) return;

    value = newValue;
    if (isPersistent && typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.error(`Error saving signal "${key}":`, error);
      }
    }

    for (const effectRunner of [...dependents]) scheduleEffect(effectRunner);
  };

  get.set = set;
  get.__isSignal = true;
  get._isSignal = true;
  return [get, set];
}

/**
 * Creates a function that runs automatically when its tracked signals change.
 * @param {Function} fn
 * @returns {Function} dispose
 */
export function effect(fn) {
  let disposed = false;

  const cleanupDependencies = () => {
    runner.dependencies.forEach((cleanupFn) => cleanupFn());
    runner.dependencies.clear();
  };

  const runner = () => {
    if (disposed) return;
    if (effectDepth >= MAX_EFFECT_DEPTH) {
      throw new Error('BaseDOM reactive update exceeded the maximum depth. An effect is writing to a signal it reads.');
    }
    effectDepth += 1;
    cleanupDependencies();
    const previous = currentEffect;
    currentEffect = runner;
    try {
      fn();
    } finally {
      currentEffect = previous;
      effectDepth -= 1;
    }
  };

  runner.dependencies = new Set();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanupDependencies();
  };

  if (currentEffect) currentEffect.dependencies.add(dispose);
  ownCleanup(dispose);
  runner();
  return dispose;
}

/**
 * Creates a memoized, read-only signal.
 * Call `computedValue.dispose()` to stop updating, or create it inside a
 * component so the component owner disposes it on unmount.
 * @param {Function} fn
 * @returns {Function}
 */
export function computed(fn) {
  let value;
  let hasValue = false;
  const [getValue, setValue] = signal(undefined);
  const dispose = effect(() => {
    const newValue = fn();
    if (!hasValue || !Object.is(value, newValue)) {
      value = newValue;
      hasValue = true;
      setValue(newValue);
    }
  });

  const getter = () => {
    getValue();
    return value;
  };
  getter.dispose = dispose;
  getter.__isSignal = true;
  getter._isSignal = true;
  return getter;
}
