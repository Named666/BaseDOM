// context.js
// Owner-scoped values. A child reads what an ancestor provided.
// Signals are passed through as signals. This file does not import the router.

import { getCurrentOwner } from './state.js';
import { reportDiagnostic } from './diagnostics.js';

/**
 * Stores `value` for descendants of the component currently setting up.
 * Pass a signal getter to share live state.
 * @param {string} key
 * @param {*} value
 */
export function provide(key, value) {
  const owner = getCurrentOwner();
  if (!owner) {
    throw reportDiagnostic('BD1008', 'provide() must run during setup', {
      hint: 'Call provide() inside setup(), or from an event handler in that component.'
    });
  }
  if (!owner.provides) owner.provides = Object.create(null);
  owner.provides[key] = value;
}

/**
 * Reads the nearest ancestor value for `key`.
 * Pass a default to use when no ancestor provided the key.
 * With no default, a missing key throws BD1006.
 * @template T
 * @param {string} key
 * @param {T} [defaultValue]
 * @returns {T}
 */
export function inject(key, defaultValue) {
  let current = getCurrentOwner();
  while (current) {
    if (current.provides && Object.prototype.hasOwnProperty.call(current.provides, key)) {
      return current.provides[key];
    }
    current = current.parent;
  }
  if (arguments.length >= 2) return defaultValue;
  throw reportDiagnostic('BD1006', `inject("${String(key)}") found no provider`, {
    hint: 'Call provide() in an ancestor setup, or pass a default as the second argument.'
  });
}
