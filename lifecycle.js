/**
 * Unified Lifecycle System for BaseDOM
 * 
 * This module provides a centralized lifecycle management system with three core hooks:
 * - onMount: Called when an element is added to the DOM
 * - onUnmount: Called when an element is removed from the DOM
 * - onUpdate: Called when triggerUpdate is called on an element
 */

/**
 * Attaches lifecycle hooks to an element
 * @param {HTMLElement} element - The element to attach hooks to
 * @param {Object} hooks - The lifecycle hooks {onMount, onUnmount, onUpdate}
 * @returns {HTMLElement} The element with attached hooks
 */
export function attachLifecycleHooks(element, hooks = {}) {
    if (!(element instanceof HTMLElement)) return element;
    ['onMount', 'onUnmount', 'onUpdate'].forEach(hook => {
        if (typeof hooks[hook] === 'function') {
            const key = `__${hook}`;
            const existing = element[key];
            console.log(`[lifecycle] Attaching ${hook} to element. Existing: ${!!existing}`);
            element[key] = existing
                ? (...args) => { 
                    console.log(`[lifecycle] Composite ${hook} - calling existing`);
                    try { existing(...args); } catch (e) {} 
                    console.log(`[lifecycle] Composite ${hook} - calling new`);
                    try { hooks[hook](...args); } catch (e) {} 
                }
                : hooks[hook];
            // For onUpdate, allow programmatic triggering via element.onUpdate() TODO
            if (hook === 'onUpdate') {
                element.onUpdate = (...args) => {
                    if (typeof element.__onUpdate === 'function') {
                        element.__onUpdate.apply(element, args);
                    }
                };
            }
        }
    });
    return element;
}

/**
 * Recursively processes nodes for lifecycle hooks
 * @param {HTMLElement|DocumentFragment} element - The element or fragment to process
 * @param {string} hookName - The name of the hook property (e.g. '__onMount')
 * @param {boolean} passElement - Whether to pass the element as argument to the hook
 * @param {boolean} childrenFirst - Whether to process children before the current node (for unmount)
 */
function processNodesRecursively(element, hookName, passElement = true, childrenFirst = false) {
    if (!element) return;
    const processNode = node => {
        if (childrenFirst && node.children) Array.from(node.children).forEach(processNode);
        if (typeof node[hookName] === 'function') {
            // Only call onMount if not already mounted
            if (hookName === '__onMount' && node.__mounted) {
                console.log(`[lifecycle] Skipping ${hookName} - already mounted`);
                return;
            }
            try {
                console.log(`[lifecycle] Calling ${hookName} on node`);
                passElement ? node[hookName](node) : node[hookName]();
                if (hookName === '__onMount') node.__mounted = true;
            } catch (e) {
                console.error(`[lifecycle] Error in ${hookName}:`, e);
            }
        }
        if (!childrenFirst && node.children) Array.from(node.children).forEach(processNode);
    };
    if (element instanceof DocumentFragment) {
        Array.from(element.childNodes).forEach(node => node.nodeType === Node.ELEMENT_NODE && processNode(node));
    } else if (element.nodeType === Node.ELEMENT_NODE) {
        processNode(element);
    }
}


/**
 * Recursively calls onMount for an element and its children.
 * @param {Node} node - The node to mount.
 */
export function callOnMountRecursive(node) {
    // Use the generic walker to perform a mount traversal.
    // This preserves existing behavior but centralizes traversal logic
    // (calls node.__onMount and marks mounted nodes to avoid double-mounting).
    processNodesRecursively(node, '__onMount', true, false);
}

/**
 * Recursively calls onUnmount for an element and its children.
 * @param {Node} node - The node to unmount.
 */
export function callOnUnmountRecursive(node) {
    // Use the generic walker to perform an unmount traversal.
    // Children-first traversal ensures children unmount before their parent.
    processNodesRecursively(node, '__onUnmount', true, true);
    // Clear the __mounted flag to allow re-mounting
    if (node.nodeType === Node.ELEMENT_NODE) {
        node.__mounted = false;
        if (node.children) Array.from(node.children).forEach(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                child.__mounted = false;
            }
        });
    }
}

/**
 * Calls onUpdate recursively on an element and all its children
 * @param {HTMLElement|DocumentFragment} el - The element to update
 */
export const callOnUpdateRecursive = el => processNodesRecursively(el, '__onUpdate', true, false);

/**
 * Triggers the onUpdate lifecycle hook on an element and its descendants
 * @param {HTMLElement|DocumentFragment} el - The element to trigger update on
 */
export const triggerUpdate = el => callOnUpdateRecursive(el);

/**
 * Safely removes an element from the DOM with proper lifecycle cleanup
 * @param {HTMLElement} element - The element to remove
 */
export function safeRemoveElement(element) {
    if (element?.parentNode) {
        callOnUnmountRecursive(element);
        element.parentNode.removeChild(element);
    }
}

/**
 * Safely appends an element to the DOM with proper lifecycle setup
 * @param {HTMLElement} parent - The parent element
 * @param {HTMLElement|DocumentFragment} child - The child to append
 */
export function safeAppendElement(parent, child) {
    if (parent && child) {
        parent.appendChild(child);
        callOnMountRecursive(child);
    }
}

/**
 * Replaces all children of a container with new content, handling lifecycle properly
 * @param {HTMLElement} container - The container element
 * @param {HTMLElement|DocumentFragment} newContent - The new content
 */
export function replaceContent(container, newContent) {
    if (!container) return;
    Array.from(container.children).forEach(callOnUnmountRecursive);
    while (container.firstChild) container.removeChild(container.firstChild);
    if (newContent) {
        container.appendChild(newContent);
        callOnMountRecursive(newContent);
    }
}

/**
 * Preserve elements marked with `x-preserve` during a swap operation.
 * Moves preserved nodes to a hidden pantry, runs `swapFn`, then restores nodes
 * to placeholders (matching by id) and triggers onMount for restored nodes.
 * @param {HTMLElement} target - The container element where swap will occur
 * @param {Function} swapFn - A function that performs the DOM swap
 */
export function preserveAndSwap(target, swapFn) {
    if (!target || typeof swapFn !== 'function') return;
    const pantryId = '--basedom-preserve-pantry--';
    let pantry = document.getElementById(pantryId);
    if (!pantry) {
        pantry = document.createElement('div');
        pantry.id = pantryId;
        pantry.style.display = 'none';
        document.body.appendChild(pantry);
    }

    // Move preserved nodes into pantry
    const preserved = Array.from(target.querySelectorAll('[x-preserve]')).map(n => ({ id: n.id, node: n }));
    preserved.forEach(p => { if (p.node && p.node.parentNode) pantry.appendChild(p.node); });

    try {
        // Execute the swap which may replace/alter children of target
        swapFn();
    } finally {
        // Restore preserved nodes into placeholders (by id) or append if missing
        for (const child of Array.from(pantry.children)) {
            if (!child.id) continue;
            const placeholder = document.getElementById(child.id);
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.replaceChild(child, placeholder);
            } else {
                target.appendChild(child);
            }
            // Ensure mount hooks run for restored nodes
            callOnMountRecursive(child);
        }
        if (pantry.parentNode) pantry.parentNode.removeChild(pantry);
    }
}

/**
 * Creates a wrapper function for reactive elements that preserves lifecycle hooks
 * @param {Function} elementFunction - The reactive element function
 * @param {Object} hooks - The lifecycle hooks to attach
 * @returns {Function} A wrapped function that maintains lifecycle hooks
 */
export function wrapReactiveElement(elementFunction, hooks) {
    if (typeof elementFunction !== 'function') return elementFunction;
    return () => {
        const el = elementFunction();
        if (el instanceof HTMLElement) attachLifecycleHooks(el, hooks);
        return el;
    };
}
