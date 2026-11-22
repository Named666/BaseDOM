import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { analyzeRoutes, analyzeSfc, buildGraph, validateGraph } from '../graph.js';

const schema = JSON.parse(fs.readFileSync(new URL('../schema/basedom-graph.schema.json', import.meta.url), 'utf8'));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures/graph');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

describe('app graph', () => {
  it('parses props, emits, slots, provide/inject, resources, and imports', () => {
    const home = analyzeSfc(read('home.html'), path.join(root, 'home.html'));
    assert.deepEqual(home.signals.map((item) => item.name), ['count']);
    assert.equal(home.props.find((item) => item.name === 'title').required, true);
    assert.equal(home.props.find((item) => item.name === 'name').default.value, '');
    assert.deepEqual(home.emits.map((item) => item.name), ['save']);
    assert.deepEqual(home.slots.map((item) => item.name), ['default', 'extra']);
    assert.deepEqual(home.slots.find((item) => item.name === 'extra').params, ['item']);
    assert.deepEqual(home.provides.map((item) => item.key), ['theme']);
    assert.deepEqual(home.injects.map((item) => item.key), ['locale']);
    assert.equal(home.resources.length, 1);
    assert.deepEqual(home.models.map((item) => item.expression), ['name']);
    assert.equal(home.uses[0].tag, 'kid');
    assert.equal(home.uses[0].props[0].name, 'count');
    assert.equal(home.uses[0].events[0].name, 'save');
    assert.equal(home.imports.find((item) => item.source === './logic.js').resolved, path.join(root, 'logic.js'));
    assert.ok(home.emits[0].loc.line > 1);
    assert.equal(home.emits[0].loc.column > 0, true);
  });

  it('parses nested, lazy, and non-literal routes and flags what it cannot resolve', () => {
    const file = path.join(root, 'routes.js');
    const routes = analyzeRoutes(read('routes.js'), file);
    assert.equal(routes[0].path.value, '/');
    assert.equal(routes[0].path.unresolved, false);
    assert.equal(routes[0].component.resolved, path.join(root, 'layout.html'));
    const notes = routes[0].children.find((route) => route.path.value === 'notes');
    assert.equal(notes.component.lazy, true);
    assert.equal(notes.component.resolved, path.join(root, 'notes.html'));
    assert.equal(notes.load.present, true);
    const dynamic = routes[0].children.find((route) => route.path.unresolved);
    assert.equal(dynamic.path.value, null);
    assert.match(dynamic.path.expression, /base \+ '\/x'/);
    assert.equal(dynamic.component.unresolved, true);
    const missing = routes[0].children.find((route) => route.component.resolved && route.component.resolved.endsWith('missing.html'));
    assert.equal(missing.component.unresolved, false);
    assert.equal(missing.component.lazy, true);
  });

  it('lints undeclared emits, unknown props, missing injects, missing files, and unused components', () => {
    const dir = root;
    const layout = analyzeSfc(read('layout.html'), path.join(dir, 'layout.html'));
    const home = analyzeSfc(read('home.html'), path.join(dir, 'home.html'));
    const kid = analyzeSfc(read('kid.html'), path.join(dir, 'kid.html'));
    const orphan = analyzeSfc(read('orphan.html'), path.join(dir, 'orphan.html'));
    const routes = analyzeRoutes(read('routes.js'), path.join(dir, 'routes.js'));
    const graph = buildGraph([layout, home, kid, orphan], routes, {
      exists(file) { return fs.existsSync(file) && !file.endsWith('missing.html'); }
    });
    const codes = graph.diagnostics.map((item) => item.code);
    assert.ok(codes.includes('BD1030'), codes.join(','));
    assert.ok(codes.includes('BD1031'), codes.join(','));
    assert.ok(codes.includes('BD1032'), codes.join(','));
    assert.ok(codes.includes('BD1033'), codes.join(','));
    assert.ok(codes.includes('BD1034'), codes.join(','));
    assert.ok(codes.includes('BD1035'), codes.join(','));
    const errors = validateGraph(graph, schema);
    assert.deepEqual(errors, []);
  });

  it('rejects a graph that does not match the schema', () => {
    const errors = validateGraph({ version: '1', components: [] }, schema);
    assert.ok(errors.some((error) => error.includes('version')));
    assert.ok(errors.some((error) => error.includes('routes')));
  });
});
