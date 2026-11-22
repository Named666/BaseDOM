import Layout from './layout.html';
import Home from './home.html';
import { defineRoute, lazy } from 'basedom/router.js';

const base = '/app';

defineRoute({
  path: '/',
  component: Layout,
  children: [
    { path: '', component: Home },
    { path: 'notes', component: lazy(() => import('./notes.html')), load() { return 1; } },
    { path: base + '/x', component: missing },
    { path: 'gone', component: lazy(() => import('./missing.html')) }
  ]
});
