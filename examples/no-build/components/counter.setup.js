import { signal, computed } from '../../../state.js';
import { onMount, onCleanup } from '../../../lifecycle.js';

export default function setup() {
  const [count, setCount] = signal(0);
  const [message, setMessage] = signal('Hello, BaseDOM');
  const doubled = computed(() => count() * 2);
  const items = computed(() => Array.from({ length: count() }, (_, index) => `Click ${index + 1}`));

  onMount(() => {
    const timer = setInterval(() => {}, 60_000);
    onCleanup(() => clearInterval(timer));
  });

  return {
    title: 'BaseDOM counter',
    count,
    message,
    doubled,
    items,
    increment() { setCount((value) => value + 1); },
    reset() { setCount(0); }
  };
}
