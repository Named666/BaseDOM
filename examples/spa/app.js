import { loadComponent } from '../../sfc.js';
import { registerComponent } from '../../registry.js';
import { defineRoute, lazy, startRouter } from '../../router.js';
import { initialize } from '../../render.js';
import { navigate } from '../../navigation.js';
import { setStyleNonce } from '../../components.js';

const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content');
if (nonce) setStyleNonce(nonce);

const layout = await loadComponent(new URL('./screens/layout.html', import.meta.url).href);
const home = await loadComponent(new URL('./screens/home.html', import.meta.url).href);
const about = await loadComponent(new URL('./screens/about.html', import.meta.url).href);
const contact = await loadComponent(new URL('./screens/contact.html', import.meta.url).href);
const boom = await loadComponent(new URL('./screens/boom.html', import.meta.url).href);
const greeting = await loadComponent(new URL('./components/greeting.html', import.meta.url).href);
await registerComponent('greeting', greeting);

defineRoute({
  path: '/',
  component: layout,
  children: [
    { path: '', component: home, meta: { title: 'Home' } },
    { path: 'about', component: about, meta: { title: 'About' } },
    {
      path: 'notes',
      component: lazy(() => loadComponent(new URL('./screens/notes.html', import.meta.url).href)),
      meta: { title: 'Notes' },
      load({ signal }) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({
            heading: 'Notes',
            body: 'Loaded with the route. A newer navigation aborts this.'
          }), 20);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
    },
    { path: 'contact', component: contact, meta: { title: 'Contact' } },
    { path: 'boom', component: boom, meta: { title: 'Boom' } }
  ]
});

initialize('#app');
startRouter({ mode: 'hash' });
await navigate(location.hash || '/');
