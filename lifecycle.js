// lifecycle.js

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
    if (!element || !(element instanceof HTMLElement)) {
        return element;
    }

    const { onMount, onUnmount, onUpdate } = hooks;

    // Compose onMount hooks if there are existing ones
    if (onMount && typeof onMount === 'function') {
        const existingOnMount = element.__onMount;
        element.__onMount = existingOnMount 
            ? (el) => { 
                try { existingOnMount(el); } catch (e) { console.error('Existing onMount failed:', e); }
                try { onMount(el); } catch (e) { console.error('New onMount failed:', e); }
              }
            : onMount;
    }

    // Compose onUnmount hooks if there are existing ones
    if (onUnmount && typeof onUnmount === 'function') {
        const existingOnUnmount = element.__onUnmount;
        element.__onUnmount = existingOnUnmount 
            ? () => { 
                try { existingOnUnmount(); } catch (e) { console.error('Existing onUnmount failed:', e); }
                try { onUnmount(); } catch (e) { console.error('New onUnmount failed:', e); }
              }
            : onUnmount;
    }

    // Compose onUpdate hooks if there are existing ones
    if (onUpdate && typeof onUpdate === 'function') {
        const existingOnUpdate = element.__onUpdate;
        element.__onUpdate = existingOnUpdate 
            ? (el) => { 
                try { existingOnUpdate(el); } catch (e) { console.error('Existing onUpdate failed:', e); }
                try { onUpdate(el); } catch (e) { console.error('New onUpdate failed:', e); }
              }
            : onUpdate;
    }

    return element;
}

/**
 * Helper function to process nodes recursively with different hook types
 * @param {HTMLElement|DocumentFragment} element - The element to process
 * @param {string} hookName - The name of the hook to call (__onMount, __onUnmount, __onUpdate)
 * @param {boolean} passElement - Whether to pass the element as argument to the hook
 * @param {boolean} childrenFirst - Whether to process children before the current node (for unmount)
 */
function processNodesRecursively(element, hookName, passElement = true, childrenFirst = false) {
    if (!element) return;

    const processNode = (node) => {
        // Process children first for unmount (cleanup order)
        if (childrenFirst && node.children) {
            Array.from(node.children).forEach(processNode);
        }

        if (node[hookName] && typeof node[hookName] === 'function') {
            // Only call onMount if not already mounted
            if (hookName === '__onMount' && node.__mounted) return;
            try {
                if (passElement) {
                    node[hookName](node);
                } else {
                    node[hookName]();
                }
                if (hookName === '__onMount') node.__mounted = true;
            } catch (e) {
                console.error(`${hookName} lifecycle hook failed:`, e, node);
            }
        }

        // Process children after for mount and update
        if (!childrenFirst && node.children) {
            Array.from(node.children).forEach(processNode);
        }
    };

    if (element instanceof DocumentFragment) {
        Array.from(element.childNodes).forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                processNode(node);
            }
        });
    } else if (element.nodeType === Node.ELEMENT_NODE) {
        processNode(element);
    }
}

/**
 * Calls onMount recursively on an element and all its children
 * @param {HTMLElement|DocumentFragment} element - The element to mount
 */
export function callOnMountRecursive(element) {
    processNodesRecursively(element, '__onMount', true, false);
}

/**
 * Calls onUnmount recursively on an element and all its children
 * @param {HTMLElement} element - The element to unmount
 */
export function callOnUnmountRecursive(element) {
    processNodesRecursively(element, '__onUnmount', false, true);
}

/**
 * Calls onUpdate recursively on an element and all its children
 * @param {HTMLElement} element - The element to update
 */
export function callOnUpdateRecursive(element) {
    processNodesRecursively(element, '__onUpdate', true, false);
}

/**
 * Triggers the onUpdate lifecycle hook on an element and its descendants
 * This is the public API for triggering updates
 * @param {HTMLElement} element - The element to trigger update on
 */
export function triggerUpdate(element) {
    callOnUpdateRecursive(element);
}

/**
 * Safely removes an element from the DOM with proper lifecycle cleanup
 * @param {HTMLElement} element - The element to remove
 */
export function safeRemoveElement(element) {
    if (!element || !element.parentNode) return;

    // Call unmount hooks first
    callOnUnmountRecursive(element);
    
    // Then remove from DOM
    element.parentNode.removeChild(element);
}

/**
 * Safely appends an element to the DOM with proper lifecycle setup
 * @param {HTMLElement} parent - The parent element
 * @param {HTMLElement|DocumentFragment} child - The child to append
 */
export function safeAppendElement(parent, child) {
    if (!parent || !child) return;

    // Append to DOM first
    parent.appendChild(child);
    
    // Then call mount hooks
    callOnMountRecursive(child);
}

/**
 * Replaces all children of a container with new content, handling lifecycle properly
 * @param {HTMLElement} container - The container element
 * @param {HTMLElement|DocumentFragment} newContent - The new content
 */
export function replaceContent(container, newContent) {
    if (!container) return;

    // Unmount existing children
    Array.from(container.children).forEach(child => {
        callOnUnmountRecursive(child);
    });

    // Clear container
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    // Add new content
    if (newContent) {
        container.appendChild(newContent);
        callOnMountRecursive(newContent);
    }
}

/**
 * Creates a wrapper function for reactive elements that preserves lifecycle hooks
 * @param {Function} elementFunction - The reactive element function
 * @param {Object} hooks - The lifecycle hooks to attach
 * @returns {Function} A wrapped function that maintains lifecycle hooks
 */
export function wrapReactiveElement(elementFunction, hooks) {
    if (typeof elementFunction !== 'function') {
        return elementFunction;
    }

    return () => {
        const renderedElement = elementFunction();
        
        if (renderedElement instanceof HTMLElement) {
            attachLifecycleHooks(renderedElement, hooks);
        }
        
        return renderedElement;
    };
}
