import { signal } from '../../../state.js';
import { onUnmount } from '../../../lifecycle.js';

export default function setup() {
  const [count, setCount] = signal(0);
  onUnmount(() => setCount(0));
  return {
    count,
    increment() { setCount((value) => value + 1); }
  };
}
