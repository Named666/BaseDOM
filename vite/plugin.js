// vite/plugin.js
// Optional development tooling. The runtime does not depend on Vite.
// Author SFCs are compiled to real modules. The id is virtual so Vite's HTML
// plugin does not parse the generated module as a document.
// The graph JSON is produced by the same scan as compileSfcToModule.
// Server-generated HTML is not compiled here and is not executed.

import fs from 'node:fs';
import path from 'node:path';
import { compileSfcToModule, describeRoutes, describeSfc, looksLikeSfc } from '../sfc-compile.js';

const VIRTUAL = '\0basedom:';

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

/**
 * @param {{ runtimeSpecifier?: string }} [options]
 */
export function basedom(options = {}) {
  const runtimeSpecifier = options.runtimeSpecifier || 'basedom/sfc.js';
  const screens = new Map();
  const routes = new Map();
  let projectRoot = '';
  return {
    name: 'basedom-sfc',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root;
    },
    resolveId(id, importer, options) {
      // The dep scanner reads .html as HTML. Handing it the virtual module
      // makes esbuild try to open a path that contains a null byte.
      if (options && options.scan) return null;
      if (!id.endsWith('.html') || id.startsWith('\0')) return null;
      const file = resolveHtmlFile(id, importer, projectRoot);
      if (!file || !fs.existsSync(file)) return null;
      let source;
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
      if (!looksLikeSfc(source)) return null;
      // End in .js so Vite's HTML pipeline does not parse the module.
      return VIRTUAL + file + '.js';
    },
    load(id) {
      if (!id.startsWith(VIRTUAL) || !id.endsWith('.html.js')) return null;
      const file = id.slice(VIRTUAL.length, -'.js'.length);
      this.addWatchFile(file);
      const source = fs.readFileSync(file, 'utf8');
      screens.set(file, describeSfc(source, file));
      return compileSfcToModule(source, file, { runtimeSpecifier });
    },
    async hotUpdate({ file, environment }) {
      if (!file.endsWith('.html') || !environment) return;
      let source;
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch {
        return;
      }
      if (!looksLikeSfc(source)) return;
      const id = VIRTUAL + path.resolve(file) + '.js';
      const mod = environment.moduleGraph.getModuleById(id);
      if (!mod) return;
      return [mod];
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes(`${path.sep}node_modules${path.sep}`)) return null;
      if (!file.endsWith('.js') || !code.includes('defineRoute')) return null;
      for (const route of describeRoutes(code, file)) routes.set(`${file}:${route.path}`, route);
      return null;
    },
    generateBundle() {
      const graph = {
        screens: [...screens.values()],
        routes: [...routes.values()]
      };
      this.emitFile({
        type: 'asset',
        fileName: 'basedom-graph.json',
        source: JSON.stringify(graph, null, 2)
      });
    }
  };
}

export default basedom;
