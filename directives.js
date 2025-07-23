// directives.js
import { computed } from './state.js';
import { evaluateExpression, _reactive } from './expression.js';
import { parseNode, registerDirective } from './parser.js';

/**
 * Directive Interface:
 * {
 *   controlFlow: boolean,           // Whether this directive controls rendering flow
 *   preprocess?: (nodes) => nodes,  // Optional: Filter/modify node list before parsing
 *   handle: (parsingContext, props?) => result  // Main directive logic
 * }
 * 
 * Control flow directives return a computed/function or null
 * Attribute directives modify the props object
 */

// --- Control Flow Directives ---

export const xIfDirective = {
    controlFlow: true,
    // Preprocessing function to filter out paired x-else nodes
    preprocess: (nodes) => {
        return nodes.filter((node, index) => {
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
    },
    handle: (parsingContext) => {
        const { node, context, parseNode } = parsingContext;
        
        // Check if this directive applies to this node
        if (!node.hasAttribute || !node.hasAttribute('x-if')) {
            return null;
        }
        
        const ifDirective = node.getAttribute('x-if');

        // Find the corresponding x-else node by traversing siblings
        let elseNode = null;
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

        // Clone nodes to avoid modifying the original DOM
        const ifNodeClone = node.cloneNode(true);
        const elseNodeClone = elseNode ? elseNode.cloneNode(true) : null;
        
        // Remove directive attributes from clones
        ifNodeClone.removeAttribute('x-if');
        if (elseNodeClone) elseNodeClone.removeAttribute('x-else');

        return computed(() => {
            const shouldShow = evaluateExpression(ifDirective, context);
            
            if (shouldShow) {
                return parseNode(ifNodeClone, context);
            } else if (elseNodeClone) {
                return parseNode(elseNodeClone, context);
            }
            return null;
        });
    }
};

export const xElseDirective = {
    controlFlow: true,
    handle: (parsingContext) => {
        const { node } = parsingContext;
        
        // Check if this directive applies to this node
        if (!node.hasAttribute || !node.hasAttribute('x-else')) {
            return null;
        }

        // If we reach this point, it means x-else wasn't paired with x-if
        console.warn('Found standalone x-else directive without corresponding x-if:', node);
        return null; // Don't render standalone x-else
    }
};

export const xForDirective = {
    controlFlow: true,
    handle: (parsingContext) => {
        const { node, context, parseNode } = parsingContext;
        
        // Check if this directive applies to this node
        if (!node.hasAttribute || !node.hasAttribute('x-for')) {
            return null;
        }
        
        const forDirective = node.getAttribute('x-for');

        // Parse the for expression - support "item in items" and "item, index in items"
        const forMatch = forDirective.match(/^(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
        if (!forMatch) {
            console.warn(`Invalid x-for expression: ${forDirective}`);
            return () => [];
        }
        
        const [, itemName, indexName, listExpr] = forMatch;
        const nodeClone = node.cloneNode(true);
        nodeClone.removeAttribute('x-for');
        
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
                
                return parseNode(nodeClone.cloneNode(true), loopContext);
            });
        });
    }
};

// --- Attribute Processing Directives ---

export const xOnDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has any x-on: attributes
        if (!node.attributes) return;
        
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
    }
};

export const xBindDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has any x-bind: attributes
        if (!node.attributes) return;
        
        for (const attr of node.attributes) {
            if (attr.name.startsWith('x-bind:')) {
                const propName = attr.name.substring(7);
                const expr = attr.value;
                props[propName] = computed(() => {
                    return evaluateExpression(expr, context);
                });
            }
        }
    }
};

export const xShowDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-show attribute
        if (!node.hasAttribute || !node.hasAttribute('x-show')) return;
        
        const showExpr = node.getAttribute('x-show');
        if (!props.style) props.style = {};
        props.style.display = computed(() => {
            const shouldShow = evaluateExpression(showExpr, context);
            return shouldShow ? '' : 'none';
        });
    }
};

export const xModelDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-model attribute
        if (!node.hasAttribute || !node.hasAttribute('x-model')) return;
        
        const modelExpr = node.getAttribute('x-model').trim();
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
};

export const xFetchDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        // Collect fetch config from attributes
        const fetchAttrs = [
            'x-get', 'x-post', 'x-swap', 'x-select', 'x-trigger',
            'x-push-url', 'x-replace-url', 'x-target'
        ];
        const fetchConfig = {};
        let hasFetch = false;
        for (const attr of fetchAttrs) {
            if (node.hasAttribute(attr)) {
                fetchConfig[attr] = node.getAttribute(attr);
                props.attrs[attr] = node.getAttribute(attr);
                hasFetch = true;
            }
        }
        if (!hasFetch) return;

        // Attach fetch handler after render
        props.ref = (el) => {
            if (!el) return;
            const tagName = node.tagName.toLowerCase();
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
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                    let html = await resp.text();

                    // Handle content selection
                    if (fetchConfig['x-select']) {
                        const temp = document.createElement('div');
                        temp.innerHTML = html;
                        const sel = temp.querySelector(fetchConfig['x-select']);
                        if (sel) {
                            const swapMode = (fetchConfig['x-swap'] || '').toLowerCase();
                            html = swapMode === 'innerhtml' ? sel.innerHTML : sel.outerHTML;
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
                }
            };

            el.addEventListener(trigger, handleEvent);
        };
    }
};

export const defaultDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node } = parsingContext;
        for (const attr of node.attributes) {
            if (
                !attr.name.startsWith('x-on:') &&
                !attr.name.startsWith('x-bind:') &&
                attr.name !== 'x-show' &&
                attr.name !== 'x-model' &&
                attr.name !== 'x-get' &&
                attr.name !== 'x-post' &&
                attr.name !== 'x-swap' &&
                attr.name !== 'x-select' &&
                attr.name !== 'x-trigger' &&
                attr.name !== 'x-push-url' &&
                attr.name !== 'x-replace-url' &&
                attr.name !== 'x-target' &&
                attr.name !== 'x-if' &&
                attr.name !== 'x-else' &&
                attr.name !== 'x-for'
            ) {
                props.attrs[attr.name] = attr.value;
            }
        }
    }
};

// Register built-in directives
registerDirective('x-if', xIfDirective);
registerDirective('x-else', xElseDirective);
registerDirective('x-for', xForDirective);
registerDirective('x-on', xOnDirective);
registerDirective('x-bind', xBindDirective);
registerDirective('x-show', xShowDirective);
registerDirective('x-model', xModelDirective);
registerDirective('x-get', xFetchDirective);
registerDirective('x-post', xFetchDirective);
registerDirective('default', defaultDirective);