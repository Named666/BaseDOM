import { provide } from '../../../context.js';
import { signal } from '../../../state.js';

export default function setup() {
  const [theme, setTheme] = signal('plain');
  provide('theme', theme);
  return { theme, setTheme };
}
