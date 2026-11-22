import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signal, computed, effect, batch, createOwner, runWithOwner, disposeOwner } from '../state.js';

describe('signals', () => {
  it('reads and writes the current value', () => {
    const [count, setCount] = signal(1);
    assert.equal(count(), 1);
    setCount(2);
    assert.equal(count(), 2);
    setCount((value) => value + 1);
    assert.equal(count(), 3);
  });

  it('does not notify when the value is unchanged', () => {
    const [count, setCount] = signal(1);
    let runs = 0;
    effect(() => {
      count();
      runs += 1;
    });
    setCount(1);
    assert.equal(runs, 1);
  });

  it('treats NaN as the same value', () => {
    const [count, setCount] = signal(NaN);
    let runs = 0;
    effect(() => {
      count();
      runs += 1;
    });
    setCount(NaN);
    assert.equal(runs, 1);
  });

  it('drops conditional dependencies', () => {
    const [on, setOn] = signal(true);
    const [count, setCount] = signal(0);
    let runs = 0;
    effect(() => {
      runs += 1;
      if (on()) count();
    });
    setCount(1);
    assert.equal(runs, 2);
    setOn(false);
    const after = runs;
    setCount(2);
    assert.equal(runs, after);
  });

  it('batches notifications', () => {
    const [a, setA] = signal(1);
    const [b, setB] = signal(2);
    let runs = 0;
    effect(() => {
      a();
      b();
      runs += 1;
    });
    batch(() => {
      setA(3);
      setB(4);
    });
    assert.equal(runs, 2);
    assert.equal(a() + b(), 7);
  });

  it('stops a disposed effect and disposes owned effects with the owner', () => {
    const [count, setCount] = signal(0);
    let runs = 0;
    const stop = effect(() => {
      count();
      runs += 1;
    });
    stop();
    setCount(1);
    assert.equal(runs, 1);

    const owner = createOwner();
    let owned = 0;
    runWithOwner(owner, () => effect(() => {
      count();
      owned += 1;
    }));
    disposeOwner(owner);
    setCount(2);
    assert.equal(owned, 1);
  });

  it('recomputes a computed value and can dispose it', () => {
    const [count, setCount] = signal(2);
    const double = computed(() => count() * 2);
    assert.equal(double(), 4);
    setCount(3);
    assert.equal(double(), 6);
    double.dispose();
    setCount(4);
    assert.equal(double(), 6);
  });
});
