// parser.js
import { Element } from './html.js';
import { signal, effect, computed } from './state.js';

// --- Core Parsing Logic ---

/**
 * Parses an HTML string into a renderable component function.
 * @param {string} htmlText - The raw text of the .html file.
 * @returns {Function} A function that, when called, returns a BaseDOM component.
 */
export async function parseComponent(htmlText) {
    try {
        const { template, script } = extractParts(htmlText);
        // Dynamically import the component's logic
        const componentModule = await import(`data:text/javascript,${encodeURIComponent(script)}`);
        const componentLogicFn = componentModule.default;

        // Validate that the component logic is a function
        if (typeof componentLogicFn !== 'function') {
            throw new Error('Component script must export a default function');
        }

        // Create a DOM tree from the template
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(template, 'text/html');
        // Support multiple root nodes (fragment) for DSL style
        const nodes = Array.from(doc.body.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE);

        return (props) => {
            const context = componentLogicFn(props || {});
            
            if (nodes.length === 1) {
                // Single root node
                return parseNode(nodes[0], context);
            } else if (nodes.length > 1) {
                // Multiple root nodes - wrap in a fragment
                const children = nodes.map(n => parseNode(n, context)).filter(Boolean);
                return Element('div')({ children });
            } else {
                // No nodes found
                return Element('div')({ children: 'No content' });
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
 * Extracts the <template> and <script> parts from the component file.
 * @param {string} htmlText - The raw text of the .html file.
 * @returns {{template: string, script: string}}
 */
function extractParts(htmlText) {
    // Normalize line endings
    htmlText = htmlText.replace(/\r\n?/g, '\n');
    // Find <template> and <script> tags (case-insensitive)
    const templateMatch = htmlText.match(/<template>([\s\S]*?)<\/template>/i);
    const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/i);

    let template = '';
    let script = '';

    if (templateMatch) {
        // SFC style: <template>...</template><script>...</script>
        template = templateMatch[1].trim();
        if (scriptMatch) {
            script = scriptMatch[1].trim();
        }
    } else if (scriptMatch) {
        // DSL style: everything before <script> is template
        const scriptStart = scriptMatch.index;
        template = htmlText.slice(0, scriptStart).trim();
        script = scriptMatch[1].trim();
    } else {
        // No script tag, treat all as template
        template = htmlText.trim();
        script = 'export default function(props) { return {}; }';
    }

    // If template is empty, fallback
    if (!template) template = '<div>Template not found</div>';

    return { template, script };
}

// --- Node Parsing and Directive Handling ---


// --- Special fetch/trigger directive attributes ---
const FETCH_TRIGGER_ATTRS = [
    'bd-get', 'bd-post', 'bd-swap', 'bd-select', 'bd-trigger', 'bd-push-url', 'bd-replace-url', 'bd-target'
];


// --- Directive Handlers Registry ---
const directiveHandlers = {
    // Control flow
    'bd-if': (node, context) => {
        const ifDirective = node.getAttribute('bd-if');
        if (ifDirective) {
            let elseNode = null;
            let nextSibling = node.nextElementSibling;
            
            // Skip text nodes and comments to find the next element
            while (nextSibling && nextSibling.nodeType !== Node.ELEMENT_NODE) {
                nextSibling = nextSibling.nextElementSibling;
            }
            
            if (nextSibling && nextSibling.hasAttribute('bd-else')) {
                elseNode = nextSibling;
            }
            
            return handleIfElseDirective(node, ifDirective, elseNode, context);
        }
        return null;
    },
    'bd-for': (node, context) => {
        const forDirective = node.getAttribute('bd-for');
        if (forDirective) return handleForDirective(node, forDirective, context);
        return null;
    },
    // Attribute/event directives
    'bd-on': (node, context, props) => {
        for (const attr of node.attributes) {
            if (attr.name.startsWith('bd-on:')) {
                const eventName = attr.name.substring(6);
                const handlerName = attr.value;
                const handler = context[handlerName];
                if (handler && typeof handler === 'function') {
                    props[`on${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`] = handler;
                }
            }
        }
    },
    'bd-bind': (node, context, props) => {
        for (const attr of node.attributes) {
            if (attr.name.startsWith('bd-bind:')) {
                const propName = attr.name.substring(8);
                const expr = attr.value;
                const contextValue = context[expr];
                // Always wrap in a computed signal for consistent reactivity
                props[propName] = computed(() => {
                    if (contextValue && typeof contextValue === 'function') {
                        return contextValue();
                    }
                    return contextValue;
                });
            }
        }
    },
    'bd-show': (node, context, props) => {
        for (const attr of node.attributes) {
            if (attr.name === 'bd-show') {
                const showExpr = attr.value;
                const contextValue = context[showExpr];
                if (!props.style) props.style = {};
                // Always use computed for full reactivity
                props.style.display = computed(() => {
                    let shouldShow = false;
                    if (contextValue && typeof contextValue === 'function') {
                        shouldShow = contextValue();
                    } else {
                        shouldShow = !!contextValue;
                    }
                    return shouldShow ? '' : 'none';
                });
            }
        }
    },
    'bd-trigger': (node, context, props, fetchConfig) => {
        for (const attr of node.attributes) {
            if (FETCH_TRIGGER_ATTRS.includes(attr.name)) {
                props.attrs[attr.name] = attr.value;
                fetchConfig[attr.name] = attr.value;
            }
        }
    },
    'default': (node, context, props) => {
        for (const attr of node.attributes) {
            if (!attr.name.startsWith('bd-on:') && !attr.name.startsWith('bd-bind:') && attr.name !== 'bd-show' && !FETCH_TRIGGER_ATTRS.includes(attr.name)) {
                props.attrs[attr.name] = attr.value;
            }
        }
    }
};

function parseNode(node, context) {
    // Text nodes with interpolation
    if (node.nodeType === Node.TEXT_NODE) {
        return parseTextNode(node.textContent, context);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    // Prevent bd-else nodes from being processed independently
    if (node.hasAttribute('bd-else')) {
        return null;
    }

    // --- Modular directive handling ---
    // Control flow directives (return early if handled)
    for (const key of ['bd-if', 'bd-for']) {
        if (node.hasAttribute(key)) {
            const result = directiveHandlers[key](node, context);
            if (result !== null) return result;
        }
    }

    // --- Attribute and event directives ---
    const tagName = node.tagName.toLowerCase();
    const props = { attrs: {} };
    const children = [];
    const fetchConfig = {};

    // Attribute/event/fetch directives
    directiveHandlers['bd-on'](node, context, props);
    directiveHandlers['bd-bind'](node, context, props);
    directiveHandlers['bd-show'](node, context, props);
    directiveHandlers['bd-trigger'](node, context, props, fetchConfig);
    directiveHandlers['default'](node, context, props);

    // Recursively parse child nodes
    for (const child of node.childNodes) {
        const parsedChild = parseNode(child, context);
        if (parsedChild) children.push(parsedChild);
    }

    function handleFetchTriggerBehavior(el) {
        const method = fetchConfig['bd-post'] ? 'POST' : 'GET';
        const url = fetchConfig['bd-get'] || fetchConfig['bd-post'];
        if (!url) return;
        
        let trigger = fetchConfig['bd-trigger'] || '';
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
                if (fetchConfig['bd-select']) {
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const sel = temp.querySelector(fetchConfig['bd-select']);
                    if (sel) {
                        const swapMode = (fetchConfig['bd-swap'] || '').toLowerCase();
                        if (swapMode === 'innerhtml') {
                            html = sel.innerHTML;
                        } else {
                            html = sel.outerHTML;
                        }
                    }
                }
                
                // Determine target element
                let target = el;
                if (fetchConfig['bd-target']) {
                    const targetEl = document.querySelector(fetchConfig['bd-target']);
                    if (targetEl) target = targetEl;
                }
                
                // Apply the swap strategy
                const swap = (fetchConfig['bd-swap'] || 'innerHTML').toLowerCase();
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
                if (fetchConfig['bd-push-url'] === 'true') {
                    history.pushState({}, '', url);
                } else if (fetchConfig['bd-replace-url'] === 'true') {
                    history.replaceState({}, '', url);
                }
            } catch (error) {
                console.error('Fetch trigger error:', error);
                // Optionally show error to user
            }
        };
        
        el.addEventListener(trigger, handleEvent);
    }

    // Compose the component - ensure we always return a BaseDOM component
    const componentFactory = Element(tagName);
    const baseComponent = componentFactory({ ...props, children });
    
    // Handle fetch/trigger behavior if present
    if (Object.keys(fetchConfig).some(k => fetchConfig[k])) {
        // Return a BaseDOM component that sets up the fetch behavior
        return (el) => {
            // First render the base component
            const result = typeof baseComponent === 'function' ? baseComponent(el) : baseComponent;
            
            // Then set up the fetch behavior on the rendered element
            if (el && el.addEventListener) {
                handleFetchTriggerBehavior(el);
            }
            
            return result;
        };
    }
    
    // Always return a BaseDOM component
    return baseComponent;
}
/**
 * Handles the `bd-if` and `bd-else` directives for conditional rendering.
 * @param {Node} ifNode - The node with the bd-if attribute.
 * @param {string} condition - The condition to evaluate from the context.
 * @param {Node|null} elseNode - The node with the bd-else attribute (if present).
 * @param {object} context - The component's context.
 * @returns {Function} A function that returns the if or else component or null.
 */
function handleIfElseDirective(ifNode, condition, elseNode, context) {
    ifNode.removeAttribute('bd-if');
    if (elseNode) elseNode.removeAttribute('bd-else');

    return computed(() => {
        const conditionValue = context[condition];
        let shouldShow = false;
        
        if (conditionValue && typeof conditionValue === 'function') {
            shouldShow = conditionValue();
        } else {
            shouldShow = !!conditionValue;
        }
        
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
    // Split text into static and dynamic parts
    const parts = [];
    let lastIndex = 0;
    const regex = /\{\{(.*?)\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const expr = match[1].trim();
        parts.push(() => {
            const contextValue = context[expr];
            if (contextValue && typeof contextValue === 'function') {
                return contextValue();
            }
            return contextValue !== undefined ? contextValue : `{{${expr}}}`;
        });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    // Return a computed signal that joins all parts
    return computed(() => parts.map(part => typeof part === 'function' ? part() : part).join(''));
}

// --- Directive Implementations ---



/**
 * Handles the `bd-for` directive for list rendering.
 * @param {Node} node - The node with the bd-for attribute.
 * @param {string} expression - The "item in items" expression.
 * @param {object} context - The component's context.
 * @returns {Function} A function that returns an array of components.
 */
function handleForDirective(node, expression, context) {
    node.removeAttribute('bd-for'); // Avoid reprocessing
    const [itemName, listName] = expression.split(' in ').map(s => s.trim());
    
    // Return a function that reactively returns the list of components
    return computed(() => {
        const listValue = context[listName];
        let items = [];
        
        if (listValue && typeof listValue === 'function') {
            items = listValue(); // Get the array from the signal
        } else if (Array.isArray(listValue)) {
            items = listValue;
        }
        
        if (!Array.isArray(items)) {
            return [];
        }

        return items.map((item, index) => {
            // For each item, create a new context that includes the loop variable
            const loopContext = {
                ...context,
                [itemName]: () => item, // Make the item available as a "signal"
                [`${itemName}Index`]: () => index // Also provide the index
            };
            return parseNode(node.cloneNode(true), loopContext);
        });
    });
}