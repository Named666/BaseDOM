import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { signal } from '../state.js';
import { evaluateExpression, ExpressionError } from '../expression.js';

const strict = { throw: true };

describe('template expressions', () => {
  it('does not use eval or new Function', () => {
    const source = readFileSync(new URL('../expression.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new Function/);
    assert.doesNotMatch(source, /\beval\s*\(/);
  });

  it('evaluates operators, calls, and short-circuit', () => {
    const [count] = signal(2);
    let called = false;
    const context = {
      count,
      label: 'a',
      dangerous() { called = true; return 1; },
      add(value) { return value + 1; }
    };
    assert.equal(evaluateExpression('count > 1 && label + "!"', context, strict), 'a!');
    assert.equal(evaluateExpression('add(count)', context, strict), 3);
    assert.equal(evaluateExpression('false && dangerous()', context, strict), false);
    assert.equal(called, false);
    assert.equal(evaluateExpression('count == "2" ? "yes" : "no"', context, strict), 'yes');
    assert.deepEqual(evaluateExpression('[count, 3]', context, strict), [2, 3]);
  });

  it('assigns to signals', () => {
    const [count, setCount] = signal(1);
    evaluateExpression('count = count + 1', { count, setCount }, strict);
    assert.equal(count(), 2);
  });

  it('blocks host objects and constructor escapes', () => {
    const context = { Object, payload: { id: 1 } };
    for (const expression of ['window', 'document', 'globalThis', 'Function', 'constructor', 'Object.constructor', "payload['constructor']", '(function(){ return 1 })()']) {
      assert.throws(() => evaluateExpression(expression, context, strict), ExpressionError);
    }
  });
});
