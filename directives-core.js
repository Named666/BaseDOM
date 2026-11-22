// directives.js
import { computed, effect, signal, untrack, unwrapSignal, createOwner, runWithOwner, disposeOwner, getCurrentOwner } from './state.js';
import { evaluateExpression, childScope } from './expression.js';
import { reportDiagnostic } from './diagnostics.js';
import { registerDirective } from './parser.js';
import { getComponent } from './registry.js';
import './directives-parity.js';
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
                    const shown = parseNode(ifNodeClone, context);
                    if (node.hasAttribute('x-transition')) playEnter(shown, node.getAttribute('x-transition'));
                    return shown;
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

export function playEnter(element, name) {
    if (!(element instanceof HTMLElement)) return element;
    const prefix = name || 'v';
    element.classList.add(`${prefix}-enter-from`, `${prefix}-enter-active`);
    requestAnimationFrame(() => {
        element.classList.remove(`${prefix}-enter-from`);
        element.classList.add(`${prefix}-enter-to`);
        const done = () => {
            element.classList.remove(`${prefix}-enter-active`, `${prefix}-enter-to`);
            element.removeEventListener('transitionend', done);
        };
        element.addEventListener('transitionend', done);
    });
    return element;
}

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
function parseForHead(expr) {
    const match = String(expr || '').match(/^(.*?)\s+in\s+([\s\S]+)$/);
    if (!match) return null;
    let left = match[1].trim();
    if (left.startsWith('(') && left.endsWith(')')) left = left.slice(1, -1).trim();
    if (left.startsWith('{') && left.endsWith('}')) {
        const names = left.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
        if (!names.length) return null;
        return { kind: 'destructure', names, listExpr: match[2].trim() };
    }
    const names = left.split(',').map((part) => part.trim()).filter(Boolean);
    if (!names.length || names.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) return null;
    return { kind: 'names', names, listExpr: match[2].trim() };
}

function rowsOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const count = Math.max(0, Math.floor(value));
        return Array.from({ length: count }, (_, index) => ({ item: index + 1, key: undefined, index }));
    }
    if (Array.isArray(value)) return value.map((item, index) => ({ item, key: undefined, index }));
    if (value && typeof value === 'object') {
        return Object.keys(value).map((key, index) => ({ item: value[key], key, index }));
    }
    return [];
}

export const xForDirective = {
    controlFlow: true,
    handle: (parsingContext) => {
        const { node, context, parseNode } = parsingContext;
        if (!node.hasAttribute || !node.hasAttribute('x-for')) return null;

        const forDirective = node.getAttribute('x-for');
        const head = parseForHead(forDirective);
        if (!head) {
            console.warn(`Invalid x-for expression: ${forDirective}`);
            return () => [];
        }

        const { listExpr } = head;
        const itemName = head.kind === 'names' ? head.names[0] : head.names[0];
        const indexName = head.kind === 'names' && head.names.length === 2 ? head.names[1] : null;
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
            const records = rowsOf(items);

            const seen = new Set();
            const nextKeys = [];
            records.forEach((record) => {
                const item = record.item;
                const index = record.index;
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
                    if (existing.setKey) existing.setKey(record.key);
                    return;
                }
                const row = untrack(() => createRow(record));
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

        function createRow(record) {
            const owner = createOwner();
            const [getItem, setItem] = signal(record.item);
            const [getIndex, setIndex] = signal(record.index);
            const [getKey, setKey] = signal(record.key);
            const loopContext = { ...context };
            if (head.kind === 'destructure') {
                for (const name of head.names) {
                    const read = () => {
                        const current = getItem();
                        return current == null ? undefined : current[name];
                    };
                    read.__isSignal = true;
                    loopContext[name] = read;
                }
            } else if (record.key !== undefined && head.names.length > 1) {
                loopContext[head.names[0]] = getItem;
                loopContext[head.names[1]] = getKey;
                if (head.names[2]) loopContext[head.names[2]] = getIndex;
            } else {
                loopContext[itemName] = getItem;
                if (indexName) loopContext[indexName] = getIndex;
                else loopContext[`${itemName}Index`] = getIndex;
            }
            let el;
            runWithOwner(owner, () => {
                el = realizeRow(parseNode(nodeClone.cloneNode(true), loopContext));
            });
            const row = { el, setItem, setIndex, setKey, dispose: () => disposeOwner(owner) };
            // Dev-only link so an HMR swap can retarget the live row. Production
            // builds drop this branch because import.meta.hot is false.
            if (import.meta.hot && el) el.__basedomForRow = row;
            return row;
        }

        return fragment;
    }
};

// --- Attribute Processing Directives ---

const KEY_MODIFIERS = {
    enter: 'Enter',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: ' ',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    delete: 'Delete',
    backspace: 'Backspace'
};

function parseEventSpec(raw) {
    const parts = String(raw || '').split('.');
    const mods = new Set();
    let debounce = 0;
    let throttle = 0;
    for (let i = 1; i < parts.length; i += 1) {
        const part = parts[i];
        if ((part === 'debounce' || part === 'throttle') && parts[i + 1] && /^\d+$/.test(parts[i + 1])) {
            if (part === 'debounce') debounce = Number(parts[i + 1]);
            else throttle = Number(parts[i + 1]);
            i += 1;
            continue;
        }
        mods.add(part);
    }
    return { eventName: parts[0], mods, debounce, throttle };
}

function eventAllowed(event, mods) {
    if (mods.has('self') && event.target !== event.currentTarget) return false;
    if (mods.has('left') && event.button !== 0) return false;
    if (mods.has('middle') && event.button !== 1) return false;
    if (mods.has('right') && event.button !== 2) return false;
    const keyMod = [...mods].find((mod) => KEY_MODIFIERS[mod]);
    if (keyMod && event.key !== KEY_MODIFIERS[keyMod] && !(keyMod === 'delete' && event.key === 'Backspace')) return false;
    const wants = { ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift'), meta: mods.has('meta') };
    if (mods.has('exact')) {
        if (!!event.ctrlKey !== wants.ctrl) return false;
        if (!!event.altKey !== wants.alt) return false;
        if (!!event.shiftKey !== wants.shift) return false;
        if (!!event.metaKey !== wants.meta) return false;
    } else {
        if (wants.ctrl && !event.ctrlKey) return false;
        if (wants.alt && !event.altKey) return false;
        if (wants.shift && !event.shiftKey) return false;
        if (wants.meta && !event.metaKey) return false;
    }
    return true;
}

export const xOnDirective = {
    controlFlow: false,
    handle: (parsingContext, props) => {
        const { node, context } = parsingContext;
        if (!node.attributes) return;
        for (const attr of node.attributes) {
            let spec = '';
            if (attr.name.startsWith('x-on:')) spec = attr.name.slice(5);
            else if (attr.name.startsWith('@')) spec = attr.name.slice(1);
            if (spec) {
                const dynamic = spec.startsWith('[') && spec.endsWith(']');
                const parsed = dynamic ? { eventName: '', mods: new Set(), debounce: 0, throttle: 0 } : parseEventSpec(spec.toLowerCase());
                let eventName = parsed.eventName;
                if (eventName === 'hover' || eventName === 'enter') eventName = 'mouseenter';
                if (eventName === 'leave') eventName = 'mouseleave';
                const handlerExpr = attr.value;
                const invoke = (event) => {
                    if (event && typeof event.preventDefault === 'function' && parsed.mods.has('prevent')) event.preventDefault();
                    if (event && typeof event.stopPropagation === 'function' && parsed.mods.has('stop')) event.stopPropagation();
                    if (event && !eventAllowed(event, parsed.mods)) return;
                    const eventContext = {
                        ...context,
                        $event: event,
                        $target: event && event.target,
                        $currentTarget: event && event.currentTarget
                    };
                    const result = evaluateExpression(handlerExpr, eventContext);
                    if (typeof result === 'function') result(event);
                };
                let wrapped = invoke;
                if (parsed.debounce) {
                    let timer = 0;
                    wrapped = (event) => {
                        clearTimeout(timer);
                        timer = setTimeout(() => invoke(event), parsed.debounce);
                    };
                } else if (parsed.throttle) {
                    let last = 0;
                    wrapped = (event) => {
                        const now = Date.now();
                        if (now - last < parsed.throttle) return;
                        last = now;
                        invoke(event);
                    };
                }
                if (dynamic || parsed.mods.has('capture') || parsed.mods.has('passive') || parsed.mods.has('once')) {
                    const previous = props.onMount;
                    props.onMount = (element) => {
                        if (typeof previous === 'function') previous(element);
                        const name = dynamic ? String(evaluateExpression(spec.slice(1, -1), context) || '') : eventName;
                        if (!name) return;
                        element.addEventListener(name, wrapped, {
                            capture: parsed.mods.has('capture'),
                            passive: parsed.mods.has('passive'),
                            once: parsed.mods.has('once')
                        });
                    };
                } else if (eventName) {
                    props[`on${eventName}`] = wrapped;
                }
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
            if (attr.name === 'x-bind' || attr.name === ':') {
                const expr = attr.value.trim();
                const previous = props.onMount;
                props.onMount = (element) => {
                    if (typeof previous === 'function') previous(element);
                    const stop = effect(() => {
                        const bag = evaluateExpression(expr, context);
                        if (!bag || typeof bag !== 'object') return;
                        for (const [key, entry] of Object.entries(bag)) {
                            const next = typeof entry === 'function' ? entry() : entry;
                            if (next == null || next === false) element.removeAttribute(key);
                            else element.setAttribute(key, next === true ? '' : String(next));
                        }
                    });
                    const prior = element.__onUnmount;
                    element.__onUnmount = (...args) => {
                        stop();
                        if (typeof prior === 'function') prior(...args);
                    };
                };
                continue;
            }
            let propName = null;
            if (attr.name.startsWith('x-bind:')) propName = attr.name.slice(7);
            else if (attr.name.startsWith(':') && !attr.name.startsWith('::')) propName = attr.name.slice(1);
            if (!propName) continue;
            const expr = attr.value.trim().replace(/^\{\{|\}\}$/g, '').trim();
            if (propName.startsWith('[') && propName.endsWith(']')) {
                const keyExpr = propName.slice(1, -1);
                const previous = props.onMount;
                props.onMount = (element) => {
                    if (typeof previous === 'function') previous(element);
                    let lastName = '';
                    const stop = effect(() => {
                        const name = evaluateExpression(keyExpr, context);
                        const next = evaluateExpression(expr, context);
                        if (lastName && lastName !== name) element.removeAttribute(lastName);
                        lastName = name ? String(name) : '';
                        if (lastName) element.setAttribute(lastName, next == null ? '' : String(next));
                    });
                    const prior = element.__onUnmount;
                    element.__onUnmount = (...args) => {
                        stop();
                        if (typeof prior === 'function') prior(...args);
                    };
                };
                continue;
            }
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
        const modelAttr = [...(node.attributes || [])].find((attr) => attr.name === 'x-model' || attr.name.startsWith('x-model.') || attr.name.startsWith('x-model:'));
        if (!modelAttr) return;
        const modelMods = new Set(modelAttr.name.startsWith('x-model.') ? modelAttr.name.slice(8).split('.').filter(Boolean) : []);
        const modelProp = modelAttr.name.startsWith('x-model:') ? modelAttr.name.slice(8) : 'modelValue';

        const modelExpr = modelAttr.value.trim();
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
            reportDiagnostic('BD1003', `x-model "${modelExpr}" needs a signal getter with .set, or a setter named set${modelExpr.charAt(0).toUpperCase()}${modelExpr.slice(1)}`, {
              expression: modelExpr,
              hint: 'Return the signal getter from setup. A tuple [get, set] also works.'
            });
            return;
        }

        if (getComponent(node.tagName)) {
            props[modelProp] = computed(() => getter());
            props[`onUpdate:${modelProp}`] = (value) => setter(modelMods.has('trim') && typeof value === 'string' ? value.trim() : value);
            return;
        }

        if (!props.attrs) props.attrs = {};
        const tagName = node.tagName.toLowerCase();
        const type = node.getAttribute('type');
        const writeText = (raw) => {
            let next = raw;
            if (modelMods.has('trim') && typeof next === 'string') next = next.trim();
            if (modelMods.has('number') || type === 'number' || type === 'range') {
                if (next === '') setter(null);
                else {
                    const parsed = Number(next);
                    setter(Number.isNaN(parsed) ? null : parsed);
                }
                return;
            }
            setter(next);
        };

        if (tagName === 'input' && type === 'checkbox') {
            props.attrs.checked = computed(() => Boolean(getter()));
            props.onChange = (event) => setter(event.target.checked);
        } else if (tagName === 'input' && type === 'radio') {
            const option = node.getAttribute('value') ?? '';
            props.attrs.checked = computed(() => getter() === option);
            props.onChange = (event) => {
                if (event.target.checked) setter(option);
            };
        } else if (tagName === 'input' && (type === 'number' || type === 'range')) {
            props.attrs.value = computed(() => {
                const current = getter();
                return current == null || Number.isNaN(current) ? '' : String(current);
            });
            const writeNumber = (event) => {
                const raw = event.target.value;
                if (raw === '') setter(null);
                else {
                    const parsed = Number(raw);
                    setter(Number.isNaN(parsed) ? null : parsed);
                }
            };
            props.onInput = writeNumber;
            props.onChange = writeNumber;
        } else if (tagName === 'input' || tagName === 'textarea') {
            props.attrs.value = computed(() => {
                const current = getter();
                return current == null ? '' : String(current);
            });
            const inputHandler = (event) => writeText(event.target.value);
            if (!modelMods.has('lazy')) props.onInput = inputHandler;
            props.onChange = inputHandler;
        } else if (tagName === 'select') {
            props.attrs.value = computed(() => {
                const current = getter();
                return current == null ? '' : String(current);
            });
            props.onChange = (event) => setter(event.target.value);
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
                const expr = attr.value;
                // Live getter so a scoped slot updates when the child changes.
                slotProps[propName] = computed(() => evaluateExpression(expr, context));
            }
        }
        // Find slot content in context
        const slotContent = context && context.__slots && context.__slots[slotName];
        if (slotContent) {
            return () => {
                const rendered = typeof slotContent === 'function' ? slotContent(slotProps) : slotContent;
                return stampSlot(rendered);
            };
        }
        if (slotName === 'default') {
            const children = context && context.children !== undefined ? context.children : '';
            return () => stampSlot(typeof children === 'function' ? children() : children);
        }
        return '';
    }
};

function stampSlot(node) {
    if (Array.isArray(node)) {
        node.forEach(stampSlot);
        return node;
    }
    if (node instanceof Element) node.setAttribute('data-basedom-slot', '');
    return node;
}

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
            // Parent names stay visible. Slot props are added as own names.
            const slotContext = childScope(context);
            for (const [key, value] of Object.entries(slotProps || {})) slotContext[key] = value;
            try {
                if (nodeClone.tagName && nodeClone.tagName.toLowerCase() === 'template') {
                    const contentRoot = nodeClone.content || nodeClone;
                    const children = Array.from(contentRoot.childNodes || []).map(n => parseNode(n, slotContext)).filter(Boolean);
                    return children.length === 1 ? children[0] : children;
                }
            } catch (e) {
                // fall back to parsing the node itself on error
            }
            return parseNode(nodeClone, slotContext);
        };
        // Registered above. Keep it out of the default children list.
        const hide = () => null;
        hide.__basedomSlot = true;
        return hide;
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
        if (typeof refName !== 'string' || !refName) return;
        const previous = props.onMount;
        props.onMount = (element) => {
            if (typeof previous === 'function') previous(element);
            const exposed = element.__basedomExposed || element;
            const current = context[refName];
            if (current && typeof current.set === 'function') current.set(exposed);
            else context[refName] = exposed;
        };
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
        const owner = getCurrentOwner();
        if (owner) host.__basedomOwner = owner;
        const child = context && context.children;
        const content = typeof child === 'function' ? child() : child;
        if (content instanceof Node) host.appendChild(content);
        else if (content != null && content !== false && content !== '') host.textContent = String(content);
        return host;
    }
};

/**
 * Catches errors thrown while rendering this subtree, and errors thrown by
 * effects created in it. Shows fallback markup and a reset control.
 * Does not catch errors from event handlers or timers.
 */
export const xBoundaryDirective = {
    controlFlow: true,
    handle({ node, context, parseNode }) {
        if (!node.hasAttribute || !node.hasAttribute('x-boundary')) return null;
        const message = node.getAttribute('x-boundary') || 'This screen failed.';
        const isOutlet = node.hasAttribute('x-outlet');
        const outletName = node.getAttribute('x-outlet') || 'main';
        const host = document.createElement(node.tagName.toLowerCase());
        for (const attr of [...node.attributes]) {
            if (attr.name === 'x-boundary') continue;
            host.setAttribute(attr.name, attr.value);
        }
        host.setAttribute('x-boundary', message);
        const boundaryOwner = createOwner();
        let showing = false;
        const show = (error) => {
            if (showing) return;
            showing = true;
            try {
                reportDiagnostic('BD1007', error && error.message ? error.message : 'Component render failed', {
                    hint: 'The boundary kept the rest of the page mounted. Reset renders the subtree again. Event handlers and timers are not caught.'
                });
                callOnUnmountRecursive(host);
                host.replaceChildren();
                host.appendChild(boundaryFallback(message, error, () => {
                    showing = false;
                    render();
                }));
            } finally {
                showing = false;
            }
        };
        boundaryOwner.boundary = show;
        host.__basedomOwner = boundaryOwner;
        host.__basedomBoundary = show;
        const contentNodes = [...node.childNodes].filter((child) => {
            return !(child.nodeType === Node.ELEMENT_NODE && child.hasAttribute && child.hasAttribute('x-fallback'));
        });
        function render() {
            callOnUnmountRecursive(host);
            host.replaceChildren();
            try {
                runWithOwner(boundaryOwner, () => {
                    if (isOutlet) {
                        const child = context && context.children;
                        const content = typeof child === 'function' ? child() : child;
                        if (host.querySelector('[data-boundary-fallback]')) {
                            if (content && content.__basedomOwner) disposeOwner(content.__basedomOwner);
                            return;
                        }
                        if (content instanceof Node) host.appendChild(content);
                        else if (content != null && content !== false && content !== '') host.textContent = String(content);
                    } else if (!host.querySelector('[data-boundary-fallback]')) {
                        const shell = createComponent('div', {
                            children: contentNodes.map((child) => parseNode(child, context)).filter((child) => child != null && child !== '')
                        });
                        shell.style.display = 'contents';
                        host.appendChild(shell);
                    }
                });
            } catch (error) {
                show(error);
            }
        }
        render();
        return host;
    }
};

function boundaryFallback(message, error, reset) {
    const box = document.createElement('div');
    box.setAttribute('data-boundary-fallback', '');
    const alert = document.createElement('p');
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    const detail = document.createElement('pre');
    detail.textContent = error && error.message ? error.message : String(error);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.boundaryReset = '';
    button.textContent = 'Reset';
    button.addEventListener('click', reset);
    box.append(alert, detail, button);
    return box;
}

// Register built-in directives
registerDirective('x-boundary', xBoundaryDirective);
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