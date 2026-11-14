import { computed, createForm, createResource, defineProps, defineSfc, emit, inject, navigate, provide, setStyleNonce, signal, startRouter, watch } from '../index.js';

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

const props = defineProps({ count: { default: 1, required: true } });
props.count();
emit('save', props.count());
provide('theme', props.count);
const theme = inject('theme', props.count);
watch(props.count, (_next, _prev, cleanup) => { cleanup(() => undefined); });
const resource = createResource(props.count, async (id, ctx) => {
  void ctx.signal;
  return id;
});
resource.loading();
resource.error();
resource.value();
void resource.refetch();
void theme;
