// JavaScript control-flow helpers. Import them from 'basedom' when you want them.
// They are not part of the screen runtime, so a counter that never imports them
// does not ship them.

import { effect } from './state.js';
import { getComponent } from './registry.js';

function paint(host, node) {
  host.replaceChildren();
  if (node instanceof Node) host.appendChild(node);
  else if (node != null && node !== false) host.textContent = String(node);
}

export function Show({ when, children, fallback }) {
  const host = document.createElement('div');
  effect(() => {
    const visible = typeof when === 'function' ? when() : when;
    const next = visible ? children : fallback;
    paint(host, typeof next === 'function' ? next() : next);
  });
  return host;
}

export function For({ each, children }) {
  const host = document.createElement('div');
  effect(() => {
    const list = typeof each === 'function' ? each() : each;
    host.replaceChildren();
    (Array.isArray(list) ? list : []).forEach((item, index) => {
      const node = children(item, index);
      if (node instanceof Node) host.appendChild(node);
    });
  });
  return host;
}

export function Index({ each, children }) {
  return For({ each, children: (item, index) => children(index, item) });
}

export function Match({ when, children }) {
  const node = document.createElement('template');
  node.__when = when;
  node.__children = children;
  return node;
}

export function Switch({ children, fallback }) {
  const host = document.createElement('div');
  const arms = (Array.isArray(children) ? children : [children]).filter(Boolean);
  effect(() => {
    const match = arms.find((arm) => arm.__when && (typeof arm.__when === 'function' ? arm.__when() : arm.__when));
    const next = match ? match.__children : fallback;
    paint(host, typeof next === 'function' ? next() : next);
  });
  return host;
}

export function Dynamic({ is, children }) {
  const host = document.createElement('div');
  effect(() => {
    const spec = typeof is === 'function' ? is() : is;
    const fn = typeof spec === 'function' ? spec : getComponent(String(spec || ''));
    paint(host, typeof fn === 'function' ? fn({ children }) : null);
  });
  return host;
}

export function Portal({ to, children }) {
  const target = typeof document !== 'undefined' ? document.querySelector(to) : null;
  const node = typeof children === 'function' ? children() : children;
  if (target && node instanceof Node) target.appendChild(node);
  return node;
}

export function ErrorBoundary({ fallback, children }) {
  const host = document.createElement('div');
  try {
    paint(host, typeof children === 'function' ? children() : children);
  } catch (error) {
    paint(host, typeof fallback === 'function' ? fallback(error) : fallback);
  }
  return host;
}

export function Suspense({ resource, fallback, children }) {
  return Show({
    when: () => !(resource && resource.loading && resource.loading()),
    children,
    fallback
  });
}
