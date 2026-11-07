import { signal } from '../../../state.js';

export default function setup() {
  const [note, setNote] = signal('Hello from the second screen');
  return { note, setNote };
}
