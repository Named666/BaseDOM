import '../../fetch-directives.js';
import { defineSfc } from '../../sfc.js';
import { mount, setStyleNonce } from '../../components.js';
import { signal } from '../../state.js';

const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content');
if (nonce) setStyleNonce(nonce);

const [name, setName] = signal('Ada');

const Page = defineSfc({
  template: `
    <main class="wrap">
      <h1>Server HTML</h1>
      <p>
        <button type="button" id="load" x-get="/api/note" x-target="#panel" x-indicator="#status">Load note</button>
        <button type="button" id="add" x-get="/api/extra" x-target="#panel" x-swap="beforeend">Append</button>
        <button type="button" id="bad" x-get="/api/missing" x-target="#panel">Broken</button>
        <button type="button" id="slow-a" x-get="/api/slow-a" x-target="#race" x-indicator="#status">Slow</button>
        <button type="button" id="slow-b" x-get="/api/slow-b" x-target="#race">Fast</button>
      </p>
      <form id="save" x-post="/api/save" x-target="#panel" x-encoding="json">
        <label>Name <input name="title" x-model="name"></label>
        <button type="submit">Save</button>
      </form>
      <p id="status">Ready</p>
      <div id="panel"><p>Nothing loaded yet.</p></div>
      <div id="race"></div>
    </main>
  `,
  styles: `
    & { font: 16px/1.4 system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; }
    button { margin-right: 0.5rem; }
    #panel { margin-top: 1rem; padding: 0.75rem 1rem; border: 1px solid #ccc; }
    .x-requesting { opacity: 0.6; }
  `,
  setup: () => ({ name, setName })
});

mount(Page, '#app');
