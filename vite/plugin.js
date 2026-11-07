// vite/plugin.js
// Optional development tooling. The runtime does not depend on Vite.
// Author SFCs are compiled to real modules. The id is virtual so Vite's HTML
// plugin does not parse the generated module as a document.
// Server-generated HTML is not compiled here and is not executed.

import fs from 'node:fs';
import path from 'node:path';
import { compileSfcToModule, looksLikeSfc } from '../sfc-compile.js';

const VIRTUAL = '\0basedom:';

function resolveHtmlFile(id, importer) {
  const clean = id.split('?')[0];
  if (!clean.endsWith('.html')) return null;
  if (path.isAbsolute(clean)) return clean;
  if (!importer) return null;
  return path.resolve(path.dirname(importer.split('?')[0]), clean);
}

/**
 * @param {{ runtimeSpecifier?: string }} [options]
 */
export function basedom(options = {}) {
  const runtimeSpecifier = options.runtimeSpecifier || 'basedom/sfc.js';
  return {
    name: 'basedom-sfc',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith('.html') || id.startsWith('\0')) return null;
      const file = resolveHtmlFile(id, importer);
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
      return compileSfcToModule(fs.readFileSync(file, 'utf8'), file, { runtimeSpecifier });
    }
  };
}

export default basedom;
