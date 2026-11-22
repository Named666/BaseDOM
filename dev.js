// dev.js
// Small logger kept out of index.js so render/runtime modules can warn
// without a circular import through the package entry.

export const DEV_MODE = true;

export function devWarn(message, node) {
  if (globalThis.__BASEDOM_DEV__ === false) return;
  if (node === undefined) console.warn(`[BaseDOM]: ${message}`);
  else console.warn(`[BaseDOM]: ${message}`, node);
}

if (typeof window !== 'undefined') {
  window.devWarn = devWarn;
}
