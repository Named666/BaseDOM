// html.js
import { createComponent } from "./components.js";
import { effect } from "./state.js";

// For raw HTML injection (trust the component)
export function raw(html) {
  return { __html: html };
}

// Helper for basic elements
export const Element = (tag) => (optionsOrChildren, ...restChildren) => {
    // A list of common top-level options that are NOT attributes
    const COMPONENT_OPTIONS_KEYS = ['children', 'styles', 'onMount', 'onUnmount', 'onUpdate', 'attrs'];
    let options = {};
    let directChildren = []; // Children passed directly as arguments after options

    // Determine if the first argument is an options object or children
    if (typeof optionsOrChildren === 'object' && !Array.isArray(optionsOrChildren) && optionsOrChildren !== null && !(optionsOrChildren instanceof HTMLElement) && !(optionsOrChildren instanceof DocumentFragment)) {
        // It's likely an options object
        const potentialOptions = optionsOrChildren;
        const potentialAttrs = {};
        let hasAttrs = false;

        // Iterate through the potentialOptions to separate attributes from component options
        for (const key in potentialOptions) {
            if (potentialOptions.hasOwnProperty(key)) {
                // If the key is a component-specific option, add it to `options`
                if (COMPONENT_OPTIONS_KEYS.includes(key) || typeof potentialOptions[key] === 'function' && key.startsWith('on')) { // Add 'on' prefixed functions to options
                    options[key] = potentialOptions[key];
                } else {
                    // Otherwise, treat it as an attribute
                    potentialAttrs[key] = potentialOptions[key];
                    hasAttrs = true;
                }
            }
        }

        // If we found any attributes, add them to the options.attrs
        if (hasAttrs) {
            options.attrs = { ...options.attrs, ...potentialAttrs }; // Merge with existing attrs if any
        }

        // Remaining arguments are direct children
        directChildren = restChildren;

    } else {
        // First argument is children (or part of children)
        directChildren = [optionsOrChildren, ...restChildren];
    }

    // Combine all children: those from options.children (if present) and direct arguments
    let finalChildren = [];
    if (options.children) {
        finalChildren = Array.isArray(options.children) ? [...options.children] : [options.children];
    }
    finalChildren.push(...directChildren);

    options.children = finalChildren;

    return createComponent(tag, options);
};

// Exporting common HTML elements as functions
export const div = Element('div');
export const p = Element('p');
export const span = Element('span');
export const button = Element('button');
export const input = Element('input');
export const label = Element('label');
export const video = Element('video');
export const h1 = Element('h1');
export const h2 = Element('h2');
export const h3 = Element('h3');
export const ul = Element('ul');
export const li = Element('li');
export const nav = Element('nav');
export const header = Element('header');
export const footer = Element('footer');
export const main = Element('main');
export const select = Element('select');
export const option = Element('option');
export const fieldset = Element('fieldset');

export const Link = (optionsOrChildren, childrenIfAttrs) => {
    // If the first argument is not an object, or is an array, it must be children.
    if (typeof optionsOrChildren !== 'object' || Array.isArray(optionsOrChildren) || optionsOrChildren === null) {
        return createComponent('a', { 
            attrs: { 'x-link': true },
            children: optionsOrChildren 
        });
    }

    // If the second argument exists, then the first must be attrs.
    if (typeof childrenIfAttrs !== 'undefined') {
        return createComponent('a', { 
            attrs: { 
                'x-link': true,
                ...optionsOrChildren 
            }, 
            children: childrenIfAttrs 
        });
    }

    // Otherwise, the first argument is the entire options object.
    const { attrs = {}, ...rest } = optionsOrChildren;
    return createComponent('a', {
        ...rest,
        attrs: {
            'x-link': true,
            ...attrs
        }
    });
};

// Img function to create an image element
// This function can handle both imported images (e.g., from Webpack) and direct URLs
export const Img = (src, options) => {
    if (typeof src === 'object' && src.default) {
        // If src is an imported image, use its default property
        src = src.default;
    }
    return createComponent('img', {
        attrs: {
            src,
            ...options
        }
    });
};

/**
 * Manages a list of dynamically rendered components with key-based reconciliation.
 * This function is designed to be used within a reactive context (e.g., inside createComponent's children
 * array where the child is a function, or directly within an effect) to efficiently update a list.
 *
 * @param {Function} getItemsFn - A function that returns an array of data items. This function should be reactive.
 * @param {Function} getKeyFn - A function that takes a data item and returns a unique key for it.
 * @param {Function} renderItemFn - A function that takes a data item and its index, and returns an HTMLElement.
 * @returns {DocumentFragment} A DocumentFragment containing the initial rendered list items.
 */
export function List(getItemsFn, getKeyFn, renderItemFn) {
    const fragment = document.createDocumentFragment();
    let currentNodes = new Map(); // Map: key -> { node, dataItem }

    effect(() => {
        const newItems = getItemsFn();
        const newNodes = new Map(); // Map: key -> { node, dataItem }
        const nextDomNodes = []; // Ordered list of DOM nodes to append

        // Phase 1: Reconcile existing nodes and create new ones
        newItems.forEach((item, newIndex) => {
            const key = getKeyFn(item);
            let nodeToUse = null;

            if (currentNodes.has(key)) {
                // Item exists: reuse the node
                const { node: existingNode, dataItem: oldItem } = currentNodes.get(key);
                nodeToUse = existingNode;

                // Optional: If you need to "update" the component itself if data changes,
                // and the component isn't fully reactive on its own props.
                // For DOMinus, if renderItemFn returns a createComponent, its internal
                // reactivity (via signals used in renderItemFn) should handle updates.
                // However, if the item object itself is deeply changed and not just a signal,
                // you might need a way to pass the new item to the component here.
                // For now, we assume `renderItemFn` creates reactive components that react to `item` changes.
                // If `item` itself is a signal, this will just work. If `item` is a plain object,
                // and properties inside it are reactive, then the renderItemFn's component would need to react to those.
                // For simplicity, we are passing the new `item` to the `renderItemFn` implicitly by re-running it.
            } else {
                // New item: create a new node
                nodeToUse = renderItemFn(item, newIndex);
                // Call onMount for newly created elements
                const callOnMountRecursive = (node) => {
                    if (node.__onMount && typeof node.__onMount === 'function') {
                        node.__onMount();
                    }
                    if (node.children) {
                        Array.from(node.children).forEach(callOnMountRecursive);
                    }
                };
                if (nodeToUse instanceof HTMLElement) {
                    callOnMountRecursive(nodeToUse);
                }
            }

            if (nodeToUse) {
                newNodes.set(key, { node: nodeToUse, dataItem: item });
                nextDomNodes.push(nodeToUse);
            }
        });

        // Phase 2: Remove old nodes and perform DOM operations efficiently
        const parent = fragment.parentNode; // Get the actual parent from the previous render

        // If parent exists, perform DOM updates, otherwise, just build the fragment
        if (parent) {
            // Unmount and remove nodes that are no longer present
            currentNodes.forEach(({ node, dataItem }, key) => {
                if (!newNodes.has(key)) {
                    // Node is no longer in the new list, unmount and remove
                    const callUnmountRecursive = (n) => {
                        if (n.__onUnmount && typeof n.__onUnmount === 'function') {
                            n.__onUnmount();
                        }
                        if (n.children) {
                            Array.from(n.children).forEach(callUnmountRecursive);
                        }
                    };
                    callUnmountRecursive(node);
                    if (node.parentNode === parent) {
                        parent.removeChild(node);
                    }
                }
            });

            // Reorder and append new nodes
            const existingChildNodes = Array.from(parent.childNodes);
            let referenceNode = fragment.nextSibling; // Use the fragment's next sibling as a stable reference

            nextDomNodes.forEach((newNode, index) => {
                const existingNodeInPlace = existingChildNodes[index];

                if (newNode === existingNodeInPlace) {
                    // Node is already in the correct place, do nothing
                    // If it's a new node or moved node, insert it before the reference
                } else if (newNode.parentNode !== parent) { // Node is not currently a child of parent or is a new node
                    parent.insertBefore(newNode, existingNodeInPlace || referenceNode);
                } else {
                    // Node is already a child, but potentially in the wrong position
                    // We need to ensure it's in the correct order.
                    // If it's not the last node and its next sibling is not the next expected node, move it.
                    if (index < nextDomNodes.length - 1 && newNode.nextSibling !== nextDomNodes[index + 1]) {
                        parent.insertBefore(newNode, existingChildNodes[index] || referenceNode);
                    }
                }
            });

             // Clean up any remaining children in the parent that are no longer needed
            for (let i = parent.childNodes.length - 1; i >= 0; i--) {
                const child = parent.childNodes[i];
                if (!nextDomNodes.includes(child) && child !== fragment) {
                    parent.removeChild(child);
                }
            }
        } else {
            // Initial render: just append to the fragment
            nextDomNodes.forEach(node => fragment.appendChild(node));
        }

        // Update currentNodes for the next reconciliation cycle
        currentNodes = newNodes;
    });

    return fragment;
}

export const ImgCarousel = ({ images }) => {
    return div({
        attrs: { class: 'img-carousel' },
        children: images.map((img, index) => Img(img, {
            attrs: {
                alt: `Image ${index + 1}`,
                class: 'carousel-image',
                style: `--carousel-index: ${index}`
            }
        }))
    });
};