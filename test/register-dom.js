import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://127.0.0.1:4173/',
  pretendToBeVisual: true
});

const names = [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'DocumentFragment',
  'Text', 'Comment', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent',
  'DOMParser', 'HTMLInputElement', 'HTMLFormElement', 'navigator', 'history',
  'location', 'sessionStorage', 'localStorage', 'getComputedStyle', 'MutationObserver'
];

for (const name of names) {
  const value = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
  if (value === undefined) continue;
  try {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  } catch {
    // Node already exposes some of these as non-configurable getters.
  }
}

globalThis.IS_REACT_ACT_ENVIRONMENT = false;
