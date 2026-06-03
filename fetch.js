// fetch.js - centralized fetch and swap utilities for BaseDOM
  
import { parseComponent } from './parser.js';
import { renderComponent } from './components.js';
import { preserveAndSwap, safeAppendElement, replaceContent } from './lifecycle.js';

function getRawAttribute(elt, name) {
  if (!(elt instanceof Element)) return null;
  return elt.getAttribute(name) || elt.getAttribute('data-' + name);
}

function makeFragment(response) {
  const responseWithNoHead = response.replace(/<head([\s\S]*?)>[\s\S]*?<\/head>/i, '');
  const startTagMatch = /<([a-z][^\/>\s]*)/i.exec(responseWithNoHead);
  let fragment = document.createDocumentFragment();
  if (startTagMatch && startTagMatch[1].toLowerCase() === 'html') {
    const doc = new DOMParser().parseFromString(response, 'text/html');
    const frag = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
    frag.title = doc.title;
    fragment = frag;
  } else if (startTagMatch && startTagMatch[1].toLowerCase() === 'body') {
    const doc = new DOMParser().parseFromString(response, 'text/html');
    const frag = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(n => frag.appendChild(n));
    fragment = frag;
  } else {
    const temp = document.createElement('div');
    temp.innerHTML = response;
    const frag = document.createDocumentFragment();
    Array.from(temp.childNodes).forEach(n => frag.appendChild(n));
    fragment = frag;
  }
  return fragment;
}

function applyRawHtmlSwapToTarget(target, html, swapStyle) {
  switch ((swapStyle || 'innerHTML').toLowerCase()) {
    case 'outerhtml':
      target.outerHTML = html; break;
    case 'textcontent':
      target.textContent = html; break;
    case 'afterbegin':
      target.insertAdjacentHTML('afterbegin', html); break;
    case 'beforebegin':
      target.insertAdjacentHTML('beforebegin', html); break;
    case 'beforeend':
      target.insertAdjacentHTML('beforeend', html); break;
    case 'afterend':
      target.insertAdjacentHTML('afterend', html); break;
    case 'delete':
      if (target.parentNode) target.parentNode.removeChild(target);
      break;
    case 'none':
      break;
    default:
      target.innerHTML = html; break;
  }
}

function findAndSwapOobElements(fragment) {
  const oobElts = Array.from(fragment.querySelectorAll('[x-swap-oob]'));
  for (const oobElement of oobElts) {
    const oobValue = getRawAttribute(oobElement, 'x-swap-oob') || 'true';
    let swapStyle = 'outerHTML';
    let selector = '#' + CSS.escape(getRawAttribute(oobElement, 'id') || '');
    if (oobValue === 'true') {
      swapStyle = 'outerHTML';
    } else {
      const parts = oobValue.split(':');
      if (parts.length === 2) {
        swapStyle = parts[0];
        selector = parts[1];
      } else {
        selector = oobValue;
      }
    }
    oobElement.removeAttribute('x-swap-oob');
    oobElement.removeAttribute('data-x-swap-oob');

    const targets = Array.from(document.querySelectorAll(selector));
    if (targets.length) {
      for (const target of targets) {
        applyRawHtmlSwapToTarget(target, oobElement.outerHTML, swapStyle);
      }
    } else {
      // No targets - append to body as fallback
      document.body.insertAdjacentHTML('beforeend', oobElement.outerHTML);
    }
    if (oobElement.parentNode) oobElement.parentNode.removeChild(oobElement);
  }
  return oobElts.length > 0;
}

function preserveElementsDuringSwap(target, frag) {
  const pantryId = '--basedom-preserve-pantry--';
  let pantry = document.getElementById(pantryId);
  if (!pantry) {
    pantry = document.createElement('div');
    pantry.id = pantryId;
    pantry.style.display = 'none';
    document.body.appendChild(pantry);
  }
  const preserved = Array.from(target.querySelectorAll('[x-preserve]')).map(n => ({ id: n.id, node: n }));
  preserved.forEach(p => { if (p.node && p.node.parentNode) pantry.appendChild(p.node); });

  return function restore() {
    for (const child of Array.from(pantry.children)) {
      const id = child.id;
      if (!id) continue;
      const selector = '#' + CSS.escape(id);
      const dest = target.querySelector(selector);
      if (dest) {
        dest.parentNode.replaceChild(child, dest);
      } else {
        target.appendChild(child);
      }
    }
    if (pantry.parentNode) pantry.parentNode.removeChild(pantry);
  };
}

async function fetchAndSwap(url, options = {}) {
  const {
    swap = 'innerHTML',
    targetSelector = null,
    targetElement = null,
    select = null,
    selectOob = null,
    preserve = false,
    method = 'GET',
    headers = {},
    body = null,
    context: componentContext = null
  } = options;

  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let fragment = makeFragment(text);

  // Handle out-of-band swaps first (global OOB elements)
  findAndSwapOobElements(fragment);

  // If select is provided, narrow fragment to the selected node(s)
  if (select) {
    try {
      const temp = document.createElement('div');
      Array.from(fragment.childNodes).forEach(n => temp.appendChild(n.cloneNode(true)));
      const sel = temp.querySelector(select);
      if (sel) {
        const frag = document.createDocumentFragment();
        frag.appendChild(sel.cloneNode(true));
        fragment = frag;
      }
    } catch (e) {}
  }

  // Handle select-oob: swap specific ids out-of-band
  if (selectOob) {
    try {
      const ids = String(selectOob).split(',').map(s => s.trim()).filter(Boolean);
      for (const token of ids) {
        const parts = token.split(':');
        let id = parts[0].trim();
        if (id.startsWith('#')) id = id.slice(1);
        const swapStyle = parts[1] ? parts[1].trim() : 'outerHTML';
        const source = fragment.querySelector ? fragment.querySelector('#' + CSS.escape(id)) : null;
        const target = document.getElementById(id);
        if (source && target) {
          applyRawHtmlSwapToTarget(target, source.outerHTML, swapStyle);
        }
      }
    } catch (e) {}
  }

  // Determine target element: explicit element wins, then selector, fallback to document.body
  const target = targetElement || (targetSelector ? document.querySelector(targetSelector) : document.body);
  if (!target) return { ok: false, error: 'No target element' };

  let restoreFn = null;
  if (preserve) restoreFn = preserveElementsDuringSwap(target, fragment);

  // Parse swap spec (style + modifiers) like "innerHTML swap:1s settle:100ms show:top transition:true"
  function parseTime(t) {
    if (t == null) return 0;
    t = String(t).trim();
    if (t.endsWith('ms')) return parseFloat(t.slice(0, -2)) || 0;
    if (t.endsWith('s')) return (parseFloat(t.slice(0, -1)) || 0) * 1000;
    return parseFloat(t) || 0;
  }

  function parseSwapSpec(spec) {
    const out = { swapStyle: 'innerHTML', swapDelay: 0, settleDelay: 20, transition: false, ignoreTitle: false, scroll: null, show: null, focusScroll: null };
    if (!spec) return out;
    const parts = String(spec).split(/\s+/).filter(Boolean);
    if (parts.length === 0) return out;
    // first token may be the swap style unless it's a modifier
    const first = parts[0];
    if (!first.includes(':') && !first.includes('=')) {
      out.swapStyle = first;
      parts.shift();
    }
    for (const p of parts) {
      const [k, vRaw] = p.split(':');
      const v = vRaw === undefined ? 'true' : vRaw;
      switch (k) {
        case 'swap': out.swapDelay = parseTime(v); break;
        case 'settle': out.settleDelay = parseTime(v); break;
        case 'transition': out.transition = v === 'true' || v === '1'; break;
        case 'ignoreTitle': out.ignoreTitle = v === 'true' || v === '1'; break;
        case 'scroll': out.scroll = v; break;
        case 'show': out.show = v; break;
        case 'focus-scroll': out.focusScroll = v === 'true' || v === '1'; break;
        case 'focus-scroll:true': out.focusScroll = true; break;
        default:
          // support variants like show:#el:top
          if (k === 'show' || k === 'scroll') out[k] = v;
          break;
      }
    }
    return out;
  }

  const swapSpec = parseSwapSpec(swap);

  // Helper to perform title update if present and not ignored
  function applyTitleFromText(text) {
    if (!text) return;
    if (swapSpec.ignoreTitle) return;
    try {
      const m = /<title>([\s\S]*?)<\/title>/i.exec(text);
      if (m && m[1]) document.title = m[1];
    } catch (e) {}
  }

  // Helper to perform post-swap scrolling/showing/focus behavior
  function performPostSwapActions(targetNode) {
    // show modifier: show:top|bottom or show:selector:top
    if (swapSpec.show) {
      const parts = String(swapSpec.show).split(':');
      let sel = parts[0];
      let pos = parts[1] || 'top';
      if (sel === 'window') {
        if (pos === 'top') window.scrollTo({ top: 0, behavior: 'auto' });
        else if (pos === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
      } else {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        if (el) el.scrollIntoView({ block: pos === 'top' ? 'start' : 'end', inline: 'nearest' });
      }
    }
    // scroll modifier: scroll:top|bottom or scroll:selector:top
    if (swapSpec.scroll) {
      const parts = String(swapSpec.scroll).split(':');
      let sel = parts[0];
      let pos = parts[1] || 'top';
      if (sel === 'window') {
        if (pos === 'top') window.scrollTo({ top: 0, behavior: 'auto' });
        else if (pos === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
      } else {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        if (el) {
          el.scrollTop = (pos === 'bottom') ? el.scrollHeight : 0;
        }
      }
    }

    if (swapSpec.focusScroll) {
      try {
        const active = document.activeElement;
        if (active && active.id) {
          active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        }
      } catch (e) {}
    }
  }

  // Helper to run a swap operation possibly wrapped in View Transition
  async function runSwapOperation(doSwap) {
    if (swapSpec.transition && typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      try {
        return await document.startViewTransition(() => doSwap());
      } catch (e) {
        // fallback
        return doSwap();
      }
    }
    return doSwap();
  }

  // Try to interpret the response as a BaseDOM component first and render via parser
  try {
    const componentFn = await parseComponent(text);
    const componentInstance = componentFn ? componentFn(componentContext) : null;
    const el = componentInstance;

    const swapLower = (swap || 'innerHTML').toLowerCase();

    // Helper to get HTML from returned value
    const htmlFromEl = (node) => {
      if (!node) return '';
      if (node instanceof DocumentFragment) return Array.from(node.childNodes).map(n => n.outerHTML || n.textContent).join('');
      if (node instanceof HTMLElement) return node.outerHTML;
      return String(node);
    };

    // apply swap with support for swapDelay/settleDelay/transition and lifecycle-aware rendering
    const doSwap = () => {
      const style = swapSpec.swapStyle ? swapSpec.swapStyle.toLowerCase() : swapLower;
      switch (style) {
        case 'outerhtml':
          if (el instanceof HTMLElement) {
            if (target.parentNode) {
              target.parentNode.replaceChild(el, target);
            } else {
              applyRawHtmlSwapToTarget(target, htmlFromEl(el), 'outerHTML');
            }
          } else {
            applyRawHtmlSwapToTarget(target, htmlFromEl(el), 'outerHTML');
          }
          break;
        case 'textcontent':
          if (el instanceof HTMLElement) target.textContent = el.textContent || '';
          else if (typeof el === 'string') target.textContent = el;
          else applyRawHtmlSwapToTarget(target, htmlFromEl(el), 'textContent');
          break;
        case 'afterbegin':
        case 'beforebegin':
        case 'beforeend':
        case 'afterend':
          if (typeof componentInstance === 'function' || componentInstance instanceof HTMLElement || componentInstance instanceof DocumentFragment) {
            // render into wrapper and insert nodes while preserving lifecycle
            const wrapper = document.createElement('div');
            if (typeof componentInstance === 'function') {
              renderComponent(componentInstance, wrapper);
            } else if (componentInstance instanceof HTMLElement || componentInstance instanceof DocumentFragment) {
              wrapper.appendChild(componentInstance instanceof DocumentFragment ? componentInstance.cloneNode(true) : componentInstance);
            }
            const nodes = Array.from(wrapper.childNodes);
            for (const node of nodes) {
              try {
                if (style === 'afterbegin') target.insertBefore(node, target.firstChild);
                else if (style === 'beforebegin') target.parentNode && target.parentNode.insertBefore(node, target);
                else if (style === 'beforeend') target.appendChild(node);
                else if (style === 'afterend') target.parentNode && target.parentNode.insertBefore(node, target.nextSibling);
                if (node.nodeType === Node.ELEMENT_NODE) safeAppendElement(node.parentNode, node);
              } catch (e) {}
            }
          } else {
            target.insertAdjacentHTML(style, String(el));
          }
          break;
        case 'delete':
          if (target.parentNode) target.parentNode.removeChild(target);
          break;
        case 'none':
          break;
        default:
          // innerHTML (default) - use renderComponent and preserve-and-swap so lifecycle hooks are respected
          if (typeof componentInstance === 'function' || componentInstance instanceof HTMLElement || componentInstance instanceof DocumentFragment) {
            preserveAndSwap(target, () => {
              renderComponent(componentInstance, target);
            });
          } else if (el instanceof HTMLElement) {
            replaceContent(target, el);
          } else if (el instanceof DocumentFragment) {
            replaceContent(target, el.cloneNode(true));
          } else {
            target.innerHTML = String(el);
          }
          break;
      }
    };

    // schedule swap after swapDelay then run settle actions after settleDelay
    const run = async () => {
      if (swapSpec.swapDelay > 0) await new Promise(r => setTimeout(r, swapSpec.swapDelay));
      await runSwapOperation(doSwap);
      // title update from response text
      applyTitleFromText(text);
      if (swapSpec.settleDelay > 0) await new Promise(r => setTimeout(r, swapSpec.settleDelay));
      performPostSwapActions(target);
    };
    run().catch(e => { if (window.console) console.error('Swap/run error', e); });

  } catch (err) {
    // Fallback to raw HTML swap if parsing/rendering fails
    const html = Array.from(fragment.childNodes).map(n => n.outerHTML || n.textContent).join('');
    applyRawHtmlSwapToTarget(target, html, swap);
  }

  if (restoreFn) restoreFn();

  return { ok: true, fragment };
}

export { fetchAndSwap, makeFragment, findAndSwapOobElements, applyRawHtmlSwapToTarget, preserveElementsDuringSwap };