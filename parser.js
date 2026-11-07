// parser.js
import { Element } from './html.js';
import { computed } from './state.js';
import { _reactive, evaluateExpression } from './expression.js';
import { getComponent } from './registry.js';
import { normalizeAttrValue } from './components.js';

/**
 * Parses text content for {{...}} interpolation.
 * @param {string} text - The text content.
 * @param {object} context - The component's context.
 * @returns {Function|string} A computed signal if interpolation is found, otherwise the static text.
 */
function parseTextNode(text, context) {
  if (!text.includes('{{')) return text;
  const regex = /\{\{(.*?)\}\}/g;
  const parts = [];
  let lastIndex = 0, m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    const expr = m[1].trim();
    parts.push(() => {
      try {
        const v = _reactive(evaluateExpression(expr, context));
        if (v instanceof HTMLElement || v instanceof DocumentFragment) return '';
        if (v == null) return '';
        return v;
      } catch (error) {
        console.error(`Interpolation error: ${expr}`, error);
        return `{{${expr}}}`;
      }
    });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return computed(() => parts.map(part => typeof part === 'function' ? part() : part).join(''));
}

/**
 * Parses an HTML string into a renderable component function.
 * @param {string} htmlText - The raw text of the .html file.
 * @returns {Function} A function that, when called, returns a BaseDOM component.
 */

/**
 * Parses template HTML into DOM nodes and runs directive preprocessors.
 * The nodes are real DOM, cloned per component instance. No virtual nodes.
 * @param {string} template
 * @returns {Node[]}
 */
export function parseTemplateSource(template) {
  const doc = new DOMParser().parseFromString(template || '', 'text/html');
  return preprocessNodes(Array.from(doc.body.childNodes));
}

/**
 * Parses an HTML SFC into a component function.
 * Inline script is not executed. See sfc.js for the trust boundary.
 * @param {string} htmlText
 * @param {object} [options]
 * @returns {Promise<Function>}
 */
export async function parseComponent(htmlText, options = {}) {
  const { parseComponentSource } = await import('./sfc.js');
  return parseComponentSource(htmlText, options);
}

/**
 * Registry for custom directives used in parsing and rendering.
 */
const directiveRegistry = new Map();

/**
 * Registers a directive handler.
 * @param {string} name - The directive name.
 * @param {object} handler - The directive handler object.
 */
export function registerDirective(name, handler) {
    directiveRegistry.set(name, handler);
}

/**
 * Preprocesses nodes using registered directive preprocessors.
 * @param {Array} nodes - Array of DOM nodes.
 * @returns {Array} Processed nodes.
 */
function preprocessNodes(nodes) {
    for (const directive of directiveRegistry.values()) {
        if (typeof directive.preprocess === 'function') nodes = directive.preprocess(nodes);
    }
    return nodes;
}

/**
 * Attaches lifecycle hooks to a parsed element using the unified system.
 * @param {HTMLElement|Function} element - The element or reactive function.
 * @param {object} hooks - Lifecycle hooks.
 * @returns {HTMLElement|Function}
 */
// Inline lifecycle handling by using lifecycle utilities directly where needed.

/**
 * Processes directives on a node with a standardized interface.
 * Handles control flow and attribute directives.
 * @param {Node} node - The DOM node.
 * @param {object} context - The component context.
 * @param {object} parsingContext - Additional parsing context.
 * @returns {Function|object} Returns a function for control flow, or props for attributes.
 */
function processDirectives(node, context, parsingContext) {
    for (const directive of directiveRegistry.values()) {
        if (directive.controlFlow) {
            const result = directive.handle({ node, context, ...parsingContext });
            if (result !== null) return result;
        }
    }
    const props = { attrs: {} };
    for (const directive of directiveRegistry.values()) {
        if (!directive.controlFlow) directive.handle({ node, context, ...parsingContext }, props);
    }
    return props;
}

/**
 * Finds a custom component function by tag name.
 * @param {string} tagName - The tag name to search for.
 * @returns {Function|null} The component function or null.
 */
function findCustomComponent(tagName) {
  let registryNames = [tagName, tagName.toLowerCase()];
  if (tagName.includes('-')) {
    const pascal = tagName.replace(/(^|\-)([a-z])/g, (_, __, c) => c.toUpperCase());
    registryNames.push(pascal);
    registryNames.push(pascal.toLowerCase());
  }
  for (const name of registryNames) {
    const componentFn = getComponent(name) || getComponent(name.toLowerCase());
    if (componentFn) return componentFn;
  }
  return null;
}

/**
 * Parses attributes from a node, handling reactive bindings.
 * @param {Node} node - The DOM node.
 * @param {object} context - The component context.
 * @returns {object} The parsed attributes.
 */
function parseNodeAttributes(node, context) {
  const attrs = {};
  for (const attr of Array.from(node.attributes)) {
    let val = attr.value;
    if (attr.name.startsWith(':')) {
      const propName = attr.name.slice(1);
      // Evaluate the bound expression in the component context (Vue-like).
      // Supports both ":prop="expr"" and ":prop="{{expr}}"" forms.
      const rawExpr = val.trim().replace(/^\{\{|\}\}$/g, '').trim();
      // Live getter. The child reads it in a binding; it is not a virtual prop object.
      val = computed(() => evaluateExpression(rawExpr, context));
      attrs[propName] = val;
    } else {
      attrs[attr.name] = normalizeAttrValue(val);
    }
  }
  return attrs;
}

/**
 * Recursively parses a DOM node into a BaseDOM component.
 * @param {Node} node - The DOM node to parse.
 * @param {object} context - The component context.
 * @param {string|null} componentStyles - Optional scoped CSS styles.
 * @returns {HTMLElement|Function|null} The parsed component or null.
 */
export function parseNode(node, context, componentStyles = null) {
    if (node.nodeType === Node.TEXT_NODE) return parseTextNode(node.textContent, context);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    // Check for custom component tag
    const componentFn = findCustomComponent(node.tagName);
    if (componentFn) {
        const attrs = parseNodeAttributes(node, context);
        const parsingContext = {
            parseNode: (n, ctx) => parseNode(n, ctx || context),
            componentStyles
        };
        const directiveResult = processDirectives(node, context, parsingContext);
        if (typeof directiveResult === 'function' || directiveResult instanceof Node) return directiveResult;
        if (directiveResult && typeof directiveResult === 'object') {
            Object.assign(attrs, directiveResult.attrs || {});
            for (const k of Object.keys(directiveResult)) {
                if (k !== 'attrs') attrs[k] = directiveResult[k];
            }
        }
        const children = Array.from(node.childNodes).map(child => parseNode(child, attrs)).filter(child => child !== null && child !== undefined);
        attrs.children = children;
        if (componentStyles) attrs.styles = componentStyles;
        return componentFn(attrs);
    }

    // Normal element
    const parsingContext = {
        parseNode: (n, ctx) => parseNode(n, ctx || context),
        componentStyles
    };
    const directiveResult = processDirectives(node, context, parsingContext);
    // Control-flow directives return a function or real DOM (x-for anchors).
    // They are not a props object and they are not virtual nodes.
    if (typeof directiveResult === 'function' || directiveResult instanceof Node) {
        return directiveResult;
    }
    const props = directiveResult || { attrs: {} };
    if (componentStyles) props.styles = componentStyles;
    const children = Array.from(node.childNodes).map(child => parseNode(child, context)).filter(Boolean);
    return Element(node.tagName.toLowerCase())({ ...props, children });
}