export function resolveComponentPath(source) {
  if (typeof source !== 'string') return source;

  const normalized = source.replace(/\\/g, '/');
  if (/^(?:[a-z]+:)?\/\//i.test(normalized) || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return source;
  }

  const publicIndex = normalized.lastIndexOf('/public/');
  if (publicIndex !== -1) {
    return normalized.slice(publicIndex + '/public'.length);
  }

  const trimmed = normalized.replace(/^\.\//, '');
  if (trimmed.startsWith('public/')) {
    return `/${trimmed.slice('public/'.length)}`;
  }

  const relativePublic = normalized.match(/^(?:\.\.\/)+public\/(.+)$/);
  if (relativePublic) {
    return `/${relativePublic[1]}`;
  }

  return source;
}
