import { computed, createForm, defineSfc, navigate, setStyleNonce, signal, startRouter } from '../index.js';

const [count, setCount] = signal(0);
setCount(count() + 1);
setCount((value) => value + 1);

const double = computed(() => count() * 2);
double();
double.dispose();

const View = defineSfc({
  template: '<p>{{ count }}</p>',
  setup: () => ({ count })
});
View();

setStyleNonce('nonce');
startRouter({ mode: 'hash' });
void navigate('/about');

const form = createForm({ email: '' });
form.fields.email('a@b.c');
form.dispose();
