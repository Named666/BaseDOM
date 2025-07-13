// components.js
import { effect } from './state.js';

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'x-' + Math.abs(hash).toString(36);
}

const injectedStyles = new Set();

/**
 * Creates an HTML element string with optional scoped CSS.
 *
 * @param {string} tag - The HTML tag name (e.g., 'div', 'p', 'button').
 * @param {string} styles - Scoped CSS styles for the component.
 * @param {object} [options] - Configuration object for the component.
 * @param {object} [options.attrs={}] - HTML attributes for the element.
 * @param {Array|string} [options.children=[]] - Child elements or text content.
 * @param {function} [options.onMount] - Lifecycle hook for when the component is mounted.
 * @param {function} [options.onUnmount] - Lifecycle hook for when the component is unmounted.
 * @param {function} [options.onSubmit]   – Form submit handler (preventDefault applied).
 * @returns {HTMLElement} The HTML element representation of the component.
 */
export function createComponent(tag, options = {}) {
  const processedOptions = typeof options === 'object' && !Array.isArray(options)
    ? options
    : { children: options };

  const {
    attrs = {},
    children = [],
    styles = "",
    onMount,
    onUnmount,
    onSubmit
  } = processedOptions;

  const element = document.createElement(tag);

  // Collect all attributes and event handlers from both `attrs` and the top-level options
  const allAttrs = { ...attrs };
  for (const key in processedOptions) {
    if (key.startsWith('on') && typeof processedOptions[key] === 'function') {
      // Exclude special lifecycle hooks that are not DOM events
      if (key !== 'onMount' && key !== 'onUnmount' && key !== 'onUpdate') {
        allAttrs[key] = processedOptions[key];
      }
    }
  }

  // handle <form> submit with preventDefault
  if (tag === 'form' && typeof onSubmit === 'function') {
    // remove any raw attrs.onSubmit so applyAttribute won’t double-attach
    delete allAttrs.onSubmit;
    element.addEventListener('submit', e => {
      e.preventDefault();
      onSubmit(e, element);
    });
  }

  const effectsToCleanup = []; // Store cleanup functions for effects

  // Helper to apply attributes reactively
  const applyAttribute = (el, key, value) => {
    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.toLowerCase().substring(2);
      // Remove any previous handler before adding the new one
      const handlerProp = `__${eventName}_handler`;
      if (el[handlerProp]) {
        el.removeEventListener(eventName, el[handlerProp]);
      }
      el.addEventListener(eventName, value);
      el[handlerProp] = value;
    } else if (key === 'class' && typeof value === 'object') {
      const updateClass = () => {
        el.className = Object.entries(value).filter(([, val]) => {
          return typeof val === 'function' ? val() : val;
        }).map(([k]) => k).join(" ");
      };
      effectsToCleanup.push(effect(updateClass));
    } else if (key === 'style' && typeof value === 'object') {
      const updateStyle = () => {
        for (const [styleKey, styleValue] of Object.entries(value)) {
          el.style[styleKey] = typeof styleValue === 'function' ? styleValue() : styleValue;
        }
      };
      effectsToCleanup.push(effect(updateStyle));
    } else if (typeof value === 'function') {
      effectsToCleanup.push(effect(() => {
        const val = value();
        if (typeof val === 'boolean') {
          if (val) el.setAttribute(key, '');
          else el.removeAttribute(key);
        } else {
          el.setAttribute(key, val);
        }
      }));
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '');
      else el.removeAttribute(key);
    } else {
      el.setAttribute(key, value);
    }
  };

  // Apply attributes
  for (const [key, value] of Object.entries(allAttrs)) {
    applyAttribute(element, key, value);
  }

  // Scoped styles
  let scopedClass = null;
  if (styles && typeof styles === "string" && styles.trim()) {
    const styleHash = hashString(styles);
    scopedClass = styleHash;
    if (!injectedStyles.has(styleHash)) {
      // Helper to prefix selectors with the scoped class
      function prefixSelectors(css, className) {
        // 1. Scope @keyframes names
        // Find all @keyframes names and replace them with a scoped version
        const keyframesRegex = /@(?:-webkit-|-moz-|-o-)?keyframes\s+([a-zA-Z0-9_-]+)/g;
        const keyframesNames = [];
        const scopedKeyframesCSS = css.replace(keyframesRegex, (match, name) => {
          const scopedName = `${className}__${name}`;
          keyframesNames.push({ original: name, scoped: scopedName });
          return match.replace(name, scopedName);
        });

        // Temporarily remove @keyframes blocks to avoid replacing names inside them
        const keyframesBlocks = [];
        let tempCss = scopedKeyframesCSS.replace(/@(?:-webkit-|-moz-|-o-)?keyframes[^{]+{[\s\S]*?}}/g, (match) => {
          keyframesBlocks.push(match);
          return "/*__KEYFRAME_PLACEHOLDER__*/";
        });

        // 2. Replace animation-name and animation properties to use scoped names
        if (keyframesNames.length > 0) {
          keyframesNames.forEach(({ original, scoped }) => {
            // This regex is simpler and more robust. It replaces the name if it's not preceded
            // by characters that would indicate it's a definition (like in @keyframes name).
            // It looks for the name as a whole word.
            const nameRegex = new RegExp(`\\b${original}\\b`, 'g');
            tempCss = tempCss.replace(nameRegex, scoped);
          });
        }

        // Restore keyframes blocks
        keyframesBlocks.forEach(block => {
          tempCss = tempCss.replace("/*__KEYFRAME_PLACEHOLDER__*/", block);
        });
        css = tempCss;


        // Prefix top-level selectors
        css = css.replace(/(^|\})\s*([^{@}][^{]*)\{/g, (match, brace, selector) => {
          // Only prefix if not an at-rule
          const selectors = selector.split(',').map(sel => {
            sel = sel.trim();
            if (!sel) return '';
            // Handle '&' for styling the host element itself
            if (sel.startsWith('&')) {
              return `.${className}${sel.substring(1)}`;
            }
            // Don't double-prefix if already present
            if (sel.startsWith(`.${className}`)) return sel;
            return `.${className} ${sel}`;
          });
          return `${brace} ${selectors.join(', ')}{`;
        });

        // Prefix selectors inside @media and @supports blocks
        css = css.replace(/(@media[^{]+{[\s\S]*?})/g, block => {
          return block.replace(/([^{@}][^{]*)\{/g, (match, selector) => {
            const selectors = selector.split(',').map(sel => {
              sel = sel.trim();
              if (!sel) return '';
              // Handle '&' for styling the host element itself
              if (sel.startsWith('&')) {
                  return `.${className}${sel.substring(1)}`;
              }
              if (sel.startsWith(`.${className}`)) return sel;
              return `.${className} ${sel}`;
            });
            return `${selectors.join(', ')}{`;
          });
        });

        // No longer need to process keyframes blocks separately here
        return css;
      }

      const scopedCSS = prefixSelectors(styles, styleHash);
      const styleTag = document.createElement('style');
      styleTag.textContent = scopedCSS;
      document.head.appendChild(styleTag);
      injectedStyles.add(styleHash);
    }
    // Add the class to the element
    element.classList.add(scopedClass);
  }

  // Process children
  // Helper to recursively call __onUnmount on a node and its descendants
  function callUnmountRecursive(node) {
    if (typeof node.__onUnmount === 'function') {
      try {
        node.__onUnmount();
      } catch (e) {
        console.error('onUnmount in reactive child failed', e);
      }
    }
    if (node.children) {
      Array.from(node.children).forEach(callUnmountRecursive);
    }
  }

  const appendChild = (child) => {
    if (typeof child === "function") {
      const marker = document.createTextNode(''); // Stable placeholder
      element.appendChild(marker);

      let currentChildNodes = []; // Store nodes currently rendered by this reactive child
      let mountedNodes = new WeakSet(); // Track which nodes have been mounted

      effectsToCleanup.push(effect(() => {
        const reactiveValue = child();
        let newNodes = [];

        if (typeof reactiveValue === 'string' || typeof reactiveValue === 'number') {
          newNodes.push(document.createTextNode(String(reactiveValue)));
        } else if (reactiveValue instanceof HTMLElement) {
          newNodes.push(reactiveValue);
        } else if (reactiveValue instanceof DocumentFragment) {
          newNodes = Array.from(reactiveValue.childNodes);
        } else if (reactiveValue === null || typeof reactiveValue === 'undefined') {
          // Render nothing
        } else if (typeof reactiveValue === "object" && reactiveValue !== null && reactiveValue.__html) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = reactiveValue.__html;
          newNodes = Array.from(tempDiv.childNodes);
        } else {
          newNodes.push(document.createTextNode(String(reactiveValue)));
        }

        // Remove old nodes (call unmount recursively)
        currentChildNodes.forEach(node => {
          callUnmountRecursive(node);
          if (node.parentNode === element) {
            element.removeChild(node);
          }
        });
        currentChildNodes = [];

        // Insert new nodes before the marker
        newNodes.forEach(newNode => {
          element.insertBefore(newNode, marker);
          currentChildNodes.push(newNode);
          // Only call onMount if not already mounted
          if (typeof newNode.__onMount === 'function' && !mountedNodes.has(newNode)) {
            try {
              newNode.__onMount(newNode);
              mountedNodes.add(newNode);
            } catch (e) {
              console.error('onMount in reactive child failed', e);
            }
          }
        });
      }));

    } else if (child instanceof HTMLElement) {
      element.appendChild(child);
    } else if (child instanceof DocumentFragment) {
      element.appendChild(child.cloneNode(true));
    } else if (typeof child === "object" && child !== null && child.__html) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = child.__html;
      const nodesToAppend = Array.from(tempDiv.childNodes);

      // Append them
      nodesToAppend.forEach(node => {
        element.appendChild(node);
        // Now, if child had lifecycle hooks, you can attach them to the *actual* appended DOM node.
        // This assumes the __html produces a single root node or you have a strategy for multiple.
        // For simplicity, attaching to each top-level node created by the raw html.
        if (child.__onMount) node.__onMount = child.__onMount;
        if (child.__onUnmount) node.__onUnmount = child.__onUnmount;
        // __onUpdate is trickier as it implies watching changes *within* this raw HTML,
        // which contradicts its "raw" nature for this setup.
      });

    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  };

  if (Array.isArray(children)) {
    children.forEach(appendChild);
  } else {
    appendChild(children);
  }

  // Attach lifecycle hooks directly to the element
  const onUnmountWrapper = () => {
    effectsToCleanup.forEach(cleanup => cleanup()); // Run all effect cleanup functions
    effectsToCleanup.length = 0;
    if (onUnmount) onUnmount(); // Run user-defined onUnmount
  };
  if (onMount) element.__onMount = onMount;
  element.__onUnmount = onUnmountWrapper;

  return element;
}

// Lifecycle-aware rendering
export function renderComponent(component, container) {
  console.log(`Rendering component in container: #${container.id} (${container.tagName})`);
  // Before rendering new content, unmount old content recursively
  Array.from(container.children).forEach(child => {
    const callUnmountRecursive = (node) => {
      if (node.__onUnmount && typeof node.__onUnmount === 'function') {
        node.__onUnmount();
      }
      if (node.children) {
        Array.from(node.children).forEach(callUnmountRecursive);
      }
    };
    callUnmountRecursive(child);
  });

  // Clear the container
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Render new component
  const elementToRender = typeof component === "function" ? component() : component;

  if (elementToRender instanceof HTMLElement || elementToRender instanceof DocumentFragment) {
    container.appendChild(elementToRender);
  } else {
    // Handle cases where component might return a string, number, or other primitive
    container.textContent = String(elementToRender);
  }

  // Call onMount hooks for newly added elements recursively
  const callOnMountRecursive = (node) => {
    if (node.__onMount && typeof node.__onMount === 'function') {
      node.__onMount(node);
    }
    if (node.children) {
      Array.from(node.children).forEach(callOnMountRecursive);
    }
  };
  // If the root elementToRender is a DocumentFragment, its children are the top-level nodes
  if (elementToRender instanceof DocumentFragment) {
    Array.from(elementToRender.childNodes).forEach(callOnMountRecursive);
  } else if (elementToRender instanceof HTMLElement) {
    callOnMountRecursive(elementToRender);
  }
  // Also, iterate over the actual children appended to the container (if elementToRender was a fragment)
  Array.from(container.children).forEach(callOnMountRecursive);
}


// Helper to attach hooks to DOM nodes (Useful for arbitrary HTML or non-createComponent elements)
export function withLifecycle(html, { onMount, onUnmount, onUpdate } = {}) {
  return {
    __html: html,
    __onMount: onMount,
    __onUnmount: onUnmount,
    __onUpdate: onUpdate
  };
}
