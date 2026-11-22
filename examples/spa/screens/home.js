import { computed, signal } from '../../../state.js';
import { onUnmount } from '../../../lifecycle.js';

export default function setup() {
  const [count, setCount] = signal(0);
  const [pingMessage, setPingMessage] = signal('');
  const label = computed(() => `Visitor ${count()}`);
  function increment() { setCount((value) => value + 1); }
  function onPing(name) { setPingMessage(`Pinged ${name}`); }
  onUnmount(() => setCount(0));
  return { count, label, increment, onPing, pingMessage };
}
