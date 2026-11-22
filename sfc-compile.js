// sfc-compile.js
// Turns an author-written .html SFC into a JavaScript module string.
// Used by the Vite plugin. The runtime does not eval this source.
// No virtual DOM is generated; the module calls defineSfc().
import { reportDiagnostic } from './diagnostics.js';

const INLINE_SCRIPT_HINT = 'Move the script to <script setup src="./component.js"></script> or compile this file with the BaseDOM Vite plugin.';

export function looksLikeSfc(source) {
  return /<template\b/i.test(source) || /<script\b[^>]*\bsetup\b/i.test(source);
}

function findBlocks(html, tag) {
  const results = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let match;
  while ((match = re.exec(html))) {
    results.push({ attrs: match[1] || '', body: match[2] || '', index: match.index, length: match[0].length });
  }
  return results;
}

function attrValue(attrs, name) {
  const match = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

/**
 * Splits an SFC string into template, style, and script metadata.
 * Does not execute the script.
 * @param {string} htmlText
 */
export function extractSfcParts(htmlText) {
  const html = String(htmlText || '').replace(/\r\n?/g, '\n');
  const scripts = findBlocks(html, 'script');
  const styles = findBlocks(html, 'style');
  const templates = findBlocks(html, 'template');
  const script = scripts.find((block) => /\bsetup\b/i.test(block.attrs)) || scripts[0] || null;
  const template = templates.length
    ? templates.map((block) => block.body.trim()).join('\n')
    : html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .trim();
  return {
    template,
    styles: styles.map((block) => block.body.trim()).filter(Boolean).join('\n'),
    scriptSrc: script ? attrValue(script.attrs, 'src') : '',
    inlineScript: script ? script.body.trim() : '',
    hasInlineScript: !!(script && script.body.trim()),
    isSetup: !!(script && /\bsetup\b/i.test(script.attrs))
  };
}

function skipSpaceAndComments(source, index) {
  let i = index;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i += 1;
      continue;
    }
    if (source.startsWith('//', i)) {
      const next = source.indexOf('\n', i);
      i = next === -1 ? source.length : next + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const next = source.indexOf('*/', i + 2);
      i = next === -1 ? source.length : next + 2;
      continue;
    }
    break;
  }
  return i;
}

function startsWithKeyword(source, index, word) {
  if (!source.startsWith(word, index)) return false;
  const next = source[index + word.length];
  return next == null || /[^A-Za-z0-9_$]/.test(next);
}

function scanStatement(source, index) {
  let quote = null;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = index; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === ';') return i + 1;
  }
  return source.length;
}

export function splitModulePrelude(code) {
  const imports = [];
  let index = 0;
  const source = String(code || '');
  while (index < source.length) {
    const start = skipSpaceAndComments(source, index);
    if (!startsWithKeyword(source, start, 'import')) {
      index = start;
      break;
    }
    const end = scanStatement(source, start);
    imports.push(source.slice(start, end).trim());
    index = end;
  }
  return { imports, body: source.slice(index) };
}

function importedBindings(statement) {
  if (/^import\s+['"]/.test(statement)) return [];
  const withoutFrom = statement.replace(/\s+from\s+['"][^'"]+['"]\s*;?$/, '').replace(/^import\s+/, '').trim();
  if (!withoutFrom) return [];
  const star = withoutFrom.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (star) return [star[1]];
  const names = [];
  let rest = withoutFrom;
  if (!rest.startsWith('{')) {
    const def = rest.match(/^([A-Za-z_$][\w$]*)\s*,?/);
    if (def) {
      names.push(def[1]);
      rest = rest.slice(def[0].length).trim();
    }
  }
  const brace = rest.match(/\{([\s\S]*)\}/);
  if (brace) {
    brace[1].split(',').forEach((part) => {
      const bit = part.trim();
      if (!bit) return;
      const alias = bit.split(/\s+as\s+/);
      const local = (alias[1] || alias[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    });
  }
  return names;
}

function stripForScan(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function extractSetupBindings(code) {
  const names = [];
  const source = stripForScan(code);
  const decl = /^(?:const|let|var)\s+([^=;\n]+)/gm;
  let match;
  while ((match = decl.exec(source))) {
    const lhs = match[1].trim().replace(/,$/, '');
    if (lhs.startsWith('[')) {
      lhs.slice(1, -1).split(',').forEach((part) => {
        const name = part.split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      });
    } else if (lhs.startsWith('{')) {
      lhs.slice(1, -1).split(',').forEach((part) => {
        let name = part.trim();
        if (name.includes(':')) name = name.split(':')[1].trim();
        if (name.includes('=')) name = name.split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      });
    } else {
      lhs.split(',').forEach((part) => {
        const name = part.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      });
    }
  }
  const fn = /^(?:async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  while ((match = fn.exec(source))) names.push(match[1]);
  return names;
}

function componentName(filename) {
  const base = String(filename || 'component').split(/[\\/]/).pop().replace(/\.html$/i, '');
  return base || 'component';
}

/**
 * Compiles an SFC with inline <script setup> to an ES module.
 * The script text is emitted as authored source, not evaluated here.
 * @param {string} source
 * @param {string} [filename]
 * @param {{ runtimeSpecifier?: string }} [options]
 */
export function compileSfcToModule(source, filename = 'component.html', options = {}) {
  const parts = extractSfcParts(source);
  const runtime = options.runtimeSpecifier || 'basedom/sfc.js';
  if (parts.hasInlineScript && !parts.isSetup) {
    throw reportDiagnostic('BD1015', 'Only <script setup> can be compiled inline.', {
      file: filename,
      hint: INLINE_SCRIPT_HINT
    });
  }
  if (parts.scriptSrc && parts.hasInlineScript) {
    throw reportDiagnostic('BD1015', 'Use either <script setup src> or an inline <script setup>, not both.', {
      file: filename,
      hint: 'Keep one script block.'
    });
  }

  let prelude = '';
  let body = '';
  let bindings = [];
  if (parts.scriptSrc && !parts.hasInlineScript) {
    prelude = `import __setup from ${JSON.stringify(parts.scriptSrc)};`;
  } else if (parts.hasInlineScript) {
    const split = splitModulePrelude(parts.inlineScript);
    prelude = split.imports.join('\n');
    body = split.body.trim();
    const local = extractSetupBindings(body);
    const imported = split.imports.flatMap(importedBindings);
    bindings = [...new Set([...imported, ...local])];
  }

  const optionalImports = [];
  if (/\bx-(?:get|post|put|patch|delete|boost)\b/.test(parts.template || '')) {
    optionalImports.push(runtime.replace(/sfc\.js$/, 'fetch-directives.js'));
  }
  if (/\bx-(?:text|html|cloak|once|pre|memo|teleport|transition|move|keep-alive)\b|<x-component\b|x-model[.:]|@[^\s"'=]*\.|x-on:[^\s"'=]*\.|(?<!\{)\{(?!\{)/i.test(parts.template || '')) {
    optionalImports.push(runtime.replace(/sfc\.js$/, 'directives-parity.js'));
  }
  if (optionalImports.length) {
    prelude = `${optionalImports.map((spec) => `import ${JSON.stringify(spec)};`).join('\n')}\n${prelude}`;
  }
  const registered = registerHtmlComponents(prelude, runtime);
  prelude = registered.prelude;
  const registerCalls = registered.calls;
  const hmr = options.hmr !== false;
  let signalLocal = null;
  if (hmr && prelude) {
    const rewritten = rewriteSignalImport(prelude);
    prelude = rewritten.prelude;
    signalLocal = rewritten.local;
  }
  const track = hmr && signalLocal
    ? `const ${signalLocal} = (...args) => {\n  const pair = __basedomSignal(...args);\n  const track = globalThis.__BASEDOM_HMR_TRACK__;\n  if (typeof track === 'function') track(pair);\n  return pair;\n};\n`
    : '';
  const param = bindings.includes('props') ? '__props' : 'props';
  const setup = parts.scriptSrc && !parts.hasInlineScript
    ? '__setup'
    : `function __setup(${param}) {\n${track}${body}\n  return { ${bindings.join(', ')} };\n}`;

  const definition = `{
  name: ${JSON.stringify(componentName(filename))},
  template: ${JSON.stringify(parts.template)},
  styles: ${JSON.stringify(parts.styles)},
  setup: ${setup}
}`;

  if (!hmr) {
    return `import { defineSfc } from ${JSON.stringify(runtime)};
${prelude}
${registerCalls}
export default defineSfc(${definition});
`;
  }

  const hmrRuntime = options.hmrRuntime || runtime.replace(/sfc\.js$/, 'hmr-runtime.js');
  const shape = options.meta && options.meta.signals ? options.meta.signals : [];
  const bound = bindRelativeImports(prelude);
  prelude = bound.prelude;
  const localImports = relativeImports(prelude);
  const acceptDeps = bound.accept;

  return `import { defineSfc } from ${JSON.stringify(runtime)};
import { createHotComponent } from ${JSON.stringify(hmrRuntime)};
${prelude}
${registerCalls}
const __setupFn = ${setup};
export const __sfc = {
  id: ${JSON.stringify(filename)},
  name: ${JSON.stringify(componentName(filename))},
  template: ${JSON.stringify(parts.template)},
  styles: ${JSON.stringify(parts.styles)},
  setup: __setupFn,
  setupKey: ${JSON.stringify(hashText(body || parts.scriptSrc || ''))},
  templateKey: ${JSON.stringify(hashText(parts.template))},
  styleKey: ${JSON.stringify(hashText(parts.styles))},
  signalShape: ${JSON.stringify(shape.map((item) => ({ name: item.name })))},
  localImports: ${JSON.stringify(localImports)}
};
let __exported = defineSfc({
  name: __sfc.name,
  template: __sfc.template,
  styles: __sfc.styles,
  setup: __setupFn
});
if (import.meta.hot) {
  __exported = createHotComponent(__sfc);
  import.meta.hot.accept((next) => {
    if (!next || !next.__sfc || typeof __exported.update !== 'function') {
      import.meta.hot.invalidate();
      return;
    }
    try {
      __exported.update(next.__sfc);
    } catch (error) {
      console.error('[BaseDOM BD1022] HMR could not apply the edit.', error);
      import.meta.hot.invalidate();
    }
  });
${acceptDeps}
}
export default __exported;
`;
}

function hashText(text) {
  let hash = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function bindRelativeImports(prelude) {
  let index = 0;
  const accept = [];
  const next = String(prelude || '').replace(/import\s*\{([^}]+)\}\s*from\s*(['"])(\.[^'"]+)\2\s*;?/g, (full, names, quote, spec) => {
    const ns = `__bdDep${index}`;
    index += 1;
    const locals = names.split(',').map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('type ')) return null;
      const alias = trimmed.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) return { imported: alias[1], local: alias[2] };
      const simple = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
      if (!simple) return null;
      return { imported: simple[1], local: simple[1] };
    }).filter(Boolean);
    if (!locals.length) return full;
    const lets = locals.map((item) => `let ${item.local} = ${ns}.${item.imported};`).join('\n');
    const assigns = locals.map((item) => `${item.local} = ns.${item.imported};`).join('\n    ');
    accept.push(`  import.meta.hot.accept(${JSON.stringify(spec)}, (mod) => {
    const ns = mod || ${ns};
    ${assigns}
    globalThis.__BASEDOM_DEP__ = (globalThis.__BASEDOM_DEP__ || 0) + 1;
    try { globalThis.__STEP__ = ${locals[0].local}; } catch (error) { /* binding */ }
    if (__exported && typeof __exported.update === 'function') {
      __exported.update(Object.assign({}, __sfc, { setupKey: __sfc.setupKey + ':' + Date.now() }));
    }
  });`);
    return `import * as ${ns} from ${quote}${spec}${quote};\n${lets}`;
  });
  return { prelude: next, accept: accept.join('\n') };
}

function registerHtmlComponents(prelude, runtime) {
  const registry = runtime.replace(/sfc\.js$/, 'registry.js');
  const calls = [];
  let index = 0;
  const next = String(prelude || '').replace(
    /import\s+(?:([A-Za-z_$][\w$]*)\s+from\s+)?(['"])(\.[^'"]+\.html)\2\s*;?/g,
    (full, local, quote, spec) => {
      const base = spec.split('/').pop().replace(/\.html$/i, '').toLowerCase();
      const binding = local || `__bdView${index++}`;
      calls.push(`registerComponent(${JSON.stringify(base)}, ${binding});`);
      return local ? full : `import ${binding} from ${quote}${spec}${quote};`;
    }
  );
  if (!calls.length) return { prelude: next, calls: '' };
  const already = /\bregisterComponent\b/.test(prelude);
  return {
    prelude: already ? next : `import { registerComponent } from ${JSON.stringify(registry)};\n${next}`,
    calls: `${calls.join('\n')}\n`
  };
}

function relativeImports(prelude) {
  const specs = [];
  for (const match of String(prelude || '').matchAll(/from\s*['"](\.[^'"]+)['"]/g)) specs.push(match[1]);
  return [...new Set(specs)];
}

function rewriteSignalImport(prelude) {
  let local = null;
  const next = String(prelude || '').replace(/import\s*\{([^}]+)\}\s*from\s*(['"][^'"]+['"])/g, (full, names, from) => {
    if (!/state\.js['"]$/.test(from) && !/state\.js'$/.test(from)) {
      if (!/state\.js/.test(from)) return full;
    }
    if (!/\bsignal\b/.test(names)) return full;
    const alias = names.match(/\bsignal\s+as\s+([A-Za-z_$][\w$]*)/);
    local = alias ? alias[1] : 'signal';
    const rewritten = alias
      ? names.replace(/\bsignal\s+as\s+[A-Za-z_$][\w$]*/, 'signal as __basedomSignal')
      : names.replace(/\bsignal\b/, 'signal as __basedomSignal');
    return `import {${rewritten}} from ${from}`;
  });
  return { prelude: next, local };
}
