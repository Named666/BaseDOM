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
    const { template, script } = extractParts(htmlText);

    // Dynamically import the component's logic
    const componentModule = await import(`data:text/javascript,${encodeURIComponent(script)}`);
    const componentLogicFn = componentModule.default;

    // Create a DOM tree from the template
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(template, 'text/html');
    // Support multiple root nodes (fragment) for DSL style
    const nodes = Array.from(doc.body.childNodes).filter(n => n.nodeType === 1 || n.nodeType === 3); // ELEMENT_NODE or TEXT_NODE

    return (props) => {
        const context = componentLogicFn(props);
        if (nodes.length === 1) {
            return parseNode(nodes[0], context);
        } else {
            // Return an array of nodes as a fragment
            return nodes.map(n => parseNode(n, context));
        }
    };
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
        script = 'export default function() { return {}; }';
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
            const elseNode = node.nextSibling && node.nextSibling.nodeType === Node.ELEMENT_NODE && node.nextSibling.getAttribute('bd-else') !== null
                ? node.nextSibling
                : null;
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
                props[`on${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`] = context[attr.value];
            }
        }
    },
    'bd-bind': (node, context, props) => {
        for (const attr of node.attributes) {
            if (attr.name.startsWith('bd-bind:')) {
                const propName = attr.name.substring(8);
                props[propName] = computed(() => context[attr.value]() );
            }
        }
    },
    'bd-show': (node, context, props) => {
        for (const attr of node.attributes) {
            if (attr.name === 'bd-show') {
                const showExpr = attr.value;
                props.style = props.style || {};
                props.style.display = computed(() => {
                    const showSignal = context[showExpr];
                    return showSignal && showSignal() ? '' : 'none';
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
    directiveHandlers['fetch-trigger'](node, context, props, fetchConfig);
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
        let trigger = fetchConfig['bd-trigger'];
        if (!trigger) trigger = (tagName === 'form' && method === 'POST') ? 'submit' : 'click';
        el.addEventListener(trigger, async (evt) => {
            if (tagName === 'form' && method === 'POST') evt.preventDefault();
            let fetchOpts = { method };
            if (method === 'POST' && tagName === 'form') {
                fetchOpts.body = new FormData(el);
            }
            let resp = await fetch(url, fetchOpts);
            let html = await resp.text();
            if (fetchConfig['bd-select']) {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const sel = temp.querySelector(fetchConfig['bd-select']);
                if (sel) {
                    if ((fetchConfig['bd-swap']||'').toLowerCase() === 'innerhtml') {
                        html = sel.innerHTML;
                    } else {
                        html = sel.outerHTML;
                    }
                }
            }
            let target = el;
            if (el.hasAttribute('bd-target')) {
                const sel = el.getAttribute('bd-target');
                const found = document.querySelector(sel);
                if (found) target = found;
            }
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
            if (fetchConfig['bd-push-url'] === 'true') {
                history.pushState({}, '', url);
            } else if (fetchConfig['bd-replace-url'] === 'true') {
                history.replaceState({}, '', url);
            }
        });
    }

    // Compose the component
    const componentFactory = Element(tagName);
    const baseComponent = componentFactory({ ...props, children });
    if (Object.keys(fetchConfig).some(k => fetchConfig[k])) {
        return (el) => {
            const result = typeof baseComponent === 'function' ? baseComponent(el) : baseComponent;
            handleFetchTriggerBehavior(el);
            return result;
        };
    }
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
        const conditionSignal = context[condition];
        if (conditionSignal && conditionSignal()) {
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
            if (context[expr] && typeof context[expr] === 'function') {
                return context[expr]();
            }
            return `{{${expr}}}`;
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
    return () => {
        const listSignal = context[listName];
        if (!listSignal) return [];

        const items = listSignal(); // Get the array from the signal
        return items.map(item => {
            // For each item, create a new context that includes the loop variable
            const loopContext = {
                ...context,
                [itemName]: () => item // Make the item available as a "signal"
            };
            return parseNode(node.cloneNode(true), loopContext);
        });
    };
}