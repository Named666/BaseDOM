import { createResource } from '../../../resource.js';

export default function setup(props) {
  const data = props.routeData || { heading: 'Notes', body: '' };
  const detail = createResource(() => data.heading, (heading, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(`Detail for ${heading}`), 10);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }));
  return {
    heading: data.heading,
    body: data.body,
    detail
  };
}
