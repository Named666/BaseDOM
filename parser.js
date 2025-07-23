// parser.js
import { Element } from './html.js';
import { signal, effect, computed } from './state.js';
import { ExpressionParser, expressionParser, _reactive, evaluateExpression } from './expression.js';
import { 
    xIfDirective, 
    xForDirective, 
    xOnDirective, 
    xBindDirective, 
    xShowDirective, 
    xModelDirective, 
    xFetchDirective, 
    defaultDirective 
} from './directives.js';


// --- Core Parsing Logic ---

// Development mode flag
const DEV_MODE = !import.meta.env?.PROD && globalThis.location?.hostname === 'localhost';

function devWarn(message, node) {
    if (DEV_MODE) {
        console.warn(`[BaseDOM]: ${message}`, node);
    }
}

/**
 * Parses text content for {{...}} interpolation.
 * @param {string} text - The text content.
 * @param {object} context - The component's context.
 * @returns {Function|string} A computed signal if interpolation is found, otherwise the static text.
 */
function parseTextNode(text, context) {
    if (!text.includes('{{')) {
        return text;
    }
    const regex = /\{\{(.*?)\}\}/g;
    const match = text.trim().match(/^\{\{(.*)\}\}$/);

    // If the text is *only* an interpolation, e.g. "{{ user.name || 'Anonymous' }}"
    if (match) {
        const expr = match[1].trim();
        return () => {
            const result = evaluateExpression(expr, context);
            // Handle reactive values
            return _reactive(result);
        };
    }

    // Otherwise, handle mixed text and interpolations
    const parts = [];
    let lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
        if (m.index > lastIndex) {
            parts.push(text.slice(lastIndex, m.index));
        }
        const expr = m[1].trim();
        parts.push(() => {
            const value = evaluateExpression(expr, context);
            const reactiveValue = _reactive(value);
            
            // Avoid rendering objects as strings in mixed content
            if (reactiveValue instanceof HTMLElement || reactiveValue instanceof DocumentFragment) {
                console.warn(`Cannot render HTML element inside mixed text content for expression: {{${expr}}}. Returning empty string.`);
                return '';
            }
            return reactiveValue !== undefined ? reactiveValue : `{{${expr}}}`;
        });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
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
        // Dynamically import the component's logic
        const componentModule = await import(`data:text/javascript,${encodeURIComponent(script)}`);
        const componentLogicFn = componentModule.default;
        console.log('Parsed component logic:', componentLogicFn);
        console.log('Parsed template:', template);
        console.log('Parsed styles:', styles);
        // Validate that the component logic is a function
        if (typeof componentLogicFn !== 'function') {
            throw new Error('Component script must export a default function');
        }

        // Create a DOM tree from the template
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(template, 'text/html');
        // Support multiple root nodes (fragment) for DSL style
        let nodes = Array.from(doc.body.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE);
        
        // Filter out x-else nodes that are paired with x-if nodes
        nodes = nodes.filter((node, index) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute && node.hasAttribute('x-else')) {
                // Look for a previous x-if sibling (skipping text nodes)
                for (let i = index - 1; i >= 0; i--) {
                    const prevNode = nodes[i];
                    if (prevNode.nodeType === Node.ELEMENT_NODE && prevNode.hasAttribute && prevNode.hasAttribute('x-if')) {
                        return false; // Skip this x-else, it's paired with x-if
                    }
                    if (prevNode.nodeType === Node.ELEMENT_NODE) {
                        break; // Found a non-x-if element, stop looking
                    }
                }
            }
            return true;
        });

        // Cache component instances to prevent signal re-creation
        let cachedContext = null;
        let propsVersion = 0;
        
        return (props) => {
            // Simple versioning approach - only recreate if props reference changes
            const currentProps = props || {};
            if (!cachedContext || currentProps !== cachedContext.__lastProps) {
                cachedContext = componentLogicFn(currentProps);
                cachedContext.__lastProps = currentProps;
            }
            const context = cachedContext;
            
            if (nodes.length === 1) {
                // Single root node - apply styles to it
                return parseNode(nodes[0], context, styles);
            } else if (nodes.length > 1) {
                // Multiple root nodes - wrap in a fragment with styles applied to wrapper
                const children = nodes.map(n => parseNode(n, context)).filter(Boolean);
                const wrapperOptions = { children };
                if (styles) {
                    wrapperOptions.styles = styles;
                }
                return Element('div')(wrapperOptions);
            } else {
                // No nodes found
                const noContentOptions = { children: 'No content' };
                if (styles) {
                    noContentOptions.styles = styles;
                }
                return Element('div')(noContentOptions);
            }
        };
    } catch (error) {
        console.error('Error parsing component:', error);
        // Return a component that displays the error
        return () => Element('div')({
            style: { color: 'red', border: '1px solid red', padding: '10px' },
            children: [
                Element('h3')('Component Parse Error'),
                Element('pre')(error.message)
            ]
        });
    }
}

/**
 * Extracts the <template>, <script>, and <style> parts from the component file.
 * @param {string} htmlText - The raw text of the .html file.
 * @returns {{template: string, script: string, styles: string}}
 */
function extractParts(htmlText) {
    // Normalize line endings
    htmlText = htmlText.replace(/\r\n?/g, '\n');
    // Find <template>, <script>, and <style> tags (case-insensitive)
    const templateMatch = htmlText.match(/<template>([\s\S]*?)<\/template>/i);
    const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/i);
    const styleMatch = htmlText.match(/<style>([\s\S]*?)<\/style>/i);

    let template = '';
    let script = '';
    let styles = '';

    if (templateMatch) {
        // SFC style: <template>...</template><script>...</script><style>...</style>
        template = templateMatch[1].trim();
        if (scriptMatch) {
            script = scriptMatch[1].trim();
        }
        if (styleMatch) {
            styles = styleMatch[1].trim();
        }
    } else if (scriptMatch) {
        // DSL style: everything before <script> is template
        const scriptStart = scriptMatch.index;
        template = htmlText.slice(0, scriptStart).trim();
        script = scriptMatch[1].trim();
        // Still check for styles in DSL mode
        if (styleMatch) {
            styles = styleMatch[1].trim();
        }
    } else {
        // No script tag, treat all as template (but still check for styles)
        template = htmlText.trim();
        script = 'export default function(props) { return {}; }';
        if (styleMatch) {
            styles = styleMatch[1].trim();
            // Remove the <style> block from template since we extracted it
            template = template.replace(/<style>[\s\S]*?<\/style>/i, '').trim();
        }
    }

    // If template is empty, fallback
    if (!template) template = '<div>Template not found</div>';

    return { template, script, styles };
}

// --- Node Parsing and Directive Handling ---




// --- Modular Directive Registry ---

const directiveRegistry = new Map();

// Register a directive handler with type information
export function registerDirective(name, handler) {
    directiveRegistry.set(name, handler);
}

// Process directives on a node with a standardized interface
function processDirectives(node, context, parsingContext) {
    // Control flow directives get first priority and can return early
    for (const [name, directive] of directiveRegistry) {
        if (directive.controlFlow && node.hasAttribute && node.hasAttribute(name)) {
            const result = directive.handle({ node, context, ...parsingContext });
            if (result !== null) return result;
        }
    }

    // If no control flow directive handled the node, process attribute directives
    const props = { attrs: {} };
    
    // Pre-scan to find relevant attribute directives
    const nodeAttributes = Array.from(node.attributes || []);
    const relevantDirectives = new Set();
    
    nodeAttributes.forEach(attr => {
        // Direct matches
        if (directiveRegistry.has(attr.name)) {
            const directive = directiveRegistry.get(attr.name);
            if (!directive.controlFlow) {
                relevantDirectives.add(attr.name);
            }
        }
        
        // Check for prefixed directives
        for (const [name, directive] of directiveRegistry) {
            if (!directive.controlFlow && attr.name.startsWith(name + ':')) {
                relevantDirectives.add(name);
            }
        }
    });
    
    // Process all relevant attribute directives
    relevantDirectives.forEach(name => {
        const directive = directiveRegistry.get(name);
        if (directive && !directive.controlFlow) {
            directive.handle({ node, context, ...parsingContext }, props);
        }
    });
    
    // Always process default directive for remaining attributes
    const defaultDirective = directiveRegistry.get('default');
    if (defaultDirective) {
        defaultDirective.handle({ node, context, ...parsingContext }, props);
    }
    
    return props;
}

// Register built-in directives
registerDirective('x-if', xIfDirective);
registerDirective('x-for', xForDirective);
registerDirective('x-on', xOnDirective);
registerDirective('x-bind', xBindDirective);
registerDirective('x-show', xShowDirective);
registerDirective('x-model', xModelDirective);
registerDirective('x-get', xFetchDirective);
registerDirective('x-post', xFetchDirective);
registerDirective('default', defaultDirective);

// --- Unified Node Parsing ---

function parseNode(node, context, componentStyles = null) {
    if (node.nodeType === Node.TEXT_NODE) {
        return parseTextNode(node.textContent, context);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    
    // Create parsing context that directives can use
    const parsingContext = {
        parseNode: (n, ctx) => parseNode(n, ctx || context),
        componentStyles
    };
    
    // Process directives - they handle control flow and attribute processing
    const directiveResult = processDirectives(node, context, parsingContext);
    
    // If a control flow directive handled the node, return its result
    if (directiveResult && typeof directiveResult === 'function') {
        return directiveResult;
    }
    
    // Otherwise, build a regular element using the props from attribute directives
    const props = directiveResult || { attrs: {} };
    const children = [];
    const tagName = node.tagName.toLowerCase();

    // Add component styles to the root element if this is the first element being parsed
    if (componentStyles) {
        props.styles = componentStyles;
    }

    // Process child nodes
    const childNodes = Array.from(node.childNodes);
    for (const child of childNodes) {
        const parsedChild = parseNode(child, context);
        if (parsedChild) children.push(parsedChild);
    }

    const componentFactory = Element(tagName);
    return componentFactory({ ...props, children });
}