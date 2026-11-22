import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { defineSfc } from '../sfc.js';
import { defineRoute, resetRoutes, startRouter } from '../router.js';
import { initialize, resetRenderState } from '../render.js';
import { navigate, setCurrentRoute } from '../navigation.js';
import { onUnmount } from '../lifecycle.js';

const Layout = defineSfc({
  template: `<div class="shell"><header>App</header><main x-outlet></main></div>`
});

let homeStops = 0;

const Home = defineSfc({
  template: `<section><h1>Home</h1><input class="name" value="Ada"></section>`,
  setup() {
    onUnmount(() => { homeStops += 1; });
    return {};
  }
});

const About = defineSfc({
  template: `<section><h1>About</h1><p>Second screen</p></section>`
});

describe('two-screen SPA', { concurrency: false }, () => {
  beforeEach(() => {
    resetRoutes();
    resetRenderState();
    setCurrentRoute(null);
    homeStops = 0;
    window.scrollTo = () => {};
    document.body.innerHTML = '<div id="app"></div>';
    document.title = '';
    history.replaceState({}, '', '/');
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: Home },
        { path: 'about', component: About }
      ]
    });
    initialize('#app');
    startRouter();
  });

  it('keeps the layout mounted, swaps the outlet, and focuses the new heading', async () => {
    await navigate('/');
    const header = document.querySelector('header');
    assert.equal(document.querySelector('h1').textContent, 'Home');
    assert.equal(header.textContent, 'App');

    await navigate('/about');
    assert.equal(document.querySelector('header'), header);
    assert.equal(document.querySelector('h1').textContent, 'About');
    assert.equal(homeStops, 1);
    assert.equal(document.activeElement, document.querySelector('h1'));

    // jsdom does not rewind history.back(). A browser sets the URL, then fires popstate.
    history.replaceState({}, '', '/');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.querySelector('h1').textContent, 'Home');
    assert.equal(document.querySelector('header'), header);
  });

  it('shows a 404 inside the layout for an unknown path', async () => {
    await navigate('/missing');
    assert.equal(document.querySelector('header').textContent, 'App');
    assert.match(document.querySelector('main').textContent, /404/);
  });

  it('lets a later navigation replace one that is still in a guard', async () => {
    resetRoutes();
    let release = () => {};
    const Slow = defineSfc({ template: '<h1>Slow</h1>' });
    defineRoute({
      path: '/',
      component: Layout,
      children: [
        { path: '', component: Home },
        { path: 'slow', component: Slow, guards: { beforeEnter: () => new Promise((resolve) => { release = resolve; }) } },
        { path: 'about', component: About }
      ]
    });
    const first = navigate('/slow');
    const second = navigate('/about');
    release();
    await first;
    await second;
    assert.equal(document.querySelector('h1').textContent, 'About');
  });
});
