// graph.js
// Dev and build-time app graph. Not imported by the screen runtime.
// Scripts are parsed with Rollup's parser (shipped with Vite). Templates use
// a small scanner so locations stay file:line:column without a runtime dependency.

import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rollup/parseAst';

const HTML_TAGS = new Set(`a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr`.split(' '));

export function position(source, index) {
  const text = String(source || '');
  const at = Math.max(0, Math.min(index || 0, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < at; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return { line, column };
}

function loc(file, source, index) {
  const pos = position(source, index);
  return { file, line: pos.line, column: pos.column };
}

function slice(source, node) {
  if (!node || typeof node.start !== 'number') return '';
  return source.slice(node.start, node.end);
}

function findBlock(source, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const open = re.exec(source);
  if (!open) return null;
  const close = source.toLowerCase().indexOf(`</${tag}>`, open.index + open[0].length);
  if (close === -1) return null;
  const start = open.index + open[0].length;
  return { start, end: close, text: source.slice(start, close) };
}

function parseScript(source, file) {
  try {
    return parseAst(source);
  } catch (error) {
    const pos = typeof error.pos === 'number' ? error.pos : 0;
    const where = loc(file, source, pos);
    const failure = new Error(`[BaseDOM BD1021] ${error.message || 'Script syntax error'}`);
    failure.code = 'BD1021';
    failure.loc = where;
    failure.hint = 'Fix the <script setup> syntax. The previous page stays mounted until the next good save.';
    throw failure;
  }
}

function literal(node) {
  if (!node) return { value: undefined, raw: '' };
  if (node.type === 'Literal') return { value: node.value, raw: node.raw || String(node.value) };
  return { value: undefined, raw: '' };
}

function importMap(ast, source, file, fileDir) {
  const imports = [];
  const bindings = new Map();
  for (const node of ast.body || []) {
    if (node.type !== 'ImportDeclaration') continue;
    const spec = node.source && node.source.value;
    const resolved = spec && (spec.startsWith('./') || spec.startsWith('../'))
      ? path.resolve(fileDir, spec)
      : null;
    const entry = {
      source: spec,
      resolved,
      unresolved: !!(spec && (spec.startsWith('./') || spec.startsWith('../')) && resolved == null),
      names: [],
      loc: loc(file, source, node.start)
    };
    for (const item of node.specifiers || []) {
      const local = item.local && item.local.name;
      const imported = item.type === 'ImportDefaultSpecifier'
        ? 'default'
        : (item.imported && (item.imported.name || item.imported.value)) || local;
      entry.names.push({ local, imported });
      if (local) bindings.set(local, { source: spec, resolved, imported });
    }
    imports.push(entry);
  }
  return { imports, bindings };
}

function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return '';
  if (node.callee.type === 'Identifier') return node.callee.name;
  return '';
}

function readProps(node, source, file) {
  if (!node || node.type !== 'ObjectExpression') return [];
  const props = [];
  for (const prop of node.properties || []) {
    if (prop.type !== 'Property' || prop.computed) continue;
    const name = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    if (!name) continue;
    const record = { name, required: false, default: null, loc: loc(file, source, prop.start) };
    if (prop.value.type === 'ObjectExpression') {
      for (const field of prop.value.properties || []) {
        if (field.type !== 'Property' || field.computed) continue;
        const key = field.key.type === 'Identifier' ? field.key.name : field.key.value;
        if (key === 'required') record.required = !!(field.value.type === 'Literal' && field.value.value);
        if (key === 'default') {
          const lit = literal(field.value);
          record.default = {
            present: true,
            value: lit.value === undefined ? null : lit.value,
            expression: lit.raw || slice(source, field.value)
          };
        }
      }
    }
    props.push(record);
  }
  return props;
}

function walkCalls(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression') visit(node);
  for (const key of Object.keys(node)) {
    if (key === '_parent' || key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((item) => walkCalls(item, visit));
    else if (value && typeof value === 'object' && value.type) walkCalls(value, visit);
  }
}

function signalShape(ast) {
  const shape = [];
  walkCalls(ast, (node) => {
    if (calleeName(node) !== 'signal') return;
    const parent = node._parent;
    if (!parent || parent.type !== 'VariableDeclarator') return;
    let name = null;
    if (parent.id.type === 'ArrayPattern' && parent.id.elements[0] && parent.id.elements[0].type === 'Identifier') {
      name = parent.id.elements[0].name;
    } else if (parent.id.type === 'Identifier') name = parent.id.name;
    if (name) shape.push({ name });
  });
  return shape;
}

function markParents(node, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) node._parent = parent || null;
  for (const key of Object.keys(node)) {
    if (key === '_parent' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((item) => markParents(item, node.type ? node : parent));
    else if (value && typeof value === 'object' && value.type) markParents(value, node.type ? node : parent);
  }
}

/**
 * @param {string} source
 * @param {string} filename
 */
export function analyzeSfc(source, filename = 'component.html') {
  const file = path.resolve(filename);
  const scriptBlock = findBlock(source, 'script');
  const templateBlock = findBlock(source, 'template');
  const styleBlock = findBlock(source, 'style');
  const script = scriptBlock ? scriptBlock.text : '';
  const template = templateBlock ? templateBlock.text : source;
  const templateBase = templateBlock ? templateBlock.start : 0;
  const scriptBase = scriptBlock ? scriptBlock.start : 0;
  let ast = { body: [] };
  if (script.trim()) {
    ast = parseScript(script, file);
    markParents(ast, null);
  }
  const fileDir = path.dirname(file);
  const { imports, bindings } = script.trim()
    ? importMap(ast, script, file, fileDir)
    : { imports: [], bindings: new Map() };
  for (const item of imports) {
    item.loc = shiftLoc(item.loc, scriptBase, source);
  }
  const props = [];
  const emits = [];
  const provides = [];
  const injects = [];
  const resources = [];
  walkCalls(ast, (node) => {
    const name = calleeName(node);
    const at = loc(file, source, scriptBase + node.start);
    if (name === 'defineProps') props.push(...readProps(node.arguments[0], script, file).map((prop) => ({
      ...prop,
      loc: shiftLoc(prop.loc, scriptBase, source)
    })));
    if (name === 'emit' && node.arguments[0] && node.arguments[0].type === 'Literal') {
      emits.push({ name: String(node.arguments[0].value), loc: at });
    }
    if (name === 'provide' && node.arguments[0] && node.arguments[0].type === 'Literal') {
      provides.push({ key: String(node.arguments[0].value), loc: at });
    }
    if (name === 'inject' && node.arguments[0] && node.arguments[0].type === 'Literal') {
      injects.push({ key: String(node.arguments[0].value), loc: at });
    }
    if (name === 'createResource') resources.push({ loc: at });
  });
  const signals = signalShape(ast);
  const templateInfo = scanTemplate(template, file, templateBase, source);
  const base = path.basename(file).replace(/\.html$/i, '');
  return {
    id: file,
    name: base || 'component',
    file,
    loc: loc(file, source, 0),
    imports,
    props,
    emits,
    slots: templateInfo.slots,
    provides,
    injects,
    resources,
    models: templateInfo.models,
    fetches: templateInfo.fetches,
    uses: templateInfo.uses,
    signals,
    bindings: collectBindings(ast),
    template,
    styles: styleBlock ? styleBlock.text.trim() : '',
    script
  };
}

function shiftLoc(entry, base, source) {
  if (!entry) return entry;
  const pos = position(source, base);
  if (entry.line === 1) return { ...entry, line: pos.line, column: pos.column + entry.column - 1 };
  return { ...entry, line: pos.line + entry.line - 1 };
}

function collectBindings(ast) {
  const names = [];
  for (const node of ast.body || []) {
    if (node.type === 'FunctionDeclaration' && node.id) names.push(node.id.name);
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations || []) collectPattern(decl.id, names);
    }
  }
  return names;
}

function collectPattern(id, names) {
  if (!id) return;
  if (id.type === 'Identifier') names.push(id.name);
  if (id.type === 'ArrayPattern') id.elements.forEach((item) => collectPattern(item, names));
  if (id.type === 'ObjectPattern') id.properties.forEach((prop) => collectPattern(prop.value || prop.argument, names));
}

const FETCH_VERBS = new Set(['x-get', 'x-post', 'x-put', 'x-patch', 'x-delete']);

function scanTemplate(template, file, base, fullSource) {
  const slots = [];
  const models = [];
  const fetches = [];
  const uses = [];
  const text = String(template || '');
  let i = 0;
  let line = 1;
  let column = 1;
  const startPos = position(fullSource, base);
  const advance = (count) => {
    for (let n = 0; n < count && i < text.length; n += 1) {
      if (text[i] === '\n') { line += 1; column = 1; }
      else column += 1;
      i += 1;
    }
  };
  const here = () => ({
    file,
    line: line === 1 ? startPos.line : startPos.line + line - 1,
    column: line === 1 ? startPos.column + column - 1 : column
  });
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      advance(end === -1 ? text.length - i : end + 3 - i);
      continue;
    }
    if (text[i] !== '<') { advance(1); continue; }
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      advance(end === -1 ? 2 : end + 1 - i);
      continue;
    }
    const tagLoc = here();
    advance(1);
    const nameMatch = /^([A-Za-z][\w-]*)/.exec(text.slice(i));
    if (!nameMatch) { advance(1); continue; }
    const tag = nameMatch[1];
    advance(tag.length);
    const attrs = [];
    while (i < text.length && text[i] !== '>') {
      if (/\s/.test(text[i])) { advance(1); continue; }
      if (text[i] === '/' ) { advance(1); continue; }
      const attrLoc = here();
      const attrName = /^[@:A-Za-z_][\w:.-]*/.exec(text.slice(i));
      if (!attrName) { advance(1); continue; }
      advance(attrName[0].length);
      let value = '';
      if (text[i] === '=') {
        advance(1);
        const quote = text[i] === '"' || text[i] === "'" ? text[i] : '';
        if (quote) {
          advance(1);
          const end = text.indexOf(quote, i);
          value = text.slice(i, end === -1 ? text.length : end);
          advance(value.length + (end === -1 ? 0 : 1));
        } else {
          const end = text.slice(i).search(/[\s>]/);
          value = text.slice(i, end === -1 ? text.length : i + end);
          advance(value.length);
        }
      }
      attrs.push({ name: attrName[0], value, loc: attrLoc });
    }
    if (text[i] === '>') advance(1);
    if (tag.toLowerCase() === 'slot') {
      const named = attrs.find((attr) => attr.name === 'name');
      slots.push({
        name: named ? named.value : 'default',
        params: attrs.filter((attr) => attr.name.startsWith(':')).map((attr) => attr.name.slice(1)),
        loc: tagLoc
      });
    }
    for (const attr of attrs) {
      if (attr.name === 'x-model') models.push({ expression: attr.value, loc: attr.loc });
      if (FETCH_VERBS.has(attr.name)) {
        const target = attrs.find((item) => item.name === 'x-target');
        const swap = attrs.find((item) => item.name === 'x-swap');
        const url = attr.value || '';
        fetches.push({
          method: attr.name.slice(2).toUpperCase(),
          url: url || null,
          unresolved: !url || url.includes('{{') || url.includes('{'),
          target: target ? target.value : null,
          swap: swap ? (swap.value || 'innerHTML') : 'innerHTML',
          loc: attr.loc
        });
      }
    }
    if (!HTML_TAGS.has(tag.toLowerCase())) {
      uses.push({
        tag,
        props: attrs.filter((attr) => attr.name.startsWith(':')).map((attr) => ({
          name: attr.name.slice(1),
          expression: attr.value,
          loc: attr.loc
        })),
        events: attrs.filter((attr) => attr.name.startsWith('@')).map((attr) => ({
          name: attr.name.slice(1),
          expression: attr.value,
          loc: attr.loc
        })),
        loc: tagLoc
      });
    }
  }
  return { slots, models, uses, fetches };
}

function readProperty(node, name) {
  if (!node || node.type !== 'ObjectExpression') return null;
  return (node.properties || []).find((prop) => {
    if (prop.type !== 'Property' || prop.computed) return false;
    const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    return key === name;
  }) || null;
}

function expressionText(source, node) {
  if (!node) return '';
  if (node.type === 'Literal') return JSON.stringify(node.value);
  return source.slice(node.start, node.end);
}

function staticPath(node, bindings, fileDir) {
  if (!node) return { expression: '', resolved: null, unresolved: true, lazy: false };
  if (node.type === 'Literal' && typeof node.value === 'string') {
    const resolved = node.value.startsWith('.') ? path.resolve(fileDir, node.value) : null;
    return { expression: JSON.stringify(node.value), resolved, unresolved: !resolved, lazy: false };
  }
  if (node.type === 'Identifier' && bindings.has(node.name)) {
    const binding = bindings.get(node.name);
    return {
      expression: node.name,
      resolved: binding.resolved || null,
      unresolved: !binding.resolved,
      lazy: false
    };
  }
  if (node.type === 'CallExpression' && calleeName(node) === 'lazy') {
    const inner = staticPath(node.arguments[0], bindings, fileDir);
    const imported = findImportSpecifier(node.arguments[0]);
    if (imported) {
      return {
        expression: expressionText('', node) || 'lazy(...)',
        resolved: path.resolve(fileDir, imported),
        unresolved: false,
        lazy: true
      };
    }
    return { ...inner, lazy: true, unresolved: inner.unresolved !== false || !inner.resolved, expression: 'lazy(...)' };
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    const imported = findImportSpecifier(node.body);
    if (imported) {
      return { expression: imported, resolved: path.resolve(fileDir, imported), unresolved: false, lazy: true };
    }
  }
  return { expression: 'unresolved', resolved: null, unresolved: true, lazy: false };
}

function findImportSpecifier(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') return String(node.source.value);
  if (node.type === 'CallExpression') {
    const arg = node.arguments && node.arguments[0];
    if (arg && arg.type === 'Literal' && typeof arg.value === 'string' && (calleeName(node) === 'loadComponent' || calleeName(node) === 'import')) {
      return arg.value;
    }
  }
  for (const key of Object.keys(node)) {
    if (key === '_parent' || key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findImportSpecifier(item);
        if (found) return found;
      }
    } else if (value && typeof value === 'object' && value.type) {
      const found = findImportSpecifier(value);
      if (found) return found;
    }
  }
  return null;
}

function readRoute(node, source, file, bindings) {
  if (!node || node.type !== 'ObjectExpression') return null;
  const fileDir = path.dirname(file);
  const pathProp = readProperty(node, 'path');
  const componentProp = readProperty(node, 'component');
  const loadProp = readProperty(node, 'load');
  const childrenProp = readProperty(node, 'children');
  let pathValue = null;
  let pathUnresolved = true;
  let pathExpression = '';
  if (pathProp) {
    pathExpression = slice(source, pathProp.value);
    if (pathProp.value.type === 'Literal') {
      pathValue = String(pathProp.value.value);
      pathUnresolved = false;
    }
  }
  const component = componentProp
    ? { ...staticPath(componentProp.value, bindings, fileDir), loc: loc(file, source, componentProp.start) }
    : { expression: '', resolved: null, unresolved: true, lazy: false, loc: loc(file, source, node.start) };
  if (componentProp) component.expression = slice(source, componentProp.value);
  const children = [];
  if (childrenProp && childrenProp.value.type === 'ArrayExpression') {
    for (const item of childrenProp.value.elements || []) {
      const child = readRoute(item, source, file, bindings);
      if (child) children.push(child);
    }
  }
  return {
    path: {
      value: pathValue,
      unresolved: pathUnresolved,
      expression: pathExpression,
      loc: loc(file, source, pathProp ? pathProp.start : node.start)
    },
    component,
    load: { present: !!loadProp, loc: loadProp ? loc(file, source, loadProp.start) : null },
    children,
    loc: loc(file, source, node.start),
    file
  };
}

/**
 * @param {string} source
 * @param {string} filename
 */
export function analyzeRoutes(source, filename = 'app.js') {
  const file = path.resolve(filename);
  let ast;
  try {
    ast = parseAst(source);
  } catch (error) {
    const failure = new Error(`[BaseDOM BD1021] ${error.message || 'Route module syntax error'}`);
    failure.code = 'BD1021';
    failure.loc = loc(file, source, error.pos || 0);
    throw failure;
  }
  markParents(ast, null);
  const { bindings } = importMap(ast, source, file, path.dirname(file));
  const routes = [];
  walkCalls(ast, (node) => {
    if (calleeName(node) !== 'defineRoute') return;
    const route = readRoute(node.arguments[0], source, file, bindings);
    if (route) routes.push(route);
  });
  return routes;
}

function componentByTag(components, tag) {
  const needle = String(tag || '').toLowerCase();
  return components.find((item) => item.name.toLowerCase() === needle) || null;
}

function reachable(components, routes) {
  const byFile = new Map(components.map((item) => [item.file, item]));
  const seen = new Set();
  const paths = new Map();
  function visit(file, providers, chain) {
    if (!file || !byFile.has(file) || chain.includes(file)) return;
    const component = byFile.get(file);
    if (!paths.has(file)) paths.set(file, []);
    paths.get(file).push(new Set(providers));
    seen.add(file);
    const nextProviders = new Set(providers);
    for (const item of component.provides || []) nextProviders.add(item.key);
    const nextChain = chain.concat(file);
    for (const use of component.uses || []) {
      const child = componentByTag(components, use.tag);
      if (child) visit(child.file, nextProviders, nextChain);
    }
  }
  function walkRoute(route, providers) {
    let next = providers;
    if (route.component && route.component.resolved) {
      visit(route.component.resolved, providers, []);
      const component = byFile.get(route.component.resolved);
      next = new Set(providers);
      for (const item of (component && component.provides) || []) next.add(item.key);
    }
    for (const child of route.children || []) walkRoute(child, next);
  }
  for (const route of routes) walkRoute(route, new Set());
  return { seen, paths };
}

/**
 * @param {{ components: object[], routes: object[] }} graph
 * @param {{ exists?: (file: string) => boolean }} [options]
 */
export function lintGraph(graph, options = {}) {
  const exists = options.exists || ((file) => {
    try { return fs.existsSync(file); } catch { return false; }
  });
  const components = graph.components || [];
  const routes = graph.routes || [];
  const diagnostics = [];
  const push = (code, message, entry, hint) => {
    diagnostics.push({
      code,
      message,
      file: entry && entry.file,
      line: entry && entry.line,
      column: entry && entry.column,
      hint
    });
  };
  for (const component of components) {
    for (const use of component.uses || []) {
      const child = componentByTag(components, use.tag);
      if (!child || !child.props) continue;
      if (child.props.length) {
        const declared = new Set(child.props.map((prop) => prop.name));
        for (const prop of use.props || []) {
          if (!declared.has(prop.name)) {
            push('BD1031', `Prop "${prop.name}" is passed to <${use.tag}> but ${child.name} does not declare it.`, prop.loc, `Add ${prop.name} to defineProps() in ${child.file}.`);
          }
        }
      }
      const declaredEmits = new Set((child.emits || []).map((item) => item.name));
      for (const event of use.events || []) {
        if (!declaredEmits.has(event.name)) {
          push('BD1030', `Event "${event.name}" is listened on <${use.tag}> but ${child.name} never emit()s it.`, event.loc, `Call emit('${event.name}', payload) from ${child.name}, or remove @${event.name}.`);
        }
      }
    }
  }
  if (routes.length) {
    const { seen, paths } = reachable(components, routes);
    for (const component of components) {
      if (!seen.has(component.file)) {
        push('BD1034', `Component ${component.name} is not used by a route or a reachable parent.`, component.loc, 'Import it from a screen that a route renders, or remove the file.');
      }
      const chains = paths.get(component.file) || [];
      for (const inject of component.injects || []) {
        if (!chains.length) continue;
        const covered = chains.some((providers) => providers.has(inject.key));
        if (!covered) {
          push('BD1032', `inject("${inject.key}") in ${component.name} has no provide() in any ancestor.`, inject.loc, `Call provide('${inject.key}', value) from a parent screen.`);
        }
      }
    }
  }
  function walkRoute(route) {
    if (route.component && route.component.unresolved) {
      push('BD1035', `Route component is not a static file (${route.component.expression || 'unresolved'}).`, route.component.loc, 'Point component at an import() or an imported .html file.');
    } else if (route.component && route.component.resolved && !exists(route.component.resolved)) {
      push('BD1033', `Route component file is missing: ${route.component.resolved}`, route.component.loc, 'Create the file or fix the import path.');
    }
    if (route.path && route.path.unresolved) {
      push('BD1035', `Route path is not a literal (${route.path.expression || 'unresolved'}).`, route.path.loc, 'Use a string literal path so the graph can name the route.');
    }
    for (const child of route.children || []) walkRoute(child);
  }
  for (const route of routes) walkRoute(route);
  return diagnostics;
}

export function buildGraph(components, routes, options) {
  const diagnostics = lintGraph({ components, routes }, options);
  return { version: 1, components, routes, diagnostics };
}

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'integer', 'boolean', 'null']);

/**
 * Checks a graph against the checked-in JSON schema (the subset this repo uses).
 * @param {object} graph
 * @param {object} schema
 */
export function validateGraph(graph, schema) {
  const errors = [];
  checkNode(graph, schema, '$', errors);
  return errors;
}

function checkNode(value, schema, pointer, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type && SCHEMA_TYPES.has(schema.type)) {
    if (!typeOk(value, schema.type)) {
      errors.push(`${pointer} should be ${schema.type}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${pointer} should be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object' && value && typeof value === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${pointer}.${key} is required`);
    }
    const props = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) checkNode(child, props[key], `${pointer}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${pointer}.${key} is not allowed`);
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => checkNode(item, schema.items, `${pointer}[${index}]`, errors));
  }
}

function typeOk(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}
