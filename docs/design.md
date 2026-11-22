# Design

BaseDOM is a small UI library: signals write to real DOM nodes. It does not build or diff a virtual DOM.

This is a design choice, not a benchmark. No performance comparison is claimed here.

## What the other libraries actually do

| | What you write | How updates reach the DOM | What BaseDOM takes |
| --- | --- | --- | --- |
| React | JSX components and hooks | A virtual tree is diffed, then the real DOM is patched. A state change re-runs the component. | One-way data from state to the screen, and effect cleanup. Not the virtual DOM, not a required build step. |
| Vue 3.5 (current stable) | Single-file components | Templates compile to virtual nodes, then a runtime diffs them. | The `.html` file with `<template>`, `<script setup>`, and `<style>`. Not the virtual DOM runtime. |
| Vue Vapor | The same SFCs, opt-in | The compiler emits direct DOM operations and can leave the virtual DOM runtime out. As of November 2026 this is in the Vue 3.6 release candidates, not the stable 3.5 line. | The same goal (no virtual DOM). BaseDOM reaches it with a small interpreter instead of a template compiler, so a page can load without a build. |
| Angular | Templates, dependency injection, a compiler, and a large platform | Ivy writes the DOM from instructions. Signals exist, and so do the router, forms, and DI. | Template syntax and an explicit lifecycle. Not the platform. |
| Solid | JSX, compiled once | Components run once. Signals update the exact text node or attribute that read them. There is no virtual DOM. | The runtime model: `signal`, `computed`, `effect`, owners, and cleanup. Lists move real elements. BaseDOM uses HTML instead of JSX so the no-build path stays a browser module. |

## What that means in this repository

- `{{ count }}` keeps one text node and sets `textContent`.
- `:title` and `x-show` write attributes, properties, or `style`.
- `x-if` inserts and removes real elements.
- `x-for` keeps a map of real elements. `x-key` moves those elements. There is no vnode diff.
- `mount(Component, target)` calls the component once. Later signal writes do not call it again.
- `renderComponent(fn, target)` is the coarse escape hatch: it calls `fn` again and replaces DOM. Prefer `mount` for SFCs.

## What stays out on purpose

- No virtual node type and no patch function.
- No JSX runtime.
- No dependency injection, zones, or a required compiler.
- No runtime npm dependency. Vite is optional and only compiles author SFCs during development.
- Template expressions are a small interpreter (`expression.js`). They are not JavaScript `eval`. Arrow functions, optional chaining, and `new` are intentionally absent.

The cost of staying small is in [limitations](./limitations.md).
