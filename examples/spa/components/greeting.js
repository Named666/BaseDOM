import { defineProps, emit } from '../../../sfc.js';
import { inject } from '../../../context.js';

export default function setup() {
  const props = defineProps({ name: { default: 'friend' } });
  const theme = inject('theme', 'plain');
  function ping() {
    emit('ping', props.name());
  }
  return { name: props.name, theme, ping };
}
