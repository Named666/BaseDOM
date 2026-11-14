import { signal } from 'basedom';

let nextId = 3;
const [items, setItems] = signal([
  { id: '1', title: 'Write the list', done: false },
  { id: '2', title: 'Open a todo', done: true }
]);

export { items };

export function addTodo(title) {
  const id = String(nextId++);
  setItems([...items(), { id, title, done: false }]);
  return id;
}

export function removeTodo(id) {
  setItems(items().filter((todo) => todo.id !== id));
}

export function toggleTodo(id) {
  setItems(items().map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
}
