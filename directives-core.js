// directives.js
import { computed, effect, signal, untrack, unwrapSignal, createOwner, runWithOwner, disposeOwner } from './state.js';
import { evaluateExpression, _reactive } from './expression.js';
import { registerDirective } from './parser.js';
import { createComponent } from './components.js';
import { callOnMountRecursive, callOnUnmountRecursive } from './lifecycle.js';


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
                warn(`[directives.js/xIfDirective] Error evaluating x-if expression '${ifDirective}':`, error);
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

        // Check for a preceding x-if sibling (skipping text nodes).
        // If found, this x-else is paired and handled by xIfDirective — stay silent.
        let sibling = node.previousSibling;
        while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE) {
                if (sibling.hasAttribute && sibling.hasAttribute('x-if')) {
                    return () => null; // Paired x-else: handled by x-if
                }
                break; // Non-x-if element found first: truly standalone
            }
            sibling = sibling.previousSibling;
        }

        // If we reach this point, it means x-else wasn't paired with x-if
        console.warn('Found standalone x-else directive without corresponding x-if:', node);
        return null; // Don't render standalone x-else
    }
};

function warn(message, extra) {
    if (typeof window !== 'undefined' && typeof window.devWarn === 'function') window.devWarn(message, extra);
    else console.warn(message, extra === undefined ? '' : extra);
}

function interpolateAttribute(text, context) {
    return text.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
        const value = evaluateExpression(expr.trim(), context);
        return value == null ? '' : String(value);
    });
}

function realizeRow(rendered) {
    if (rendered instanceof HTMLElement) return rendered;
    return createComponent('span', { children: rendered == null ? [] : [rendered] });
}

/**
 * x-for keeps real DOM nodes and moves them. Keys come from x-key, otherwise
 * the index. This is not a virtual DOM: the nodes in the map are the live elements.
 */
export const xForDirective = {
    controlFlow: true,
    handle: (parsingContext) => {
        const { node, context, parseNode } = parsingContext;
        if (!node.hasAttribute || !node.hasAttribute('x-for')) return null;

        const forDirective = node.getAttribute('x-for');
        const forMatch = forDirective.match(/^(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
        if (!forMatch) {
            console.warn(`Invalid x-for expression: ${forDirective}`);
            return () => [];
        }

        const [, itemName, indexName, listExpr] = forMatch;
        const keyExpr = node.getAttribute('x-key');
        const nodeClone = node.cloneNode(true);
        nodeClone.removeAttribute('x-for');
        if (keyExpr != null) nodeClone.removeAttribute('x-key');

        const start = document.createComment('x-for');
        const end = document.createComment('/x-for');
        const fragment = document.createDocumentFragment();
        Object.defineProperty(fragment, '__live', { value: true });
        fragment.append(start, end);
        const rows = new Map();

        const stop = effect(() => {
            let items;
            try {
                items = unwrapSignal(evaluateExpression(listExpr.trim(), context));
            } catch (error) {
                warn(`[directives.js/xForDirective] Error evaluating x-for expression '${listExpr}':`, error);
                items = [];
            }
            if (!Array.isArray(items)) items = [];

            const seen = new Set();
            const nextKeys = [];
            items.forEach((item, index) => {
                let key = index;
                if (keyExpr) {
                    const keyContext = { ...context, [itemName]: signal(item)[0] };
                    if (indexName) keyContext[indexName] = signal(index)[0];
                    const evaluated = evaluateExpression(keyExpr, keyContext);
                    if (evaluated != null && evaluated !== '') key = evaluated;
                }
                if (seen.has(key)) {
                    console.warn(`[BaseDOM] duplicate x-key "${String(key)}" in x-for`);
                    key = `${String(key)}#${index}`;
                }
                seen.add(key);
                nextKeys.push(key);

                const existing = rows.get(key);
                if (existing) {
                    existing.setItem(item);
                    existing.setIndex(index);
                    return;
                }
                const row = untrack(() => createRow(item, index));
                rows.set(key, row);
            });

            for (const [key, row] of [...rows]) {
                if (seen.has(key)) continue;
                if (row.el.parentNode) {
                    callOnUnmountRecursive(row.el);
                    row.el.remove();
                }
                row.dispose();
                rows.delete(key);
            }

            const parent = end.parentNode;
            if (!parent) return;
            for (const key of nextKeys) {
                const row = rows.get(key);
                if (row && row.el !== end.previousSibling) parent.insertBefore(row.el, end);
            }
            if (end.isConnected) {
                for (const key of nextKeys) {
                    const row = rows.get(key);
                    if (row && !row.el.__mounted) callOnMountRecursive(row.el);
                }
            }
        });
        end.__dispose = stop;

        function createRow(item, index) {
            const owner = createOwner();
            const [getItem, setItem] = signal(item);
            const [getIndex, setIndex] = signal(index);
            const loopContext = { ...context, [itemName]: getItem };
            if (indexName) loopContext[indexName] = getIndex;
            else loopContext[`${itemName}Index`] = getIndex;
            let el;
            runWithOwner(owner, () => {
                el = realizeRow(parseNode(nodeClone.cloneNode(true), loopContext));
            });
            return { el, setItem, setIndex, dispose: () => disposeOwner(owner) };
        }

        return fragment;
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
            let propName = null;
            if (attr.name.startsWith('x-bind:')) propName = attr.name.slice(7);
            else if (attr.name.startsWith(':') && !attr.name.startsWith('::')) propName = attr.name.slice(1);
            if (!propName) continue;
            const expr = attr.value.trim().replace(/^\{\{|\}\}$/g, '').trim();
            props[propName] = computed(() => evaluateExpression(expr, context));
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
                warn(`[directives.js/xShowDirective] Error evaluating x-show expression '${showExpr}':`, error);
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
            const name = attr.name;
            if (
                name.startsWith('x-on:') ||
                name.startsWith('@') ||
                name.startsWith('x-bind:') ||
                name.startsWith(':') ||
                name === 'x-show' ||
                name === 'x-model' ||
                name === 'x-key' ||
                name === 'x-ref' ||
                name === 'x-slot' ||
                name === 'x-if' ||
                name === 'x-else' ||
                name === 'x-for' ||
                name === 'x-mount' ||
                name === 'x-unmount' ||
                name === 'x-update'
            ) continue;
            props.attrs[name] = name !== 'x-link' && attr.value.includes('{{')
                ? computed(() => interpolateAttribute(attr.value, context))
                : attr.value;
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

/**
 * Renders the active route inside a layout. The element stays in the document
 * so the router can replace its contents without rebuilding the layout.
 */
export const xOutletDirective = {
    controlFlow: true,
    handle({ node, context }) {
        if (!node.hasAttribute || !node.hasAttribute('x-outlet')) return null;
        const name = node.getAttribute('x-outlet') || 'main';
        const host = document.createElement(node.tagName.toLowerCase());
        host.setAttribute('x-outlet', name);
        for (const attr of [...node.attributes]) {
            if (attr.name !== 'x-outlet') host.setAttribute(attr.name, attr.value);
        }
        const child = context && context.children;
        const content = typeof child === 'function' ? child() : child;
        if (content instanceof Node) host.appendChild(content);
        else if (content != null && content !== false && content !== '') host.textContent = String(content);
        return host;
    }
};

// Register built-in directives
registerDirective('x-outlet', xOutletDirective);
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
registerDirective('x-mount', xMountDirective);
registerDirective('x-unmount', xUnmountDirective);
registerDirective('x-update', xUpdateDirective);
registerDirective('default', defaultDirective);