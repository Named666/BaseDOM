// resource.js
// Async value with loading / error / value / refetch.
// A newer source value drops the previous response and aborts its signal.
// This file does not import the router.

import { effect, onCleanup, signal, trackSuspense, untrack } from './state.js';

/**
 * @param {(() => *)|((source: *, context: { signal: AbortSignal }) => Promise<*>)} source
 * @param {(source: *, context: { signal: AbortSignal }) => Promise<*>} [fetcher]
 */
export function createResource(source, fetcher) {
  if (typeof source === 'function' && fetcher === undefined) {
    fetcher = source;
    source = null;
  }
  if (typeof fetcher !== 'function') {
    throw new Error('[BaseDOM BD1014] createResource() needs a fetcher function. Fix: pass (source, fetcher) or just a fetcher.');
  }
  const [value, setValue] = signal(undefined);
  const [error, setError] = signal(null);
  const [loading, setLoading] = signal(false);
  let seq = 0;
  let controller = null;

  function abort() {
    if (controller) controller.abort();
    controller = null;
  }

  function run(src) {
    const id = ++seq;
    abort();
    controller = new AbortController();
    const abortSignal = controller.signal;
    setLoading(true);
    setError(null);
    const job = Promise.resolve()
      .then(() => fetcher(src, { signal: abortSignal }))
      .then((result) => {
        if (id !== seq || abortSignal.aborted) return;
        setValue(result);
      })
      .catch((err) => {
        if (id !== seq || abortSignal.aborted || (err && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (id === seq) setLoading(false);
      });
    trackSuspense(job);
    return job;
  }

  if (source) {
    effect(() => {
      const src = source();
      untrack(() => { run(src); });
    });
  } else {
    run(undefined);
  }

  try { onCleanup(abort); } catch { /* outside setup the caller can dispose() */ }

  function read() { return value(); }
  read.loading = loading;
  read.error = error;
  read.value = value;
  read.refetch = () => run(source ? untrack(source) : undefined);
  read.dispose = abort;
  return read;
}
