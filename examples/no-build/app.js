import { loadComponent } from '../../sfc.js';
import { mount } from '../../components.js';

const Counter = await loadComponent(new URL('./components/Counter.html', import.meta.url).href);
mount(Counter, '#app');
