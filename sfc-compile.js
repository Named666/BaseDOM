// sfc-compile.js
// Turns an author-written .html SFC into a JavaScript module string.
// Used by the Vite plugin. The runtime does not eval this source.
// No virtual DOM is generated; the module calls defineSfc().

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
    throw new Error(`Only <script setup> can be compiled inline. ${INLINE_SCRIPT_HINT}`);
  }
  if (parts.scriptSrc && parts.hasInlineScript) {
    throw new Error('Use either <script setup src> or an inline <script setup>, not both.');
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

  const setup = parts.scriptSrc && !parts.hasInlineScript
    ? '__setup'
    : `function __setup(props) {\n${body}\n  return { ${bindings.join(', ')} };\n}`;

  return `import { defineSfc } from ${JSON.stringify(runtime)};
${prelude}

export default defineSfc({
  name: ${JSON.stringify(componentName(filename))},
  template: ${JSON.stringify(parts.template)},
  styles: ${JSON.stringify(parts.styles)},
  setup: ${setup}
});
`;
}
