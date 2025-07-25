// parser.js
import { Element } from './html.js';
import { computed } from './state.js';
import { _reactive, evaluateExpression } from './expression.js';
import { attachLifecycleHooks, wrapReactiveElement } from './lifecycle.js';
import { getComponent } from './registry.js';

/**
 * Parses text content for {{...}} interpolation.
 * @param {string} text - The text content.
 * @param {object} context - The component's context.
 * @returns {Function|string} A computed signal if interpolation is found, otherwise the static text.
 */
function parseTextNode(text, context) {
    if (!text.includes('{{')) return text;
    const regex = /\{\{(.*?)\}\}/g;
    const match = text.trim().match(/^\{\{(.*)\}\}$/);
    if (match) {
        const expr = match[1].trim();
        return () => _reactive(evaluateExpression(expr, context));
    }
    const parts = [];
    let lastIndex = 0, m;
    while ((m = regex.exec(text)) !== null) {
        if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
        const expr = m[1].trim();
        parts.push(() => {
            const v = _reactive(evaluateExpression(expr, context));
            return (v instanceof HTMLElement || v instanceof DocumentFragment) ? '' : (v !== undefined ? v : `{{${expr}}}`);
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

export async function parseComponent(htmlText) {
    try {
        const { template, script, styles } = extractParts(htmlText);
        let finalScript = script;
        // Detect <script setup> mode
        const setupMatch = htmlText.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/i);
        if (setupMatch) {
            // Compose a default export function that exposes all top-level variables/signals
            let setupCode = setupMatch[1];
            // Indent all lines by 2 spaces for function body, but preserve empty lines
            setupCode = setupCode.split('\n').map(line => line.trim() === '' ? '' : '  ' + line).join('\n');
            // Enhanced: Extract all identifiers from top-level declarations, including destructuring
            const identifiers = [];
            // Match top-level const/let/var declarations (no leading whitespace)
            const declRegex = /^(?:const|let|var)\s+([^=;]+)/gm;
            let m;
            while ((m = declRegex.exec(setupMatch[1])) !== null) {
                const lhs = m[1].trim();
                // Remove trailing comma if present
                const cleanLhs = lhs.replace(/,$/, '');
                // If destructured array: [a, b, ...]
                if (cleanLhs.startsWith('[')) {
                    // Remove brackets and split by comma
                    const arr = cleanLhs.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
                    for (const v of arr) {
                        // Remove default assignment (a = 1)
                        const name = v.split('=')[0].trim();
                        if (name) identifiers.push(name);
                    }
                } else if (cleanLhs.startsWith('{')) {
                    // Remove braces and split by comma
                    const arr = cleanLhs.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
                    for (const v of arr) {
                        // Handle renaming: x: y, or default assignment: y = 1
                        let name = v;
                        if (v.includes(':')) name = v.split(':')[1].trim();
                        if (name.includes('=')) name = name.split('=')[0].trim();
                        if (name) identifiers.push(name);
                    }
                } else {
                    // Simple identifier(s), could be multiple (e.g., let a, b)
                    const vars = cleanLhs.split(',').map(s => s.trim());
                    for (const v of vars) {
                        if (v) identifiers.push(v);
                    }
                }
            }
            // Also match top-level function and class declarations
            const fnClassRegex = /^(?:function|class)\s+([\w$]+)/gm;
            while ((m = fnClassRegex.exec(setupMatch[1])) !== null) {
                identifiers.push(m[1]);
            }
            // Compose the new script: wrap setup code inside export default function
            finalScript = `\nexport default function(props, ctx) {\n${setupCode}\n  return { ${identifiers.join(', ')} };\n}`;
            console.log(finalScript);
        }
        const componentModule = await import(`data:text/javascript,${encodeURIComponent(finalScript)}`);
        const componentLogicFn = componentModule.default;
        if (typeof componentLogicFn !== 'function') throw new Error('Component script must export a default function');
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(template, 'text/html');
        let nodes = Array.from(doc.body.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE);
        nodes = preprocessNodes(nodes);
        let cachedContext = null;
        return (props) => {
            const currentProps = props || {};
            if (!cachedContext || currentProps !== cachedContext.__lastProps) {
                cachedContext = componentLogicFn(currentProps);
                cachedContext.__lastProps = currentProps;
            }
            const { onMount, onUnmount, onUpdate, ...otherContext } = cachedContext;
            const lifecycleHooks = { onMount, onUnmount, onUpdate };
            if (nodes.length === 1) {
                const element = parseNode(nodes[0], otherContext, styles);
                return attachLifecycleHooksToElement(element, lifecycleHooks);
            } else if (nodes.length > 1) {
                const children = nodes.map(n => parseNode(n, otherContext)).filter(Boolean);
                return Element('div')({ children, ...(styles && { styles }), ...lifecycleHooks });
            } else {
                return Element('div')({ children: 'No content', ...(styles && { styles }), ...lifecycleHooks });
            }
        };
    } catch (error) {
        return () => Element('div')({
            style: { color: 'red', border: '1px solid red', padding: '10px' },
            children: [Element('h3')('Component Parse Error'), Element('pre')(error.message)]
        });
    }
}

/**
 * Extracts the <template>, <script>, and <style> parts from the component file.
 * @param {string} htmlText - The raw text of the .html file.
 * @returns {{template: string, script: string, styles: string}}
 */
function extractParts(htmlText) {
    htmlText = htmlText.replace(/\r\n?/g, '\n');
    const templateMatch = htmlText.match(/<template>([\s\S]*?)<\/template>/i);
    const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/i);
    const styleMatch = htmlText.match(/<style>([\s\S]*?)<\/style>/i);
    let template = '', script = '', styles = '';
    if (templateMatch) {
        template = templateMatch[1].trim();
        if (scriptMatch) script = scriptMatch[1].trim();
        if (styleMatch) styles = styleMatch[1].trim();
    } else if (scriptMatch) {
        const scriptStart = scriptMatch.index;
        template = htmlText.slice(0, scriptStart).trim();
        script = scriptMatch[1].trim();
        if (styleMatch) styles = styleMatch[1].trim();
    } else {
        template = htmlText.trim();
        script = 'export default function(props) { return {}; }';
        if (styleMatch) {
            styles = styleMatch[1].trim();
            template = template.replace(/<style>[\s\S]*?<\/style>/i, '').trim();
        }
    }
    if (!template) template = '<div>Template not found</div>';
    return { template, script, styles };
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
function attachLifecycleHooksToElement(element, { onMount, onUnmount, onUpdate }) {
    if (typeof element === 'function') return wrapReactiveElement(element, { onMount, onUnmount, onUpdate });
    if (element instanceof HTMLElement) return attachLifecycleHooks(element, { onMount, onUnmount, onUpdate });
    return element;
}

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
 * Recursively parses a DOM node into a BaseDOM component.
 * @param {Node} node - The DOM node to parse.
 * @param {object} context - The component context.
 * @param {string|null} componentStyles - Optional scoped CSS styles.
 * @returns {HTMLElement|Function|null} The parsed component or null.
 */
export function parseNode(node, context, componentStyles = null) {
    if (node.nodeType === Node.TEXT_NODE) return parseTextNode(node.textContent, context);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    // Slot handling: if <slot>, return children from context
    if (node.tagName && node.tagName.toLowerCase() === 'slot') {
        // Return children from context, or empty string if not present
        return context && context.children !== undefined ? context.children : '';
    }

    // Check for custom component tag (PascalCase or kebab-case, registered)
    let tagName = node.tagName;
    // Support both PascalCase and kebab-case (e.g., UserProfile, user-profile)
    let registryNames = [tagName, tagName.toLowerCase()];
    if (tagName.includes('-')) {
        // Convert kebab-case to PascalCase for registry lookup
        const pascal = tagName.replace(/(^|\-)([a-z])/g, (_, __, c) => c.toUpperCase());
        registryNames.push(pascal);
        registryNames.push(pascal.toLowerCase());
    }
    // Try all registry names case-insensitively
    let componentFn = null;
    for (const name of registryNames) {
        componentFn = getComponent(name) || getComponent(name.toLowerCase());
        if (componentFn) break;
    }
    if (componentFn) {
        // Gather props from attributes
        const attrs = {};
        for (const attr of Array.from(node.attributes)) {
            let val = attr.value;
            // Support Vue-style :prop="{{ expr }}"
            if (attr.name.startsWith(':')) {
                const propName = attr.name.slice(1);
                if (/^\{\{.*\}\}$/.test(val.trim())) {
                    // Interpolated expression
                    val = (() => _reactive(evaluateExpression(val.trim().slice(2, -2), context)));
                }
                attrs[propName] = val;
            }
        }
        // Merge props from directives (attribute directives)
        const parsingContext = {
            parseNode: (n, ctx) => parseNode(n, ctx || context),
            componentStyles
        };
        const directiveResult = processDirectives(node, context, parsingContext);
        if (directiveResult && typeof directiveResult === 'object') {
            // Merge directive props into attrs
            Object.assign(attrs, directiveResult.attrs || {});
            // Merge event handlers and other props
            for (const k of Object.keys(directiveResult)) {
                if (k !== 'attrs') attrs[k] = directiveResult[k];
            }
        }
        // Children as slot (if any)
        const children = Array.from(node.childNodes).map(child => parseNode(child, context)).filter(child => child !== null && child !== undefined);
        // Always pass children as array, even if single child
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
    if (typeof directiveResult === 'function') return directiveResult;
    const props = directiveResult || { attrs: {} };
    if (componentStyles) props.styles = componentStyles;
    const children = Array.from(node.childNodes).map(child => parseNode(child, context)).filter(Boolean);
    return Element(node.tagName.toLowerCase())({ ...props, children });
}