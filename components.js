// components.js
import { effect } from './state.js';
import {
  attachLifecycleHooks,
  callOnMountRecursive,
  callOnUnmountRecursive,
  replaceContent,
  safeAppendElement
} from './lifecycle.js';

// Utility: Generate a scoped class name from a string
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
 * @param {function} [options.onUpdate] - Lifecycle hook for when the component should update (call triggerUpdate to invoke).
 * @param {function} [options.onSubmit]   – Form submit handler (preventDefault applied).
 * @returns {HTMLElement} The HTML element representation of the component.
 */
export function createComponent(tag, options = {}) {
  // Normalize options
  const opts = typeof options === 'object' && !Array.isArray(options) ? options : { children: options };
  const { attrs = {}, children = [], styles = '', onMount, onUnmount, onUpdate, onSubmit } = opts;
  const element = document.createElement(tag);

  // Merge event handlers from attrs and top-level options
  const allAttrs = { ...attrs };
  for (const key in opts) {
    if (key.startsWith('on') && typeof opts[key] === 'function' && !['onMount', 'onUnmount', 'onUpdate'].includes(key)) {
      allAttrs[key] = opts[key];
    }
  }

  // <form> submit handler
  if (tag === 'form' && typeof onSubmit === 'function') {
    delete allAttrs.onSubmit;
    element.addEventListener('submit', e => {
      e.preventDefault();
      onSubmit(e, element);
    });
  }

  // Attribute application (reactive and static)
  const effectsToCleanup = [];
  const applyAttribute = (el, key, value) => {
    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      const handlerProp = `__${eventName}_handler`;
      if (el[handlerProp]) el.removeEventListener(eventName, el[handlerProp]);
      el.addEventListener(eventName, value);
      el[handlerProp] = value;
    } else if (key === 'class' && typeof value === 'object') {
      effectsToCleanup.push(effect(() => {
        el.className = Object.entries(value).filter(([, v]) => typeof v === 'function' ? v() : v).map(([k]) => k).join(' ');
      }));
    } else if (key === 'style' && typeof value === 'object') {
      effectsToCleanup.push(effect(() => {
        for (const [styleKey, styleValue] of Object.entries(value)) {
          el.style[styleKey] = typeof styleValue === 'function' ? styleValue() : styleValue;
        }
      }));
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
  Object.entries(allAttrs).forEach(([key, value]) => applyAttribute(element, key, value));

  // Scoped styles
  if (styles && typeof styles === 'string' && styles.trim()) {
    const styleHash = hashString(styles);
    if (!injectedStyles.has(styleHash)) {
      // Prefix selectors and keyframes
      function prefixSelectors(css, className) {
        // Scope @keyframes names
        const keyframesRegex = /@(?:-webkit-|-moz-|-o-)?keyframes\s+([a-zA-Z0-9_-]+)/g;
        const keyframesNames = [];
        const scopedKeyframesCSS = css.replace(keyframesRegex, (match, name) => {
          const scopedName = `${className}__${name}`;
          keyframesNames.push({ original: name, scoped: scopedName });
          return match.replace(name, scopedName);
        });
        // Remove @keyframes blocks
        const keyframesBlocks = [];
        let tempCss = scopedKeyframesCSS.replace(/@(?:-webkit-|-moz-|-o-)?keyframes[^{]+{[\s\S]*?}}/g, match => {
          keyframesBlocks.push(match);
          return '/*__KEYFRAME_PLACEHOLDER__*/';
        });
        // Replace animation names
        keyframesNames.forEach(({ original, scoped }) => {
          const nameRegex = new RegExp(`\\b${original}\\b`, 'g');
          tempCss = tempCss.replace(nameRegex, scoped);
        });
        // Restore keyframes blocks
        keyframesBlocks.forEach(block => {
          tempCss = tempCss.replace('/*__KEYFRAME_PLACEHOLDER__*/', block);
        });
        css = tempCss;
        // Prefix selectors
        css = css.replace(/(^|\})\s*([^{@}][^{]*)\{/g, (match, brace, selector) => {
          const selectors = selector.split(',').map(sel => {
            sel = sel.trim();
            if (!sel) return '';
            if (sel.startsWith('&')) return `.${className}${sel.substring(1)}`;
            if (sel.startsWith(`.${className}`)) return sel;
            return `.${className} ${sel}`;
          });
          return `${brace} ${selectors.join(', ')}{`;
        });
        // Prefix selectors in @media/@supports
        css = css.replace(/(@media[^{]+{[\s\S]*?})/g, block => {
          return block.replace(/([^{@}][^{]*)\{/g, (match, selector) => {
            const selectors = selector.split(',').map(sel => {
              sel = sel.trim();
              if (!sel) return '';
              if (sel.startsWith('&')) return `.${className}${sel.substring(1)}`;
              if (sel.startsWith(`.${className}`)) return sel;
              return `.${className} ${sel}`;
            });
            return `${selectors.join(', ')}{`;
          });
        });
        return css;
      }
      const scopedCSS = prefixSelectors(styles, styleHash);
      const styleTag = document.createElement('style');
      styleTag.textContent = scopedCSS;
      document.head.appendChild(styleTag);
      injectedStyles.add(styleHash);
    }
    element.classList.add(styleHash);
  }

  // Children
  const appendChild = child => {
    if (typeof child === 'function') {
      const marker = document.createTextNode('');
      element.appendChild(marker);
      let currentChildNodes = [];
      let mountedNodes = new WeakSet();
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
          // nothing
        } else if (typeof reactiveValue === 'object' && reactiveValue.__html) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = reactiveValue.__html;
          newNodes = Array.from(tempDiv.childNodes);
        } else {
          newNodes.push(document.createTextNode(String(reactiveValue)));
        }
        // Remove old nodes
        currentChildNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) callOnUnmountRecursive(node);
          if (node.parentNode === element) element.removeChild(node);
        });
        currentChildNodes = [];
        // Insert new nodes
        newNodes.forEach(newNode => {
          element.insertBefore(newNode, marker);
          currentChildNodes.push(newNode);
          if (newNode.nodeType === Node.ELEMENT_NODE && !mountedNodes.has(newNode)) {
            callOnMountRecursive(newNode);
            mountedNodes.add(newNode);
          }
        });
      }));
    } else if (child instanceof HTMLElement) {
      element.appendChild(child);
    } else if (child instanceof DocumentFragment) {
      element.appendChild(child.cloneNode(true));
    } else if (typeof child === 'object' && child !== null && child.__html) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = child.__html;
      Array.from(tempDiv.childNodes).forEach(node => {
        element.appendChild(node);
        if (node.nodeType === Node.ELEMENT_NODE && (child.__onMount || child.__onUnmount || child.__onUpdate)) {
          attachLifecycleHooks(node, {
            onMount: child.__onMount,
            onUnmount: child.__onUnmount,
            onUpdate: child.__onUpdate
          });
        }
      });
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  };
  (Array.isArray(children) ? children : [children]).forEach(appendChild);

  // Unified lifecycle hooks and effect cleanup
  const effectsCleanup = effectsToCleanup.length > 0 ? () => {
    effectsToCleanup.forEach(cleanup => cleanup());
    effectsToCleanup.length = 0;
  } : null;
  attachLifecycleHooks(element, {
    onMount,
    onUnmount: effectsCleanup ? (onUnmount ? () => { effectsCleanup(); onUnmount(); } : effectsCleanup) : onUnmount,
    onUpdate
  });
  // If there are effect cleanups, attach them to onUnmount via attachLifecycleHooks
  if (effectsToCleanup.length > 0) {
    attachLifecycleHooks(element, {
      onUnmount: () => {
        effectsToCleanup.forEach(cleanup => cleanup());
        effectsToCleanup.length = 0;
        if (typeof onUnmount === 'function') onUnmount();
      }
    });
  }
  return element;
}

/**
 * Renders a component into a container, handling lifecycle cleanup and mounting.
 * @param {Function|HTMLElement|DocumentFragment|string|number} component - The component to render.
 * @param {HTMLElement} container - The container element.
 */
export function renderComponent(component, container) {
  replaceContent(container, null); // Unmount existing content
  const el = typeof component === 'function' ? component() : component;
  if (el instanceof HTMLElement || el instanceof DocumentFragment) {
    safeAppendElement(container, el);
  } else {
    container.textContent = String(el);
  }
}
