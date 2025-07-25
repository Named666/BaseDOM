// directives.js
import { computed } from './state.js';
import { evaluateExpression, _reactive } from './expression.js';
import { registerDirective, parseComponent } from './parser.js';
import { renderComponent } from './components.js';

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
        if (!node.attributes) return;
        for (const attr of node.attributes) {
            if (attr.name.startsWith('x-on:')) {
                let eventName = attr.name.substring(5).toLowerCase();
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
            const shouldShow = evaluateExpression(showExpr, context);
            return shouldShow ? '' : 'none';
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

                    // Check if the response looks like a BaseDOM component
                    const isComponent = html.includes('<template>') || html.includes('<script>') || 
                                       (html.includes('<style>') && (html.includes('<template>') || html.includes('<script>')));
                    
                    if (isComponent) {
                        // Parse as BaseDOM component
                        try {
                            const componentFn = await parseComponent(html);
                            const componentInstance = componentFn(context);
                            
                            // Apply the swap strategy using renderComponent
                            const swap = (fetchConfig['x-swap'] || 'innerHTML').toLowerCase();
                            if (swap === 'outerhtml') {
                                // For outerHTML, we need to replace the target element entirely
                                const wrapper = document.createElement('div');
                                renderComponent(componentInstance, wrapper);
                                target.outerHTML = wrapper.innerHTML;
                            } else if (swap === 'append' || swap === 'beforeend') {
                                const wrapper = document.createElement('div');
                                renderComponent(componentInstance, wrapper);
                                target.insertAdjacentHTML('beforeend', wrapper.innerHTML);
                            } else if (swap === 'prepend' || swap === 'afterbegin') {
                                const wrapper = document.createElement('div');
                                renderComponent(componentInstance, wrapper);
                                target.insertAdjacentHTML('afterbegin', wrapper.innerHTML);
                            } else if (swap === 'beforebegin') {
                                const wrapper = document.createElement('div');
                                renderComponent(componentInstance, wrapper);
                                target.insertAdjacentHTML('beforebegin', wrapper.innerHTML);
                            } else if (swap === 'afterend') {
                                const wrapper = document.createElement('div');
                                renderComponent(componentInstance, wrapper);
                                target.insertAdjacentHTML('afterend', wrapper.innerHTML);
                            } else {
                                // Default innerHTML - clear target and render component directly
                                renderComponent(componentInstance, target);
                            }
                        } catch (componentError) {
                            console.warn('Failed to parse response as BaseDOM component, falling back to raw HTML:', componentError);
                            // Fallback to raw HTML insertion
                            applyRawHtmlSwap(target, html, fetchConfig);
                        }
                    } else {
                        // Not a component, use raw HTML insertion
                        applyRawHtmlSwap(target, html, fetchConfig);
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

            // Helper function for raw HTML swapping
            function applyRawHtmlSwap(target, html, fetchConfig) {
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
            }

            el.addEventListener(trigger, handleEvent);
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
            return parseNode(nodeClone, slotContext);
        };
        // Do not render this node directly
        return () => null;
    }
};


// Register built-in directives
registerDirective('slot', slotDirective);
registerDirective('x-slot', xSlotDirective);
registerDirective('x-if', xIfDirective);
registerDirective('x-else', xElseDirective);
registerDirective('x-for', xForDirective);
registerDirective('x-on', xOnDirective);
registerDirective('x-bind', xBindDirective);
registerDirective('x-show', xShowDirective);
registerDirective('x-model', xModelDirective);
registerDirective('x-get', FetchDirective);
registerDirective('x-post', FetchDirective);
registerDirective('x-mount', xMountDirective);
registerDirective('x-unmount', xUnmountDirective);
registerDirective('x-update', xUpdateDirective);
registerDirective('default', defaultDirective);