// vite/plugin.js
// Optional development tooling. The runtime does not depend on Vite.
// Production compiles do not import the HMR runtime or the graph parser.
// Server-generated HTML is not compiled here and is not executed.

import fs from 'node:fs';
import path from 'node:path';
import { compileSfcToModule, looksLikeSfc } from '../sfc-compile.js';
import { analyzeRoutes, analyzeSfc, buildGraph } from '../graph.js';

const VIRTUAL = '\0basedom:';
const GRAPH_ID = '\0basedom:graph';
const ROUTE_MARK = '/* basedom-route-hmr */';

function resolveHtmlFile(id, importer, root) {
  const clean = id.split('?')[0];
  if (!clean.endsWith('.html')) return null;
  if (path.isAbsolute(clean) && fs.existsSync(clean)) return clean;
  if (importer) {
    const fromImporter = path.resolve(path.dirname(importer.split('?')[0]), clean);
    if (fs.existsSync(fromImporter)) return fromImporter;
  }
  if (root && clean.startsWith('/')) {
    const fromRoot = path.join(root, clean.slice(1));
    if (fs.existsSync(fromRoot)) return fromRoot;
  }
  return null;
}

function warnDiagnostics(logger, diagnostics) {
  if (!logger) return;
  for (const item of diagnostics || []) {
    const where = item.file ? ` ${item.file}:${item.line || 1}:${item.column || 1}` : '';
    logger.warn(`[BaseDOM ${item.code}]${where} ${item.message}${item.hint ? ` Fix: ${item.hint}` : ''}`);
  }
}

/**
 * @param {{ runtimeSpecifier?: string }} [options]
 */
export function basedom(options = {}) {
  const runtimeSpecifier = options.runtimeSpecifier || 'basedom/sfc.js';
  const routerSpecifier = runtimeSpecifier.replace(/sfc\.js$/, 'router.js');
  const navigationSpecifier = runtimeSpecifier.replace(/sfc\.js$/, 'navigation.js');
  const files = new Map();
  let projectRoot = '';
  let command = 'serve';
  let graph = { version: 1, components: [], routes: [], diagnostics: [] };
  let logger = null;

  function rebuild() {
    const components = [];
    const routes = [];
    for (const [file, source] of files) {
      if (file.endsWith('.html')) {
        try { components.push(analyzeSfc(source, file)); } catch { /* compile error is reported by load() */ }
      } else if (source.includes('defineRoute')) {
        try { routes.push(...analyzeRoutes(source, file)); } catch { /* syntax errors surface as transform errors */ }
      }
    }
    graph = buildGraph(components, routes);
    warnDiagnostics(logger, graph.diagnostics);
    return graph;
  }

  return {
    name: 'basedom-sfc',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root;
      command = config.command;
      logger = config.logger;
    },
    resolveId(id, importer, resolveOptions) {
      if (importer && importer.includes('\0basedom:') && (id.startsWith('./') || id.startsWith('../'))) {
        const owner = importer.split('\0basedom:')[1].replace(/\.js$/, '');
        const resolved = path.resolve(path.dirname(owner), id);
        if (fs.existsSync(resolved)) return resolved;
      }
      if (id === 'virtual:basedom-graph' || id === GRAPH_ID) return GRAPH_ID;
      if (resolveOptions && resolveOptions.scan) return null;
      if (!id.endsWith('.html') || id.startsWith('\0')) return null;
      const file = resolveHtmlFile(id, importer, projectRoot);
      if (!file || !fs.existsSync(file)) return null;
      let source;
      try { source = fs.readFileSync(file, 'utf8'); } catch { return null; }
      if (!looksLikeSfc(source)) return null;
      return VIRTUAL + file + '.js';
    },
    load(id) {
      if (id === GRAPH_ID) {
        return `export default ${JSON.stringify(graph)};\nif (import.meta.hot) { import.meta.hot.accept(); }\n`;
      }
      if (!id.startsWith(VIRTUAL) || !id.endsWith('.html.js')) return null;
      const file = id.slice(VIRTUAL.length, -'.js'.length);
      this.addWatchFile(file);
      const source = fs.readFileSync(file, 'utf8');
      let meta = null;
      try {
        meta = analyzeSfc(source, file);
      } catch (error) {
        this.error({
          message: error.message,
          id: file,
          loc: error.loc ? { line: error.loc.line, column: error.loc.column } : undefined
        });
      }
      files.set(file, source);
      rebuild();
      return compileSfcToModule(source, file, {
        runtimeSpecifier,
        hmr: command !== 'build',
        meta
      });
    },
    configureServer(server) {
      server.middlewares.use('/__basedom/graph', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(graph, null, 2));
      });
    },
    async hotUpdate({ file, environment, modules, server }) {
      if (!file || !environment) return;
      const resolved = path.resolve(file);
      if (fs.existsSync(resolved) && (resolved.endsWith('.html') || resolved.endsWith('.js'))) {
        files.set(resolved, fs.readFileSync(resolved, 'utf8'));
        rebuild();
      }
      const next = [...(modules || [])];
      if (resolved.endsWith('.html')) {
        const mod = environment.moduleGraph.getModuleById(VIRTUAL + resolved + '.js');
        if (mod && !next.includes(mod)) next.push(mod);
      }
      const graphMod = environment.moduleGraph.getModuleById(GRAPH_ID);
      if (graphMod && !next.includes(graphMod)) next.push(graphMod);
      if (server && server.ws) server.ws.send({ type: 'custom', event: 'basedom:graph', data: graph });
      return next.length ? next : undefined;
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes(`${path.sep}node_modules${path.sep}`)) return null;
      if (!file.endsWith('.js') || !/(?<!function )defineRoute\s*\(/.test(code)) return null;
      if (/(?:^|\/)router\.js$/.test(file)) return null;
      files.set(path.resolve(file), code);
      rebuild();
      if (command === 'build' || code.includes(ROUTE_MARK)) return null;
      return {
        code: `import { resetRoutes as __bdResetRoutes } from ${JSON.stringify(routerSpecifier)};
if (import.meta.hot) __bdResetRoutes();
${ROUTE_MARK}
${code}
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import(${JSON.stringify(navigationSpecifier)}).then((nav) => nav.navigate(nav.readBrowserRoute() || '/', { replace: true }));
  });
}
`,
        map: null
      };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'basedom-graph.json',
        source: JSON.stringify(graph, null, 2)
      });
    }
  };
}

export default basedom;
