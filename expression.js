// expression.js
// Template expression interpreter.
// This is not JavaScript eval. It does not call the Function constructor.
// Templates may read the context object, call functions the application placed
// there, and assign to signals. They cannot reach window, document, or Function.

import { isSignal, unwrapSignal } from './state.js';

export class ExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const BLOCKED_IDENTIFIERS = new Set([
  'eval', 'Function', 'window', 'document', 'globalThis', 'global', 'process',
  'require', 'module', 'exports', 'constructor', 'prototype', '__proto__',
  'this', 'arguments', 'new', 'class', 'function', 'import', 'export',
  'await', 'async', 'yield', 'with', 'debugger', 'super'
]);

const BLOCKED_KEYS = new Set([
  'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__'
]);

const SAFE_GLOBALS = {
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Date,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  NaN,
  Infinity,
  undefined
};

function isIdentStart(char) {
  return /[A-Za-z_$]/.test(char);
}

function isIdentPart(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

function tokenize(input) {
  const tokens = [];
  const source = String(input);
  let index = 0;

  const pushOp = (value, size) => {
    tokens.push({ type: 'op', value });
    index += size;
  };

  while (index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
      index += 1;
      continue;
    }

    const two = source.slice(index, index + 2);
    const three = source.slice(index, index + 3);
    if (two === '?.') throw new ExpressionError('Optional chaining (?.) is not supported in template expressions');
    if (two === '=>') throw new ExpressionError('Arrow functions are not supported in template expressions');
    if (three === '===' || three === '!==') {
      pushOp(three, 3);
      continue;
    }
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||' || two === '??') {
      pushOp(two, 2);
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '\\') {
          const escaped = source[index + 1];
          const map = { n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"' };
          if (escaped === 'u') {
            const hex = source.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ExpressionError('Invalid unicode escape in string');
            value += String.fromCharCode(parseInt(hex, 16));
            index += 6;
            continue;
          }
          value += map[escaped] ?? escaped ?? '';
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new ExpressionError('Unterminated string in template expression');
      tokens.push({ type: 'string', value });
      continue;
    }

    if (char === '.' && /[0-9]/.test(source[index + 1] || '')) {
      const match = source.slice(index).match(/^\.\d+(?:[eE][+-]?\d+)?/);
      if (!match) throw new ExpressionError('Invalid number');
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (/[0-9]/.test(char)) {
      const match = source.slice(index).match(/^\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/);
      if (!match) throw new ExpressionError('Invalid number');
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (isIdentStart(char)) {
      let end = index + 1;
      while (end < source.length && isIdentPart(source[end])) end += 1;
      tokens.push({ type: 'ident', value: source.slice(index, end) });
      index = end;
      continue;
    }

    if ('=+-*/%<>!?:.,[](){}'.includes(char)) {
      pushOp(char, 1);
      continue;
    }

    throw new ExpressionError(`Unexpected character "${char}" in template expression`);
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  peekOp(value) {
    const token = this.peek();
    return !!token && token.type === 'op' && token.value === value;
  }

  matchOp(value) {
    if (!this.peekOp(value)) return false;
    this.index += 1;
    return true;
  }

  expectOp(value) {
    if (!this.matchOp(value)) {
      throw new ExpressionError(`Expected "${value}" in template expression`);
    }
  }

  parseExpression() {
    let left = this.parseBinary(1);
    if (this.matchOp('?')) {
      const yes = this.parseExpression();
      this.expectOp(':');
      const no = this.parseExpression();
      return { type: 'ternary', test: left, yes, no };
    }
    if (this.matchOp('=')) {
      const right = this.parseExpression();
      return { type: 'assign', target: left, right };
    }
    return left;
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (!token || token.type !== 'op') break;
      const prec = binaryPrecedence(token.value);
      if (!prec || prec < minPrec) break;
      this.index += 1;
      const right = this.parseBinary(prec + 1);
      left = { type: 'binary', op: token.value, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.matchOp('!') || this.matchOp('-') || this.matchOp('+')) {
      const op = this.tokens[this.index - 1].value;
      return { type: 'unary', op, expr: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.matchOp('.')) {
        const token = this.peek();
        if (!token || token.type !== 'ident') throw new ExpressionError('Expected property name');
        this.index += 1;
        expr = { type: 'member', object: expr, property: { type: 'literal', value: token.value }, computed: false };
        continue;
      }
      if (this.matchOp('[')) {
        const property = this.parseExpression();
        this.expectOp(']');
        expr = { type: 'member', object: expr, property, computed: true };
        continue;
      }
      if (this.matchOp('(')) {
        const args = [];
        if (!this.peekOp(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.matchOp(','));
        }
        this.expectOp(')');
        expr = { type: 'call', callee: expr, args };
        continue;
      }
      break;
    }
    return expr;
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new ExpressionError('Unexpected end of template expression');

    if (token.type === 'number' || token.type === 'string') {
      this.index += 1;
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'ident') {
      this.index += 1;
      if (token.value === 'true') return { type: 'literal', value: true };
      if (token.value === 'false') return { type: 'literal', value: false };
      if (token.value === 'null') return { type: 'literal', value: null };
      if (token.value === 'undefined') return { type: 'literal', value: undefined };
      return { type: 'ident', name: token.value };
    }

    if (this.matchOp('(')) {
      const expr = this.parseExpression();
      this.expectOp(')');
      return expr;
    }

    if (this.matchOp('[')) {
      const items = [];
      if (!this.peekOp(']')) {
        do {
          if (this.peekOp(']')) break;
          items.push(this.parseExpression());
        } while (this.matchOp(','));
      }
      this.expectOp(']');
      return { type: 'array', items };
    }

    throw new ExpressionError(`Unexpected token in template expression`);
  }
}

function binaryPrecedence(op) {
  switch (op) {
    case '??': return 1;
    case '||': return 2;
    case '&&': return 3;
    case '===':
    case '!==':
    case '==':
    case '!=':
      return 4;
    case '<':
    case '>':
    case '<=':
    case '>=':
      return 5;
    case '+':
    case '-':
      return 6;
    case '*':
    case '/':
    case '%':
      return 7;
    default:
      return 0;
  }
}

function assertSafeKey(key) {
  const normalized = String(key);
  if (BLOCKED_KEYS.has(normalized)) {
    throw new ExpressionError(`Unsafe property access "${normalized}"`);
  }
  return normalized;
}

function lookup(context, name) {
  if (BLOCKED_IDENTIFIERS.has(name)) {
    throw new ExpressionError(`Unsafe identifier "${name}"`);
  }
  if (context && Object.prototype.hasOwnProperty.call(context, name)) return context[name];
  if (Object.prototype.hasOwnProperty.call(SAFE_GLOBALS, name)) return SAFE_GLOBALS[name];
  return undefined;
}

function evalAst(node, context) {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'ident':
      return unwrapSignal(lookup(context, node.name));
    case 'unary': {
      const value = evalAst(node.expr, context);
      if (node.op === '!') return !value;
      if (node.op === '-') return -value;
      return +value;
    }
    case 'binary':
      return evalBinary(node, context);
    case 'ternary':
      return evalAst(node.test, context) ? evalAst(node.yes, context) : evalAst(node.no, context);
    case 'array':
      return node.items.map((item) => evalAst(item, context));
    case 'member':
      return evalMember(node, context);
    case 'call':
      return evalCall(node, context);
    case 'assign':
      return evalAssign(node, context);
    default:
      throw new ExpressionError('Unknown expression');
  }
}

function evalBinary(node, context) {
  if (node.op === '&&') {
    const left = evalAst(node.left, context);
    return left ? evalAst(node.right, context) : left;
  }
  if (node.op === '||') {
    const left = evalAst(node.left, context);
    return left ? left : evalAst(node.right, context);
  }
  if (node.op === '??') {
    const left = evalAst(node.left, context);
    return left == null ? evalAst(node.right, context) : left;
  }

  const left = evalAst(node.left, context);
  const right = evalAst(node.right, context);
  switch (node.op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return left / right;
    case '%': return left % right;
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': return left == right;
    case '!=': return left != right;
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    default:
      throw new ExpressionError(`Unsupported operator "${node.op}"`);
  }
}

function evalMember(node, context) {
  const object = evalAst(node.object, context);
  const key = node.computed ? evalAst(node.property, context) : node.property.value;
  assertSafeKey(key);
  if (object == null) return undefined;
  return unwrapSignal(object[key]);
}

function evalCall(node, context) {
  const args = () => node.args.map((arg) => evalAst(arg, context));
  if (node.callee.type === 'member') {
    const object = evalAst(node.callee.object, context);
    const key = node.callee.computed ? evalAst(node.callee.property, context) : node.callee.property.value;
    assertSafeKey(key);
    if (object == null) throw new ExpressionError('Cannot call a method on an empty value');
    const fn = object[key];
    if (typeof fn !== 'function') throw new ExpressionError(`"${String(key)}" is not a function`);
    return fn.apply(object, args());
  }
  if (node.callee.type === 'ident') {
    const raw = lookup(context, node.callee.name);
    const fn = isSignal(raw) ? unwrapSignal(raw) : raw;
    if (typeof fn !== 'function') throw new ExpressionError(`"${node.callee.name}" is not a function`);
    return fn(...args());
  }
  const fn = evalAst(node.callee, context);
  if (typeof fn !== 'function') throw new ExpressionError('Expression is not a function');
  return fn(...args());
}

function evalAssign(node, context) {
  if (!node.target || node.target.type !== 'ident') {
    throw new ExpressionError('Template assignment only supports signal names');
  }
  const name = node.target.name;
  if (BLOCKED_IDENTIFIERS.has(name)) throw new ExpressionError(`Unsafe identifier "${name}"`);
  const value = evalAst(node.right, context);
  const raw = context && Object.prototype.hasOwnProperty.call(context, name) ? context[name] : undefined;
  if (isSignal(raw)) {
    raw.set(value);
    return value;
  }
  const setterName = `set${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const setter = context && Object.prototype.hasOwnProperty.call(context, setterName) ? context[setterName] : undefined;
  if (typeof setter === 'function' && !isSignal(setter)) {
    setter(value);
    return value;
  }
  throw new ExpressionError(`Cannot assign to "${name}". Return the signal getter (it has .set) or a set${name.charAt(0).toUpperCase()}${name.slice(1)} function.`);
}

function evaluateParsed(expression, context) {
  const source = String(expression ?? '').trim();
  if (!source) return undefined;
  const parser = new Parser(tokenize(source));
  const ast = parser.parseExpression();
  if (parser.peek()) throw new ExpressionError('Unexpected extra tokens in template expression');
  return evalAst(ast, context || {});
}

/**
 * Evaluates a template expression.
 * By default, failures are warned and return undefined so one bad binding does
 * not blank a page. Pass `{ throw: true }` to surface ExpressionError.
 * @param {string} expression
 * @param {object} context
 * @param {{ throw?: boolean }} [options]
 */
export function evaluateExpression(expression, context, options = {}) {
  try {
    return evaluateParsed(expression, context);
  } catch (error) {
    if (options.throw) throw error;
    console.warn(`Expression evaluation failed: ${expression}`, error);
    return undefined;
  }
}

/**
 * Reads a signal/computed getter. Plain functions are returned unchanged so
 * event handlers are not invoked just by being interpolated.
 * Arrays and plain objects are walked so older call sites keep seeing values.
 * @param {*} value
 */
export function _reactive(value) {
  if (value == null) return value;
  if (typeof value === 'function') {
    if (isSignal(value)) {
      try {
        return _reactive(value());
      } catch (error) {
        console.warn('Error getting reactive value:', error);
        return undefined;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => _reactive(item));
  if (typeof value === 'object' && value.constructor === Object) {
    const reactiveObject = {};
    for (const [key, entry] of Object.entries(value)) reactiveObject[key] = _reactive(entry);
    return reactiveObject;
  }
  return value;
}

export class ExpressionParser {
  evaluate(expression, context) {
    return evaluateExpression(expression, context);
  }
}

export const expressionParser = new ExpressionParser();
