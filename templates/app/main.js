import Layout from './screens/layout.html';
import Home from './screens/home.html';
import { defineRoute, startRouter, initialize, navigate } from 'basedom';

defineRoute({
  path: '/',
  component: Layout,
  children: [
    { path: '', component: Home, meta: { title: 'Home' } }
  ]
});

initialize('#app');
startRouter();
navigate(location.pathname + location.search);
