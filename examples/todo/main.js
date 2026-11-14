import Layout from './screens/layout.html';
import List from './screens/list.html';
import { defineRoute, lazy, startRouter, initialize, navigate } from 'basedom';
import { items } from './todos.js';

defineRoute({
  path: '/',
  component: Layout,
  children: [
    {
      path: 'todo/:id',
      component: lazy(() => import('./screens/detail.html')),
      meta: { title: 'Todo' },
      load({ params, signal }) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            const item = items().find((todo) => todo.id === params.id);
            if (!item) reject(new Error('No todo with that id'));
            else resolve({ title: item.title, done: item.done });
          }, 40);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
    },
    { path: '', component: List, meta: { title: 'Todos' } },
    { path: ':filter', component: List, meta: { title: 'Filtered' } }
  ]
});

initialize('#app');
startRouter();
navigate(location.pathname + location.search);
