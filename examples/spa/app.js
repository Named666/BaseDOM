import { loadComponent } from '../../sfc.js';
import { defineRoute, startRouter } from '../../router.js';
import { initialize } from '../../render.js';
import { navigate } from '../../navigation.js';

const layout = await loadComponent(new URL('./screens/layout.html', import.meta.url).href);
const home = await loadComponent(new URL('./screens/home.html', import.meta.url).href);
const about = await loadComponent(new URL('./screens/about.html', import.meta.url).href);

defineRoute({
  path: '/',
  component: layout,
  children: [
    { path: '', component: home, meta: { title: 'Home' } },
    { path: 'about', component: about, meta: { title: 'About' } }
  ]
});

initialize('#app');
startRouter({ mode: 'hash' });
await navigate(location.hash || '/');
