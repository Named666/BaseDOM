// parser.js
import { Element } from './html.js';
import { signal, effect, computed } from './state.js';
import { ExpressionParser, expressionParser, _reactive, evaluateExpression } from './expression.js';


// --- Core Parsing Logic ---

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
        let lastProps = null;
        
        return (props) => {
            // Only recreate context if props actually changed or this is first run
            if (!cachedContext || JSON.stringify(props) !== JSON.stringify(lastProps)) {
                cachedContext = componentLogicFn(props || {});
                lastProps = props;
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

// Register a directive handler
export function registerDirective(name, handler) {
    directiveRegistry.set(name, handler);
}


// Built-in directives registration
registerDirective('x-if', (node, context, props, fetchConfig) => {
    const ifDirective = node.getAttribute('x-if');
    if (ifDirective) {
        let elseNode = null;
        // Find the corresponding x-else node by traversing siblings
        let sibling = node.nextSibling;
        while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE && sibling.hasAttribute('x-else')) {
                elseNode = sibling;
                break;
            } else if (sibling.nodeType === Node.ELEMENT_NODE) {
                // Found another element that's not x-else, stop looking
                break;
            }
            sibling = sibling.nextSibling;
        }
        return handleIfElseDirective(node, ifDirective, elseNode, context);
    }
    return null;
});

registerDirective('x-for', (node, context, props, fetchConfig) => {
    const forDirective = node.getAttribute('x-for');
    if (forDirective) return handleForDirective(node, forDirective, context);
    return null;
});

registerDirective('x-on', (node, context, props) => {
    for (const attr of node.attributes) {
        if (attr.name.startsWith('x-on:')) {
            const eventName = attr.name.substring(5);
            const handlerExpr = attr.value;
            // Support both function references and function calls
            props[`on${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`] = (event) => {
                // Add event and common event properties to context
                const eventContext = {
                    ...context,
                    $event: event,
                    $target: event.target,
                    $currentTarget: event.currentTarget
                };
                // Check if it's a simple function reference or a call expression
                if (handlerExpr.includes('(')) {
                    // Function call expression like "toggle(item)" or "handleClick($event)"
                    evaluateExpression(handlerExpr, eventContext);
                } else {
                    // Simple function reference like "toggle"
                    const handler = evaluateExpression(handlerExpr, eventContext);
                    if (typeof handler === 'function') {
                        handler(event);
                    }
                }
            };
        }
    }
});

registerDirective('x-bind', (node, context, props) => {
    for (const attr of node.attributes) {
        if (attr.name.startsWith('x-bind:')) {
            const propName = attr.name.substring(7);
            const expr = attr.value;
            props[propName] = computed(() => {
                return evaluateExpression(expr, context);
            });
        }
    }
});

registerDirective('x-show', (node, context, props) => {
    for (const attr of node.attributes) {
        if (attr.name === 'x-show') {
            const showExpr = attr.value;
            if (!props.style) props.style = {};
            props.style.display = computed(() => {
                const shouldShow = evaluateExpression(showExpr, context);
                return shouldShow ? '' : 'none';
            });
        }
    }
});

registerDirective('x-model', (node, context, props) => {
    for (const attr of node.attributes) {
        if (attr.name === 'x-model') {
            const modelExpr = attr.value.trim();
            // Find the signal in context
            const signal = context[modelExpr];
            if (signal && typeof signal === 'function') {
                // Two-way binding for input elements
                const tagName = node.tagName.toLowerCase();
                if (tagName === 'input' || tagName === 'textarea') {
                    // Set initial value
                    props.attrs.value = computed(() => signal());
                    // Handle input events for two-way binding
                    const inputHandler = (event) => {
                        const newValue = event.target.value;
                        // Assuming signals have a setter when called with a value
                        if (signal.set) {
                            signal.set(newValue);
                        } else {
                            // Try to call as setter
                            signal(newValue);
                        }
                    };
                    props.onInput = inputHandler;
                    props.onChange = inputHandler;
                } else if (tagName === 'select') {
                    props.attrs.value = computed(() => signal());
                    props.onChange = (event) => {
                        const newValue = event.target.value;
                        if (signal.set) {
                            signal.set(newValue);
                        } else {
                            signal(newValue);
                        }
                    };
                } else if (node.getAttribute('type') === 'checkbox') {
                    props.attrs.checked = computed(() => signal());
                    props.onChange = (event) => {
                        const newValue = event.target.checked;
                        if (signal.set) {
                            signal.set(newValue);
                        } else {
                            signal(newValue);
                        }
                    };
                }
            }
        }
    }
});

// Register each fetch attribute as its own directive
const fetchAttrs = [
    'x-get', 'x-post', 'x-swap', 'x-select', 'x-trigger',
    'x-push-url', 'x-replace-url', 'x-target'
];

fetchAttrs.forEach(attr => {
    registerDirective(attr, (node, context, props, fetchConfig) => {
        if (node.hasAttribute(attr)) {
            fetchConfig[attr] = node.getAttribute(attr);
            props.attrs[attr] = node.getAttribute(attr);
        }
    });
});

registerDirective('default', (node, context, props) => {
    for (const attr of node.attributes) {
        if (
            !attr.name.startsWith('x-on:') &&
            !attr.name.startsWith('x-bind:') &&
            attr.name !== 'x-show' &&
            attr.name !== 'x-model' &&
            !fetchAttrs.includes(attr.name)
        ) {
            props.attrs[attr.name] = attr.value;
        }
    }
});

// --- Unified Node Parsing ---

function parseNode(node, context, componentStyles = null) {
    if (node.nodeType === Node.TEXT_NODE) {
        return parseTextNode(node.textContent, context);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    
    // Skip x-else nodes - they should only be processed by their x-if
    if (node.hasAttribute && node.hasAttribute('x-else')) {
        return null;
    }

    // Control flow directives (return early if handled)
    for (const key of ['x-if', 'x-for']) {
        if (node.hasAttribute(key) && directiveRegistry.has(key)) {
            const result = directiveRegistry.get(key)(node, context, {}, {});
            if (result !== null) return result;
        }
    }

    const tagName = node.tagName.toLowerCase();
    const props = { attrs: {} };
    const children = [];
    const fetchConfig = {};

    // Add component styles to the root element if this is the first element being parsed
    if (componentStyles) {
        props.styles = componentStyles;
    }

    // Attribute/event/fetch directives
    for (const [name, handler] of directiveRegistry.entries()) {
        if (name === 'x-if' || name === 'x-for' || name === 'default') continue;
        handler(node, context, props, fetchConfig);
    }
    directiveRegistry.get('default')(node, context, props);

    // Process child nodes, skipping x-else that are paired with x-if
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        
        // Skip x-else nodes that are paired with x-if
        if (
            child.nodeType === Node.ELEMENT_NODE &&
            child.hasAttribute &&
            child.hasAttribute('x-else')
        ) {
            // Look backwards for a x-if sibling
            let foundPairedIf = false;
            for (let j = i - 1; j >= 0; j--) {
                const prevSibling = node.childNodes[j];
                if (prevSibling.nodeType === Node.ELEMENT_NODE) {
                    if (prevSibling.hasAttribute && prevSibling.hasAttribute('x-if')) {
                        foundPairedIf = true;
                    }
                    break; // Stop at first element node
                }
            }
            if (foundPairedIf) {
                continue; // Skip this x-else
            }
        }
        
        const parsedChild = parseNode(child, context);
        if (parsedChild) children.push(parsedChild);
    }

    function handleFetchTriggerBehavior(el) {
        const method = fetchConfig['x-post'] ? 'POST' : 'GET';
        const url = fetchConfig['x-get'] || fetchConfig['x-post'];
        if (!url) return;
        
        let trigger = fetchConfig['x-trigger'] || '';
        if (!trigger) {
            trigger = (tagName === 'form' && method === 'POST') ? 'submit' : 'click';
        }
        
        const handleEvent = async (evt) => {
            if (tagName === 'form' && method === 'POST') {
                evt.preventDefault();
            }
            
            try {
                let fetchOpts = { method };
                if (method === 'POST' && tagName === 'form') {
                    fetchOpts.body = new FormData(el);
                }
                
                const resp = await fetch(url, fetchOpts);
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                }
                
                let html = await resp.text();
                
                // Handle content selection
                if (fetchConfig['x-select']) {
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const sel = temp.querySelector(fetchConfig['x-select']);
                    if (sel) {
                        const swapMode = (fetchConfig['x-swap'] || '').toLowerCase();
                        if (swapMode === 'innerhtml') {
                            html = sel.innerHTML;
                        } else {
                            html = sel.outerHTML;
                        }
                    }
                }
                
                // Determine target element
                let target = el;
                if (fetchConfig['x-target']) {
                    const targetEl = document.querySelector(fetchConfig['x-target']);
                    if (targetEl) target = targetEl;
                }
                
                // Apply the swap strategy
                const swap = (fetchConfig['x-swap'] || 'innerHTML').toLowerCase();
                if (swap === 'outerhtml') {
                    target.outerHTML = html;
                } else if (swap === 'append' || swap === 'beforeend') {
                    target.insertAdjacentHTML('beforeend', html);
                } else if (swap === 'prepend' || swap === 'afterbegin') {
                    target.insertAdjacentHTML('afterbegin', html);
                } else if (swap === 'beforebegin') {
                    target.insertAdjacentHTML('beforebegin', html);
                } else if (swap === 'afterend') {
                    target.insertAdjacentHTML('afterend', html);
                } else {
                    target.innerHTML = html;
                }
                
                // Handle URL updates
                if (fetchConfig['x-push-url'] === 'true') {
                    history.pushState({}, '', url);
                } else if (fetchConfig['x-replace-url'] === 'true') {
                    history.replaceState({}, '', url);
                }
            } catch (error) {
                console.error('Fetch trigger error:', error);
                // Optionally show error to user
            }
        };
        
        el.addEventListener(trigger, handleEvent);
    }

    const componentFactory = Element(tagName);
    const baseComponent = componentFactory({ ...props, children });

    if (Object.keys(fetchConfig).length > 0) {
        return (el) => {
            const result = typeof baseComponent === 'function' ? baseComponent(el) : baseComponent;
            if (el && el.addEventListener) {
                handleFetchTriggerBehavior(el);
            }
            return result;
        };
    }
    return baseComponent;
}

/**
 * Handles the `x-if` and `x-else` directives for conditional rendering.
 * @param {Node} ifNode - The node with the x-if attribute.
 * @param {string} condition - The condition to evaluate from the context.
 * @param {Node|null} elseNode - The node with the x-else attribute (if present).
 * @param {object} context - The component's context.
 * @returns {Function} A function that returns the if or else component or null.
 */
function handleIfElseDirective(ifNode, condition, elseNode, context) {
    ifNode.removeAttribute('x-if');
    if (elseNode) elseNode.removeAttribute('x-else');

    return computed(() => {
        const shouldShow = evaluateExpression(condition, context);
        
        if (shouldShow) {
            return parseNode(ifNode, context);
        } else if (elseNode) {
            return parseNode(elseNode, context);
        }
        return null;
    });
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

// --- Directive Implementations ---



/**
 * Handles the `x-for` directive for list rendering.
 * @param {Node} node - The node with the x-for attribute.
 * @param {string} expression - The "item in items" expression.
 * @param {object} context - The component's context.
 * @returns {Function} A function that returns an array of components.
 */
function handleForDirective(node, expression, context) {
    node.removeAttribute('x-for'); // Avoid reprocessing
    
    // Parse the for expression - support "item in items" and "item, index in items"
    const forMatch = expression.match(/^(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
    if (!forMatch) {
        console.warn(`Invalid x-for expression: ${expression}`);
        return () => [];
    }
    
    const [, itemName, indexName, listExpr] = forMatch;
    
    // Return a function that reactively returns the list of components
    return computed(() => {
        const items = evaluateExpression(listExpr.trim(), context);
        let itemsArray = _reactive(items);
        
        if (!Array.isArray(itemsArray)) {
            return [];
        }

        return itemsArray.map((item, index) => {
            // For each item, create a new context that includes the loop variables
            const loopContext = {
                ...context,
                [itemName]: () => item, // Make the item available as a "signal"
            };
            
            // Add index if specified
            if (indexName) {
                loopContext[indexName] = () => index;
            } else {
                // Default index name
                loopContext[`${itemName}Index`] = () => index;
            }
            
            return parseNode(node.cloneNode(true), loopContext);
        });
    });
}