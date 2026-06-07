// directives.js
import { computed } from './state.js';
import { evaluateExpression, _reactive } from './expression.js';
import { registerDirective, parseComponent } from './parser.js';
import { navigate, attachLinkInterception } from './navigation.js';
import { renderComponent } from './components.js';
import { fetchAndSwap } from './fetch.js';

// --- Helper utilities (htmx-like semantics) ---
// Ensure BaseDOM link interception is enabled so `x-link`/navigation works
if (typeof attachLinkInterception === 'function') attachLinkInterception();
function parentElt(elt) {
    const parent = elt.parentElement;
    if (!parent && elt.parentNode instanceof ShadowRoot) return elt.parentNode;
    return parent;
}

function getRawAttribute(elt, name) {
    if (!(elt instanceof Element)) return null;
    return elt.getAttribute(name) || elt.getAttribute('data-' + name);
}

function getAttributeValueWithDisinheritance(initialElement, ancestor, attributeName) {
    const attributeValue = getRawAttribute(ancestor, attributeName);
    const disinherit = getRawAttribute(ancestor, 'x-disinherit');
    const inherit = getRawAttribute(ancestor, 'x-inherit');
    if (initialElement !== ancestor) {
        if (inherit && (inherit === '*' || inherit.split(' ').indexOf(attributeName) >= 0)) {
            return attributeValue;
        }
        if (disinherit && (disinherit === '*' || disinherit.split(' ').indexOf(attributeName) >= 0)) {
            return 'unset';
        }
    }
    return attributeValue;
}

function getClosestAttributeValue(elt, attributeName) {
    let closestAttr = null;
    let node = elt;
    while (node) {
        const val = getAttributeValueWithDisinheritance(elt, node, attributeName);
        if (val != null) {
            closestAttr = val;
            break;
        }
        node = parentElt(node);
    }
    if (closestAttr !== 'unset') return closestAttr;
}

// fetch-related helpers (makeFragment, OOB swaps, swap application, preserve) are provided by fetch.js

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

        return computed(() => {
            try {
                const shouldShow = evaluateExpression(ifDirective, context);
                
                if (shouldShow) {
                    // Clone the node fresh on each mount to ensure clean lifecycle hooks
                    const ifNodeClone = node.cloneNode(true);
                    ifNodeClone.removeAttribute('x-if');
                    return parseNode(ifNodeClone, context);
                } else if (elseNode) {
                    // Clone the node fresh on each mount to ensure clean lifecycle hooks
                    const elseNodeClone = elseNode.cloneNode(true);
                    elseNodeClone.removeAttribute('x-else');
                    return parseNode(elseNodeClone, context);
                }
                return null;
            } catch (error) {
                if (window.devWarn) devWarn(`[directives.js/xIfDirective] Error evaluating x-if expression '${ifDirective}':`, error);
                return null;
            }
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
            try {
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
            } catch (error) {
                if (window.devWarn) devWarn(`[directives.js/xForDirective] Error evaluating x-for expression '${listExpr}':`, error);
                return [];
            }
        });
    }
};

// --- Attribute Processing Directives ---

export const xOnDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        if (!node.attributes) return;
        for (const attr of node.attributes) {
            let isXOn = false;
            let eventName = '';
            if (attr.name.startsWith('x-on:')) {
                isXOn = true;
                eventName = attr.name.substring(5).toLowerCase();
            } else if (attr.name.startsWith('@')) {
                isXOn = true;
                eventName = attr.name.substring(1).toLowerCase();
            }
            if (isXOn) {
                // Map aliases for convenience
                if (eventName === 'hover' || eventName === 'enter') eventName = 'mouseenter';
                if (eventName === 'leave') eventName = 'mouseleave';
                const handlerExpr = attr.value;

                // Always attach using normalized event name (lowercase)
                let propEventName = `on${eventName}`;
                props[propEventName] = (event) => {
                    const eventContext = {
                        ...context,
                        $event: event,
                        $target: event.target,
                        $currentTarget: event.currentTarget
                    };
                    // Always evaluate the handler expression on every event
                    const result = evaluateExpression(handlerExpr, eventContext);
                    if (typeof result === 'function') {
                        result(event);
                    }
                    // If result is not a function, just evaluate (for side effects like console.log)
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
            try {
                const shouldShow = evaluateExpression(showExpr, context);
                return shouldShow ? '' : 'none';
            } catch (error) {
                if (window.devWarn) devWarn(`[directives.js/xShowDirective] Error evaluating x-show expression '${showExpr}':`, error);
                return 'none'; // Default to hidden on error
            }
        });
    }
};

export const xModelDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        if (!node.hasAttribute || !node.hasAttribute('x-model')) return;

        const modelExpr = node.getAttribute('x-model').trim();
        let signal = context[modelExpr];

        // Support signals as [getter, setter] pairs
        let getter, setter;
        if (typeof signal === 'function') {
            getter = signal;
            setter = signal.set || context[`set${modelExpr.charAt(0).toUpperCase() + modelExpr.slice(1)}`];
        } else if (Array.isArray(signal) && signal.length === 2 && typeof signal[0] === 'function' && typeof signal[1] === 'function') {
            getter = signal[0];
            setter = signal[1];
        } else {
            // Try to find getter/setter in context
            getter = () => signal;
            setter = context[`set${modelExpr.charAt(0).toUpperCase() + modelExpr.slice(1)}`];
        }

        if (!getter || typeof getter !== 'function' || !setter || typeof setter !== 'function') {
            console.warn(`x-model: '${modelExpr}' is not a valid signal or setter is missing in context.`);
            return;
        }

        if (!props.attrs) props.attrs = {};
        const tagName = node.tagName.toLowerCase();
        const type = node.getAttribute('type');

        if (tagName === 'input' && type === 'checkbox') {
            props.attrs.checked = computed(() => getter());
            props.onChange = (event) => {
                setter(event.target.checked);
            };
        } else if (tagName === 'input' || tagName === 'textarea') {
            props.attrs.value = computed(() => getter());
            const inputHandler = (event) => {
                setter(event.target.value);
            };
            props.onInput = inputHandler;
            props.onChange = inputHandler;
        } else if (tagName === 'select') {
            props.attrs.value = computed(() => getter());
            props.onChange = (event) => {
                setter(event.target.value);
            };
        }
    }
};

export const FetchDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        // Collect fetch config from attributes
        const fetchAttrs = [
            'x-get', 'x-post', 'x-put', 'x-patch', 'x-delete',
            'x-swap', 'x-select', 'x-trigger',
            'x-push-url', 'x-replace-url', 'x-target',
            'x-headers', 'x-params', 'x-include', 'x-vals', 'x-encoding',
            'x-confirm', 'x-indicator', 'x-timeout', 'x-boost'
        ];

        const fetchConfig = {};
        let hasFetch = false;
        for (const attr of fetchAttrs) {
            const val = getClosestAttributeValue(node, attr);
            // Ignore undefined, null, or string 'null' so templates don't inject null attrs
            if (val === undefined || val === null) continue;
            if (typeof val === 'string' && val.trim().toLowerCase() === 'null') continue;
            fetchConfig[attr] = val;
            props.attrs = props.attrs || {};
            props.attrs[attr] = val;
            hasFetch = true;
        }
        if (!hasFetch) return;

        // Attach fetch handler after render. Use lifecycle hooks (`onMount`/`onUnmount`) so
        // the component lifecycle system manages listener cleanup.
        let _attachedEl = null;
        let _attachedTrigger = null;
        let _attachedHandler = null;

        props.onMount = (el) => {
            if (!el) return;
            // If previously attached to a different element, clean up first
            try {
                if (_attachedEl && _attachedHandler && _attachedTrigger) {
                    _attachedEl.removeEventListener(_attachedTrigger, _attachedHandler);
                }
            } catch (e) {}
            _attachedEl = el;
            const tagName = node.tagName.toLowerCase();

            // Determine method and URL
            const method = fetchConfig['x-post'] ? 'POST'
                         : fetchConfig['x-put'] ? 'PUT'
                         : fetchConfig['x-patch'] ? 'PATCH'
                         : fetchConfig['x-delete'] ? 'DELETE'
                         : 'GET';

            const url = fetchConfig['x-get'] || fetchConfig['x-post'] || fetchConfig['x-put'] || fetchConfig['x-patch'] || fetchConfig['x-delete'];
            if (!url) return;

            let trigger = fetchConfig['x-trigger'] || '';
            if (!trigger) {
                trigger = (tagName === 'form' && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) ? 'submit' : 'click';
            }

            _attachedTrigger = trigger;

            _attachedHandler = async (evt) => {
                // x-confirm: if present, evaluate and require true/confirmation
                if (fetchConfig['x-confirm']) {
                    let confirmVal = fetchConfig['x-confirm'];
                    try { confirmVal = evaluateExpression(confirmVal, context); } catch (e) {}
                    if (typeof confirmVal === 'function') confirmVal = confirmVal();
                    if (confirmVal === false) return;
                    if (confirmVal === true) {
                        // continue
                    } else if (typeof confirmVal === 'string') {
                        if (!window.confirm(confirmVal)) return;
                    }
                }

                if (tagName === 'form' && trigger === 'submit') {
                    evt.preventDefault();
                }

                // Build fetch options
                const controller = new AbortController();
                const timeout = fetchConfig['x-timeout'] ? parseInt(fetchConfig['x-timeout'], 10) : 0;
                if (timeout > 0) {
                    setTimeout(() => controller.abort(), timeout);
                }

                let fetchOpts = { method, headers: {}, signal: controller.signal };

                // x-headers: allow JSON or key: value; evaluated if expression
                if (fetchConfig['x-headers']) {
                    let headersVal = fetchConfig['x-headers'];
                    try { headersVal = evaluateExpression(headersVal, context); } catch (e) {}
                    if (typeof headersVal === 'string') {
                        try {
                            const parsed = JSON.parse(headersVal);
                            Object.assign(fetchOpts.headers, parsed);
                        } catch (e) {
                            // parse simple semicolon or newline separated headers
                            headersVal.split(/[;\n]/).forEach(pair => {
                                const idx = pair.indexOf(':');
                                if (idx > -1) {
                                    const k = pair.slice(0, idx).trim();
                                    const v = pair.slice(idx+1).trim();
                                    if (k) fetchOpts.headers[k] = v;
                                }
                            });
                        }
                    } else if (typeof headersVal === 'object') {
                        Object.assign(fetchOpts.headers, headersVal);
                    }
                }

                // Build params/include/vals
                const encoding = (fetchConfig['x-encoding'] || '').toLowerCase();
                const valsRaw = fetchConfig['x-vals'];
                let vals = null;
                if (valsRaw) {
                    try { vals = evaluateExpression(valsRaw, context); } catch (e) { try { vals = JSON.parse(valsRaw); } catch (e2) { vals = valsRaw; } }
                }

                // form handling and body building
                let fetchUrl = url;
                if (method === 'GET') {
                    // For GET, include params and include into query string
                    const urlObj = new URL(url, window.location.href);
                    if (fetchConfig['x-params']) {
                        let paramsVal = fetchConfig['x-params'];
                        try { paramsVal = evaluateExpression(paramsVal, context); } catch (e) {}
                        if (typeof paramsVal === 'string') {
                            // parse key=val&...
                            new URLSearchParams(paramsVal).forEach((v,k) => urlObj.searchParams.append(k,v));
                        } else if (typeof paramsVal === 'object') {
                            Object.entries(paramsVal).forEach(([k,v]) => urlObj.searchParams.append(k, v));
                        }
                    }
                    if (fetchConfig['x-include']) {
                        const sel = fetchConfig['x-include'];
                        try {
                            const nodes = document.querySelectorAll(sel);
                            nodes.forEach(n => {
                                if (n.name) urlObj.searchParams.append(n.name, n.value || n.textContent || '');
                            });
                        } catch (e) {}
                    }
                    // replace url with augmented one
                    fetchUrl = urlObj.toString();
                }

                // For non-GET, build body
                if (method !== 'GET') {
                    if (encoding === 'json' || (vals && typeof vals === 'object' && ! (vals instanceof FormData))) {
                        // send JSON body
                        fetchOpts.headers['Content-Type'] = fetchOpts.headers['Content-Type'] || 'application/json';
                        const bodyObj = {};
                        if (fetchConfig['x-params']) {
                            try { Object.assign(bodyObj, JSON.parse(fetchConfig['x-params'])); } catch(e) {}
                        }
                        if (vals && typeof vals === 'object') Object.assign(bodyObj, vals);
                        // x-include: include named inputs from element
                        if (fetchConfig['x-include']) {
                            try {
                                const nodes = document.querySelectorAll(fetchConfig['x-include']);
                                nodes.forEach(n => { if (n.name) bodyObj[n.name] = n.value || n.textContent || ''; });
                            } catch (e) {}
                        }
                        fetchOpts.body = JSON.stringify(bodyObj);
                    } else {
                        // default: FormData for forms or URL-encoded
                        const formData = new FormData();
                        if (tagName === 'form') {
                            try {
                                const fd = new FormData(el);
                                for (const pair of fd.entries()) formData.append(pair[0], pair[1]);
                            } catch (e) {}
                        }
                        if (fetchConfig['x-params']) {
                            let paramsVal = fetchConfig['x-params'];
                            try { paramsVal = evaluateExpression(paramsVal, context); } catch (e) {}
                            if (typeof paramsVal === 'string') {
                                new URLSearchParams(paramsVal).forEach((v,k) => formData.append(k,v));
                            } else if (typeof paramsVal === 'object') {
                                Object.entries(paramsVal).forEach(([k,v]) => formData.append(k, v));
                            }
                        }
                        if (vals && typeof vals === 'object') {
                            Object.entries(vals).forEach(([k,v]) => formData.append(k, v));
                        }
                        if (fetchConfig['x-include']) {
                            try {
                                const nodes = document.querySelectorAll(fetchConfig['x-include']);
                                nodes.forEach(n => { if (n.name) formData.append(n.name, n.value || n.textContent || ''); });
                            } catch (e) {}
                        }
                        fetchOpts.body = formData;
                    }
                }

                // Raw HTML swap is handled centrally by `fetchAndSwap`/`fetch.js`.

                // Manage indicator: add/remove CSS class or toggle attribute
                let indicatorNodes = [];
                if (fetchConfig['x-indicator']) {
                    try { indicatorNodes = Array.from(document.querySelectorAll(fetchConfig['x-indicator'])); } catch (e) { indicatorNodes = []; }
                }
                const addIndicator = () => indicatorNodes.forEach(n => n.classList.add('x-requesting'));
                const removeIndicator = () => indicatorNodes.forEach(n => n.classList.remove('x-requesting'));

                try {
                    addIndicator();

                    // Use centralized fetchAndSwap helper which now understands BaseDOM components
                    const targetElementOption = fetchConfig['x-target'] === 'this' ? el : null;
                    const targetSelectorOption = fetchConfig['x-target'] && fetchConfig['x-target'] !== 'this' ? fetchConfig['x-target'] : null;

                    const result = await fetchAndSwap(fetchUrl, {
                        method,
                        headers: fetchOpts.headers,
                        body: fetchOpts.body,
                        swap: fetchConfig['x-swap'],
                        targetElement: targetElementOption,
                        targetSelector: targetSelectorOption,
                        preserve: true,
                        context,
                        select: fetchConfig['x-select'],
                        selectOob: fetchConfig['x-select-oob']
                    });

                    removeIndicator();

                    if (!result || result.ok === false) {
                        throw new Error(result && result.error ? result.error : 'Fetch failed');
                    }

                    // Handle URL updates via BaseDOM navigation
                    try {
                        const pushVal = fetchConfig['x-push-url'];
                        const replaceVal = fetchConfig['x-replace-url'];
                        if (pushVal) {
                            if (pushVal === 'true') {
                                navigate(url);
                            } else if (pushVal !== 'false') {
                                navigate(pushVal);
                            }
                        } else if (replaceVal) {
                            if (replaceVal === 'true') {
                                navigate(url, { replace: true });
                            } else if (replaceVal !== 'false') {
                                navigate(replaceVal, { replace: true });
                            }
                        }
                    } catch (e) {
                        console.warn('Navigation after fetch failed:', e);
                    }
                } catch (error) {
                    removeIndicator();
                    if (error && error.name === 'AbortError') {
                        console.error('Fetch request aborted (timeout).');
                    } else {
                        console.error('Fetch trigger error:', error);
                    }
                }
            };

            // attach handler; lifecycle will handle cleanup via onUnmount
            try {
                el.addEventListener(_attachedTrigger, _attachedHandler);
            } catch (e) {}
        };

        // Ensure the listener is removed when element unmounts via lifecycle
        props.onUnmount = () => {
            try {
                if (_attachedEl && _attachedHandler && _attachedTrigger) {
                    _attachedEl.removeEventListener(_attachedTrigger, _attachedHandler);
                }
            } catch (e) {}
            _attachedEl = null;
            _attachedHandler = null;
            _attachedTrigger = null;
        };
    }
};

// --- Lifecycle Hook Directives ---

export const xMountDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-mount attribute
        if (!node.hasAttribute || !node.hasAttribute('x-mount')) return;
        
        const mountExpr = node.getAttribute('x-mount');
        const handler = evaluateExpression(mountExpr, context);
        
        if (typeof handler === 'function') {
            props.onMount = handler;
        }
    }
};

export const xUnmountDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-unmount attribute
        if (!node.hasAttribute || !node.hasAttribute('x-unmount')) return;
        
        const unmountExpr = node.getAttribute('x-unmount');
        const handler = evaluateExpression(unmountExpr, context);
        
        if (typeof handler === 'function') {
            props.onUnmount = handler;
        }
    }
};

export const xUpdateDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-update attribute
        if (!node.hasAttribute || !node.hasAttribute('x-update')) return;
        
        const updateExpr = node.getAttribute('x-update');
        const handler = evaluateExpression(updateExpr, context);
        
        if (typeof handler === 'function') {
            props.onUpdate = handler;
        }
    }
};

export const defaultDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node } = parsingContext;
        for (const attr of node.attributes) {
            if (
                !attr.name.startsWith('x-on:') &&
                !attr.name.startsWith('@') &&
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
                attr.name !== 'x-for' &&
                attr.name !== 'x-mount' &&
                attr.name !== 'x-unmount' &&
                attr.name !== 'x-update'
            ) {
                props.attrs[attr.name] = attr.value;
            }
        }
    }
};

// --- Slot Directive Implementation ---
// Handles <slot> and x-slot in parent templates
export const slotDirective = {
    controlFlow: true,
    handle: ({ node, context }) => {
        if (!node.tagName || node.tagName.toLowerCase() !== 'slot') return null;
        // Get slot name (default is 'default')
        const slotName = node.getAttribute('name') || 'default';
        // Collect slot props (attributes starting with ':')
        const slotProps = {};
        for (const attr of Array.from(node.attributes || [])) {
            if (attr.name.startsWith(':')) {
                const propName = attr.name.slice(1);
                // Evaluate the prop value in the current context
                slotProps[propName] = _reactive(evaluateExpression(attr.value, context));
            }
        }
        // Find slot content in context
        const slotContent = context && context.__slots && context.__slots[slotName];
        if (slotContent) {
            // Pass slotProps to slot content as context
            return () => typeof slotContent === 'function' ? slotContent(slotProps) : slotContent;
        }
        // Default slot: fallback to children prop or empty
        if (slotName === 'default') {
            // Vue: default slot always renders children prop
            return context && context.children !== undefined ? context.children : '';
        }
        return '';
    }
};

// <div x-slot="usercard">...</div> registers slot content for <slot name="usercard">
export const xSlotDirective = {
    controlFlow: true,
    handle: ({ node, context, parseNode }) => {
        if (!node.hasAttribute || !node.hasAttribute('x-slot')) return null;
        const slotName = node.getAttribute('x-slot') || 'default';
        // Remove x-slot attribute to avoid recursion
        const nodeClone = node.cloneNode(true);
        nodeClone.removeAttribute('x-slot');
        // Register slot content in context.__slots
        if (!context.__slots) context.__slots = {};
        // Slot content is a function that receives slotProps
        context.__slots[slotName] = (slotProps = {}) => {
            // Merge slotProps into context for slot content
            const slotContext = { ...context, ...slotProps };
            // Remove __slots from slotContext to avoid infinite recursion
            delete slotContext.__slots;
            // If the registered node is a <template>, render its children (do not keep the <template> wrapper)
            try {
                if (nodeClone.tagName && nodeClone.tagName.toLowerCase() === 'template') {
                    const contentRoot = nodeClone.content || nodeClone;
                    const children = Array.from(contentRoot.childNodes || []).map(n => parseNode(n, slotContext)).filter(Boolean);
                    // If a single child, return it directly; otherwise return the array
                    return children.length === 1 ? children[0] : children;
                }
            } catch (e) {
                // fall back to parsing the node itself on error
            }
            return parseNode(nodeClone, slotContext);
        };
        // Do not render this node directly
        return () => null;
    }
};


export const xRefDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        
        // Check if this node has x-ref attribute
        if (!node.hasAttribute || !node.hasAttribute('x-ref')) return;
        
        const refExpr = node.getAttribute('x-ref');
        const refName = evaluateExpression(refExpr, context);
        
        // Attach ref to context
        if (typeof refName === 'string' && context[refName]) {
            context[refName] = node; // Assign the DOM element
        }
    }
};

// Register built-in directives
registerDirective('slot', slotDirective);
registerDirective('x-slot', xSlotDirective);
registerDirective('x-if', xIfDirective);
registerDirective('x-else', xElseDirective);
registerDirective('x-for', xForDirective);
registerDirective('x-on', xOnDirective);
registerDirective('@', xOnDirective);
registerDirective('x-bind', xBindDirective);
registerDirective('x-show', xShowDirective);
registerDirective('x-model', xModelDirective);
registerDirective('x-ref', xRefDirective);
registerDirective('x-get', FetchDirective);
registerDirective('x-post', FetchDirective);
registerDirective('x-put', FetchDirective);
registerDirective('x-patch', FetchDirective);
registerDirective('x-delete', FetchDirective);
registerDirective('x-mount', xMountDirective);
registerDirective('x-unmount', xUnmountDirective);
registerDirective('x-update', xUpdateDirective);
registerDirective('default', defaultDirective);