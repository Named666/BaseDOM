// html.js
import { createComponent } from "./components.js";
import { effect } from "./state.js";
import { attachLifecycleHooks } from "./lifecycle.js";

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

/**
 * Creates a component with lifecycle hooks
 * @param {Function} componentFn - Function that returns component structure
 * @param {Object} lifecycle - Object containing onMount, onUnmount, onUpdate functions
 * @returns {Function} Component function with lifecycle hooks
 */
export const withLifecycleHooks = (componentFn, lifecycle = {}) => {
    // Use attachLifecycleHooks from lifecycle.js for deduplication and modularity
    return (props) => {
        const component = componentFn(props);
        if (component instanceof HTMLElement) {
            // Attach all lifecycle hooks in a single call
            attachLifecycleHooks(component, lifecycle);
        }
        return component;
    };
};

const tags = [
    'div', 'p', 'span', 'button', 'input', 'label', 'video', 'h1', 'h2', 'h3',
    'ul', 'li', 'nav', 'header', 'footer', 'main', 'select', 'option', 'fieldset'
];

const elements = {};
tags.forEach(tag => {
    elements[tag] = Element(tag);
});
export const { div, p, span, button, input, label, video, h1, h2, h3, ul, li, nav, header, footer, main, select, option, fieldset } = elements;

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
